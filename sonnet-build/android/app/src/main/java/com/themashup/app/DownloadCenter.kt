package com.themashup.app

import android.content.Context
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import okhttp3.Request
import java.io.File
import java.io.RandomAccessFile

val Qualities = listOf("128" to "MP3 128k", "192" to "MP3 192k", "320" to "MP3 320k", "mp4" to "MP4 video")

/**
 * Download queue with progress, pause/resume (HTTP Range), cancel.
 * Audio qualities are converted to MP3 with a bundled ffmpeg binary (jniLibs/<abi>/libffmpeg.so)
 * when present; otherwise the original container (m4a/webm) is kept so downloads still work.
 */
class DownloadCenter(private val app: Context, private val scope: CoroutineScope) {
    private val _jobs = MutableStateFlow<List<DownloadJob>>(emptyList())
    val jobs: StateFlow<List<DownloadJob>> = _jobs
    private val running = mutableMapOf<String, Job>()
    private val dir = File(app.filesDir, "downloads").apply { mkdirs() }
    private val maxParallel = 2

    private fun patch(id: String, f: (DownloadJob) -> DownloadJob) = _jobs.update { l -> l.map { if (it.id == id) f(it) else it } }
    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(80)
    private fun partFile(id: String) = File(dir, safe(id) + ".part")

    fun start(t: Track, quality: String) {
        val id = "${t.id}|$quality"
        if (_jobs.value.any { it.id == id && it.status in listOf(JobStatus.QUEUED, JobStatus.DOWNLOADING, JobStatus.PAUSED, JobStatus.CONVERTING) }) return
        partFile(id).delete()
        _jobs.update { listOf(DownloadJob(id, t, quality)) + it.filter { j -> j.id != id } }
        pump()
    }

    fun pause(id: String) {
        patch(id) { it.copy(status = JobStatus.PAUSED) }
        running.remove(id)?.cancel()
    }

    fun resume(id: String) {
        patch(id) { it.copy(status = JobStatus.QUEUED, error = null) }
        pump()
    }

    fun cancel(id: String) {
        running.remove(id)?.cancel()
        partFile(id).delete()
        patch(id) { it.copy(status = JobStatus.CANCELLED) }
        pump()
    }

    fun clearFinished() = _jobs.update { l -> l.filter { it.status !in listOf(JobStatus.DONE, JobStatus.CANCELLED, JobStatus.ERROR) } }

    private fun pump() {
        val active = _jobs.value.count { it.status == JobStatus.DOWNLOADING || it.status == JobStatus.CONVERTING }
        _jobs.value.filter { it.status == JobStatus.QUEUED }.take((maxParallel - active).coerceAtLeast(0)).forEach { j ->
            patch(j.id) { it.copy(status = JobStatus.DOWNLOADING) }
            running[j.id] = scope.launch(Dispatchers.IO) { run(j) }
        }
    }

    private suspend fun run(job: DownloadJob) {
        val part = partFile(job.id)
        try {
            val video = job.quality == "mp4"
            val r = Sources.resolveStream(job.track, job.quality.toIntOrNull() ?: 192, video)
                ?: error(if (video) "Video is not available from the current mirrors." else "No downloadable source found.")
            var have = if (part.exists()) part.length() else 0L
            val rb = Request.Builder().url(r.url).header("User-Agent", "Mozilla/5.0")
            if (have > 0) rb.header("Range", "bytes=$have-")
            Sources.client.newBuilder().readTimeout(30, java.util.concurrent.TimeUnit.SECONDS).build().newCall(rb.build()).execute().use { resp ->
                if (!resp.isSuccessful) error("HTTP ${resp.code}")
                if (have > 0 && resp.code != 206) { part.delete(); have = 0 }
                val body = resp.body ?: error("Empty response")
                val total = body.contentLength().let { if (it > 0) it + have else 0L }
                val mime = body.contentType()?.toString().orEmpty()
                RandomAccessFile(part, "rw").use { raf ->
                    raf.seek(have)
                    val buf = ByteArray(32 * 1024)
                    var got = have
                    var lastUi = 0L
                    body.byteStream().use { ins ->
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = ins.read(buf)
                            if (n < 0) break
                            raf.write(buf, 0, n)
                            got += n
                            val now = System.currentTimeMillis()
                            if (now - lastUi > 200) {
                                lastUi = now
                                patch(job.id) { it.copy(received = got, total = total) }
                            }
                        }
                    }
                    patch(job.id) { it.copy(received = got, total = total) }
                }
                finish(job, part, mime, video)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            patch(job.id) { it.copy(status = JobStatus.ERROR, error = e.message ?: "Download failed") }
        } finally {
            running.remove(job.id)
            withContext(NonCancellable + Dispatchers.Main) { pump() }
        }
    }

    private fun finish(job: DownloadJob, part: File, mime: String, video: Boolean) {
        val base = safe("${job.track.artist} - ${job.track.title}")
        val srcExt = when {
            video -> "mp4"
            mime.contains("webm") -> "webm"
            mime.contains("mpeg") -> "mp3"
            else -> "m4a"
        }
        var out = File(dir, "$base.${job.quality}.$srcExt")
        part.renameTo(out)
        if (!video && srcExt != "mp3") {
            val ffmpeg = File(app.applicationInfo.nativeLibraryDir, "libffmpeg.so")
            if (ffmpeg.exists() && ffmpeg.canExecute()) {
                patch(job.id) { it.copy(status = JobStatus.CONVERTING) }
                val mp3 = File(dir, "$base.${job.quality}.mp3")
                val ok = runCatching {
                    val p = ProcessBuilder(ffmpeg.absolutePath, "-y", "-i", out.absolutePath, "-vn", "-b:a", "${job.quality}k", mp3.absolutePath)
                        .redirectErrorStream(true).start()
                    p.inputStream.readBytes()
                    p.waitFor() == 0 && mp3.exists() && mp3.length() > 0
                }.getOrDefault(false)
                if (ok) {
                    out.delete()
                    out = mp3
                } else {
                    mp3.delete() // keep the original container on conversion failure
                }
            }
        }
        Graph.library.addDownload(DownloadedTrack(job.track, job.quality, out.absolutePath, out.length()))
        patch(job.id) { it.copy(status = JobStatus.DONE, received = out.length(), total = out.length()) }
    }
}
