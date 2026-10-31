package local.themashup.music.core.download

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import local.themashup.music.core.data.DownloadsRepository
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.download.logic.buildTranscodeCommands
import local.themashup.music.core.download.logic.downloadPercent
import local.themashup.music.core.download.logic.etaSeconds
import local.themashup.music.core.download.logic.extensionFor
import local.themashup.music.core.download.logic.mimeTypeFor
import local.themashup.music.core.download.logic.outputFilename
import local.themashup.music.core.download.logic.pickAudio
import local.themashup.music.core.download.logic.pickVideo
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.domain.StreamCandidate
import okhttp3.OkHttpClient

/** Jobs parked until the user answers the first-run ffmpeg sheet. */
data class ConsentRequest(val jobIds: List<String>)

/**
 * Download job runner (docs/ANDROID.md N7 data flow):
 * enqueue → resolve stream candidates → fetch bytes (progress via Flow) →
 * ffmpeg Process transcode → MediaStore.Downloads.
 * Concurrency: 2 workers (resolver blueprint). Cancel removes the row
 * (web parity) and kills the in-flight call/Process via temp cleanup.
 */
class DownloadEngine(
    private val repository: DownloadsRepository,
    private val extraction: ExtractionService,
    private val ffmpeg: FfmpegManager,
    private val client: OkHttpClient,
    private val context: Context,
    workDir: File,
) {
    // Queue/repository failures can happen before a job row exists, so surface
    // them separately rather than silently swallowing a tap on Download.
    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, _ ->
            _actionError.value = "Could not update the download. Check storage and try again."
        },
    )

    fun clearActionError(expected: String) {
        _actionError.compareAndSet(expected, null)
    }
    private val workRoot = workDir.apply { mkdirs() }
    private val semaphore = Semaphore(MAX_PARALLEL)
    private val running = ConcurrentHashMap<String, Job>()
    private val transfers = ConcurrentHashMap<String, ResumableTransfer>()
    private val cancelling = ConcurrentHashMap.newKeySet<String>()

    private val _consent = MutableStateFlow<ConsentRequest?>(null)
    /** Non-null → the first-run ffmpeg sheet must be shown. */
    val consent: StateFlow<ConsentRequest?> = _consent
    private var consentAnswer: CompletableDeferred<Boolean>? = null

    fun enqueue(track: local.themashup.music.core.domain.Track, quality: String, container: String) {
        scope.launch {
            try {
                val job = repository.enqueue(track, quality, container)
                launchWorker(job)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                _actionError.value = "Could not start the download. Check storage and try again."
            }
        }
    }

    fun enqueueBatch(tracks: List<local.themashup.music.core.domain.Track>, quality: String, container: String) {
        scope.launch {
            var started = 0
            for (track in tracks) {
                try {
                    val job = repository.enqueue(track, quality, container)
                    launchWorker(job)
                    started++
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    _actionError.value = "Could not start a download. Check storage and try again."
                }
            }
            if (started == 0) {
                _actionError.value = "Could not start the download. Check storage and try again."
            }
        }
    }

    /** FAILED row → same quality/container retried in place (web restart). */
    fun retry(jobId: String) {
        val job = repository.job(jobId) ?: return
        if (job.status != DownloadStatus.FAILED) return
        scope.launch {
            repository.updateStatus(jobId, DownloadStatus.QUEUED, error = null)
            launchWorker(repository.job(jobId) ?: job)
        }
    }

    /** Cancellation closes every active range and removes temporary files after the worker stops. */
    @Synchronized
    fun cancel(jobId: String) {
        val requested = repository.job(jobId) ?: return
        // Completed rows have no cancel action. A stale UI event must not
        // remove a file that had already completed before it was tapped.
        if (requested.status == DownloadStatus.COMPLETED) return
        cancelling.add(jobId)
        val worker = running.remove(jobId)
        worker?.cancel()
        transfers[jobId]?.cancel()
        scope.launch {
            try {
                worker?.join()
                // Completion can race with cancellation at the final commit.
                // In that case remove the just-created copy before its row.
                val finished = repository.job(jobId)
                if (finished?.status == DownloadStatus.COMPLETED && finished.location != null) {
                    MediaStoreWriter.discard(context, MediaStoreWriter.Saved(finished.filename.orEmpty(), finished.location))
                }
                cleanupTemps(jobId)
                repository.remove(jobId)
            } finally {
                cancelling.remove(jobId)
            }
        }
    }

    /** Sheet Accept — capture the parked cycle first, then fetch to disk. */
    fun acceptSetup() {
        val answer = consentAnswer
        consentAnswer = null
        _consent.value = null
        scope.launch {
            val ok = ffmpeg.fetch()
            answer?.complete(ok)
        }
    }

    fun declineSetup() {
        val answer = consentAnswer
        consentAnswer = null
        _consent.value = null
        answer?.complete(false)
    }

    /**
     * Rehydrate rows left mid-flight by a process death — marked failed with
     * the resolver's restart message (downloads.py `_load_existing`).
     */
    fun reconcileOnStart() {
        scope.launch {
            repository.load()
            repository.activeJobs().forEach { job ->
                repository.updateStatus(job.id, DownloadStatus.QUEUED)
                launchWorker(repository.job(job.id) ?: job)
            }
        }
    }

    @Synchronized
    private fun launchWorker(job: DownloadJob) {
        if (job.id in cancelling || repository.job(job.id) == null || running[job.id]?.isActive == true) return
        val worker = scope.launch(start = CoroutineStart.LAZY) {
            semaphore.withPermit { runJob(job) }
        }
        running[job.id] = worker
        worker.invokeOnCompletion { running.remove(job.id, worker) }
        worker.start()
    }

    private suspend fun runJob(job: DownloadJob) {
        var attempts = 0
        while (true) {
            try {
                repository.updateStatus(job.id, DownloadStatus.DOWNLOADING)
                val candidates = extraction.streams(job.videoId).candidates
                if (candidates.isEmpty()) throw IOException("No streams available for this track")
                if (job.container == "mp4") runVideoJob(job, candidates) else runAudioJob(job, candidates)
                return
            } catch (e: CancellationException) {
                cleanupTemps(job.id)
                throw e
            } catch (e: IOException) {
                if (++attempts < 3) {
                    delay(1000L * attempts)
                } else {
                    fail(job, e.message ?: "Download interrupted")
                    return
                }
            } catch (e: Exception) {
                fail(job, e.message ?: e.javaClass.simpleName)
                return
            }
        }
    }

    private suspend fun runAudioJob(job: DownloadJob, candidates: List<StreamCandidate>) {
        val source = pickAudio(candidates)
            ?: throw IOException("No audio streams available")
        val ffmpegPath = awaitFfmpeg(job)
            ?: throw IOException("ffmpeg setup declined — ${job.container.uppercase()} conversion needs it")
        val input = File(workRoot, "${job.id}.input.${source.ext}")
        val out = File(workRoot, "${job.id}.${extensionFor(job.container)}")
        try {
            downloadStream(source, input, job, fromPct = 0, toPct = 98)
            markProcessing(job)
            transcode(ffmpegPath, listOf(input.absolutePath), out, job.container, job.quality)
            finish(job, out)
        } finally {
            if (repository.job(job.id)?.status == DownloadStatus.COMPLETED) input.delete()
        }
    }

    private suspend fun runVideoJob(job: DownloadJob, candidates: List<StreamCandidate>) {
        val plan = pickVideo(candidates, job.quality)
            ?: throw IOException("No ${job.quality} video stream available for this track")
        val video = plan.video
        val videoFile = File(workRoot, "${job.id}.v.${video.ext}")
        val out = File(workRoot, "${job.id}.mp4")
        if (!plan.isSplit) {
            try {
                downloadStream(video, videoFile, job, fromPct = 0, toPct = 98)
                markProcessing(job)
                val readyPath = ffmpeg.binaryPath()
                if (video.ext == "mp4" && readyPath == null) {
                    // Muxed progressive MP4 with setup skipped → raw copy
                    // (already h264/aac in an mp4 box — no remux required).
                    videoFile.copyTo(out, overwrite = true)
                } else {
                    val path = readyPath
                        ?: awaitFfmpeg(job)
                        ?: throw IOException("ffmpeg setup declined — this video needs remuxing")
                    transcode(path, listOf(videoFile.absolutePath), out, "mp4", job.quality)
                }
                finish(job, out)
            } finally {
                if (repository.job(job.id)?.status == DownloadStatus.COMPLETED) videoFile.delete()
            }
            return
        }
        // Adaptive plan: video-only + separate audio → two fetches, one merge.
        val audio = plan.audio ?: throw IOException("No audio stream to pair with the video")
        val audioFile = File(workRoot, "${job.id}.a.${audio.ext}")
        val path = ffmpeg.binaryPath()
            ?: awaitFfmpeg(job)
            ?: throw IOException("ffmpeg setup declined — MP4 merging needs it")
        try {
            downloadStream(video, videoFile, job, fromPct = 0, toPct = 85)
            downloadStream(audio, audioFile, job, fromPct = 85, toPct = 98)
            markProcessing(job)
            transcode(
                path,
                listOf(videoFile.absolutePath, audioFile.absolutePath),
                out,
                "mp4",
                job.quality,
            )
            finish(job, out)
        } finally {
            if (repository.job(job.id)?.status == DownloadStatus.COMPLETED) {
                videoFile.delete()
                audioFile.delete()
            }
        }
    }

    private suspend fun awaitFfmpeg(job: DownloadJob): String? {
        ffmpeg.binaryPath()?.let { return it }
        // A fetch started by an earlier accept — follow it instead of asking again.
        val ongoing = ffmpeg.status.value
        if (ongoing is FfmpegState.Downloading || ongoing is FfmpegState.Extracting) {
            val terminal = ffmpeg.status.first { it is FfmpegState.Ready || it is FfmpegState.Failed || it is FfmpegState.Missing }
            return if (terminal is FfmpegState.Ready) ffmpeg.binaryPath() else null
        }
        val request = _consent.value
        _consent.value = ConsentRequest((request?.jobIds.orEmpty() + job.id).distinct())
        val answer = consentAnswer ?: CompletableDeferred<Boolean>().also { consentAnswer = it }
        val ok = answer.await()
        return if (ok) ffmpeg.binaryPath() else null
    }

    private suspend fun markProcessing(job: DownloadJob) {
        repository.updateProgress(job.id, 99, speedBps = null, etaSec = null)
        repository.updateStatus(job.id, DownloadStatus.PROCESSING)
    }

    private suspend fun finish(job: DownloadJob, out: File) {
        val parent = coroutineContext
        parent.ensureActive()
        val saved = MediaStoreWriter.save(
            context,
            out,
            outputFilename(job.title, job.container),
            mimeTypeFor(job.container),
            checkCancelled = { parent.ensureActive() },
        )
        try {
            parent.ensureActive()
            // Complete the row and its URI as one non-interruptible commit;
            // cancel() handles a cancellation that races with this boundary.
            withContext(NonCancellable) {
                repository.markCompleted(job.id, saved.displayName, out.length(), saved.location, saved.warning)
            }
        } catch (e: Exception) {
            if (repository.job(job.id)?.status != DownloadStatus.COMPLETED) MediaStoreWriter.discard(context, saved)
            throw e
        }
        out.delete()
        cleanupTemps(job.id)
    }

    private suspend fun fail(job: DownloadJob, message: String) {
        repository.updateStatus(job.id, DownloadStatus.FAILED, error = message)
    }

    private suspend fun downloadStream(candidate: StreamCandidate, dest: File, job: DownloadJob, fromPct: Int, toPct: Int) {
        coroutineContext.ensureActive()
        val transfer = ResumableTransfer(client)
        transfers[job.id] = transfer
        try {
            coroutineContext.ensureActive()
            transfer.download(candidate, job.videoId, dest) { bytes, total, speed ->
                val local = total?.let { downloadPercent(bytes, it) } ?: 0
                repository.updateProgress(job.id, fromPct + (local.coerceAtLeast(0) * (toPct - fromPct)) / 98,
                    speedBps = speed, etaSec = if (total != null && speed != null) etaSeconds(bytes, total, speed) else null)
            }
        } finally {
            transfers.remove(job.id, transfer)
        }
    }

    /**
     * argv attempts from [buildTranscodeCommands] — first exit-0 wins;
     * last stderr tail is the failure message (resolver "ffmpeg failed: …").
     */
    private suspend fun transcode(
        ffmpegPath: String,
        inputs: List<String>,
        out: File,
        container: String,
        quality: String,
    ) {
        out.delete()
        val cmds = buildTranscodeCommands(ffmpegPath, inputs, out.absolutePath, container, quality)
        var lastErr = ""
        for (cmd in cmds) {
            val proc = ProcessBuilder(cmd).redirectErrorStream(true).start()
            try {
                val result = coroutineScope {
                    // Drain the pipe concurrently but retain only a small error tail.
                    val output = async(Dispatchers.IO) {
                        proc.inputStream.bufferedReader().use { reader ->
                            val tail = StringBuilder()
                            while (true) {
                                val line = reader.readLine() ?: break
                                tail.append(line).append('\n')
                                if (tail.length > 2048) tail.delete(0, tail.length - 2048)
                            }
                            tail.toString()
                        }
                    }
                    try {
                        val finished = runInterruptible(Dispatchers.IO) {
                            proc.waitFor(TRANSCODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                        }
                        if (!finished) throw IOException("ffmpeg timed out")
                        proc.exitValue() to output.await()
                    } finally {
                        // Close the pipe before coroutineScope waits for its reader.
                        if (proc.isAlive) proc.destroyForcibly()
                    }
                }
                if (result.first == 0 && out.isFile && out.length() > 0) return
                lastErr = result.second.trim().takeLast(300)
            } finally {
                if (proc.isAlive) proc.destroyForcibly()
            }
        }
        throw IOException("ffmpeg failed: ${lastErr.ifBlank { "unknown error" }}")
    }

    private fun cleanupTemps(jobId: String) {
        workRoot.listFiles()?.forEach { f ->
            if (f.name.startsWith(jobId)) runCatching { f.delete() }
        }
    }

    private companion object {
        const val MAX_PARALLEL = 2
        const val TRANSCODE_TIMEOUT_MS = 300_000L
    }
}
