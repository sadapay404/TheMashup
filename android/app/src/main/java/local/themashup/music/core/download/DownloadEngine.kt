package local.themashup.music.core.download

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
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
import local.themashup.music.core.network.logic.StreamCandidate
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

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
    // Repo-disk hiccups must never crash the process — jobs surface errors
    // through DownloadStatus instead.
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, _ -> },
    )
    private val workRoot = workDir.apply { mkdirs() }
    private val semaphore = Semaphore(MAX_PARALLEL)
    private val running = ConcurrentHashMap<String, Job>()
    private val calls = ConcurrentHashMap<String, Call>()

    private val _consent = MutableStateFlow<ConsentRequest?>(null)
    /** Non-null → the first-run ffmpeg sheet must be shown. */
    val consent: StateFlow<ConsentRequest?> = _consent
    private var consentAnswer: CompletableDeferred<Boolean>? = null

    fun enqueue(track: local.themashup.music.core.domain.Track, quality: String, container: String) {
        scope.launch {
            // Chips only ever offer matrix pairs — invalid pairs cannot reach here
            // from the UI (QualityPicker validates), so swallow the edge defensively.
            runCatching {
                val job = repository.enqueue(track, quality, container)
                launchWorker(job)
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

    /** Web parity: cancel removes the row and kills the in-flight work. */
    fun cancel(jobId: String) {
        running.remove(jobId)?.cancel()
        calls.remove(jobId)?.cancel()
        scope.launch { repository.remove(jobId) }
        cleanupTemps(jobId)
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
            repository.activeJobs().forEach { job ->
                repository.updateStatus(
                    job.id,
                    DownloadStatus.FAILED,
                    error = "interrupted by restart",
                )
            }
        }
    }

    private fun launchWorker(job: DownloadJob) {
        if (running[job.id]?.isActive == true) return
        val worker = scope.launch {
            semaphore.withPermit { runJob(job) }
        }
        running[job.id] = worker
        worker.invokeOnCompletion { running.remove(job.id, worker) }
    }

    private suspend fun runJob(job: DownloadJob) {
        try {
            repository.updateStatus(job.id, DownloadStatus.DOWNLOADING)
            val outcome = extraction.streams(job.videoId)
            val candidates = outcome.candidates
            if (candidates.isEmpty()) {
                fail(job, "No streams available for this track")
                return
            }
            if (job.container == "mp4") runVideoJob(job, candidates) else runAudioJob(job, candidates)
        } catch (e: CancellationException) {
            cleanupTemps(job.id)
            throw e
        } catch (e: Exception) {
            cleanupTemps(job.id)
            fail(job, e.message ?: e.javaClass.simpleName)
        }
    }

    private suspend fun runAudioJob(job: DownloadJob, candidates: List<StreamCandidate>) {
        val source = pickAudio(candidates)
            ?: throw IOException("No audio streams available")
        val ffmpegPath = awaitFfmpeg(job)
            ?: throw IOException("ffmpeg setup declined — ${job.container.uppercase()} conversion needs it")
        val input = File(workRoot, "${job.id}.${source.ext}")
        val out = File(workRoot, "${job.id}.${extensionFor(job.container)}")
        try {
            downloadStream(source, input, job, fromPct = 0, toPct = 98)
            markProcessing(job)
            transcode(ffmpegPath, listOf(input.absolutePath), out, job.container, job.quality)
            finish(job, out)
        } finally {
            input.delete()
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
                videoFile.delete()
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
            videoFile.delete()
            audioFile.delete()
        }
    }

    private suspend fun awaitFfmpeg(job: DownloadJob): String? {
        ffmpeg.binaryPath()?.let { return it }
        // A fetch started by an earlier accept — follow it instead of asking again.
        val ongoing = ffmpeg.status.value
        if (ongoing is FfmpegState.Downloading || ongoing is FfmpegState.Extracting) {
            val terminal = ffmpeg.status.first { it is FfmpegState.Ready || it is FfmpegState.Failed }
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
        val saved = MediaStoreWriter.save(
            context,
            out,
            outputFilename(job.title, job.container),
            mimeTypeFor(job.container),
        )
        val size = out.length()
        out.delete()
        repository.markCompleted(job.id, saved.displayName, size)
        saved.warning?.let { repository.setWarning(job.id, it) }
    }

    private suspend fun fail(job: DownloadJob, message: String) {
        repository.updateStatus(job.id, DownloadStatus.FAILED, error = message)
    }

    private suspend fun downloadStream(
        candidate: StreamCandidate,
        dest: File,
        job: DownloadJob,
        fromPct: Int,
        toPct: Int,
    ) {
        val rb = Request.Builder().url(candidate.url)
        candidate.httpHeaders.forEach { (k, v) -> rb.header(k, v) }
        val call = client.newCall(rb.build())
        calls[job.id] = call
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("HTTP ${resp.code} fetching stream")
                val body = resp.body ?: throw IOException("empty stream body")
                val total = body.contentLength().takeIf { it > 0 }
                    ?: candidate.sizeBytes ?: -1L
                var got = 0L
                var ema: Long? = null
                var lastAt = System.currentTimeMillis()
                var lastBytes = 0L
                dest.parentFile?.mkdirs()
                body.byteStream().use { input ->
                    dest.outputStream().buffered().use { out ->
                        val buf = ByteArray(128 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            got += n
                            val now = System.currentTimeMillis()
                            if (now - lastAt >= 500) {
                                val instant = (got - lastBytes) * 1000 / (now - lastAt)
                                ema = if (ema == null) instant else (ema!! * 7 + instant) / 8
                                val local = downloadPercent(got, total) // -1 = unknown
                                val pct = if (local >= 0) {
                                    fromPct + (local * (toPct - fromPct)) / 98
                                } else {
                                    fromPct
                                }
                                repository.updateProgress(
                                    job.id,
                                    pct,
                                    speedBps = ema,
                                    etaSec = etaSeconds(got, total, ema ?: 0L),
                                )
                                lastAt = now
                                lastBytes = got
                            }
                        }
                        out.flush()
                    }
                }
                repository.updateProgress(job.id, toPct, speedBps = null, etaSec = null)
            }
        } finally {
            calls.remove(job.id, call)
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
                val err = withTimeoutOrNull(TRANSCODE_TIMEOUT_MS) {
                    proc.inputStream.bufferedReader().use { it.readText() }
                } ?: throw IOException("ffmpeg timed out")
                val exit = proc.waitFor()
                if (exit == 0 && out.isFile && out.length() > 0) return
                lastErr = err.trim().take(300)
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
