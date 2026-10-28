package local.themashup.music.core.download

import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import local.themashup.music.core.download.logic.TarArchive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.tukaani.xz.XZInputStream

/** First-run ffmpeg lifecycle — shown by the consent sheet + header chip. */
sealed interface FfmpegState {
    /** No binary yet (slim APK — nothing fetched at install time). */
    data object Missing : FfmpegState

    /** Streaming the pinned GitHub asset; [bytesRead]/[totalBytes] (-1 unknown). */
    data class Downloading(val bytesRead: Long, val totalBytes: Long) : FfmpegState

    /** tar.xz received — unpacking the single binary member. */
    data object Extracting : FfmpegState

    /** Binary on disk and `-version` probe passed — transcode enabled. */
    data object Ready : FfmpegState

    data class Failed(val message: String) : FfmpegState
}

/**
 * One-time ffmpeg fetch (docs/ANDROID.md N7): pinned BtbN/FFmpeg-Builds
 * linuxarm64 tar.xz → [filesDir]/ffmpeg/bin/ffmpeg, cached across runs.
 *
 * Pin note: the blueprint's n9.0 arm64 asset was not published on the live
 * release feed at authoring time → n8.1 (same family/size class, stable
 * branch). Swap [FFMPEG_URL] if the feed changes; failures are surfaced as
 * [FfmpegState.Failed] with the HTTP reason.
 */
class FfmpegManager(
    private val client: OkHttpClient,
    private val filesDir: File,
) {
    companion object {
        const val FFMPEG_URL =
            "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/" +
                "ffmpeg-n8.1-latest-linuxarm64-gpl-8.1.tar.xz"

        /** Archive member suffix to extract (archives root a versioned folder). */
        const val MEMBER_SUFFIX = "bin/ffmpeg"
    }

    private val binary = File(filesDir, "ffmpeg/bin/ffmpeg")
    private val archive = File(filesDir, "ffmpeg-fetch.tar.xz")
    private val mutex = Mutex()

    private val _status = MutableStateFlow<FfmpegState>(
        if (binary.isFile && binary.canExecute() && probe()) FfmpegState.Ready else FfmpegState.Missing,
    )
    val status: StateFlow<FfmpegState> = _status

    /** Absolute path when ready — null while missing/downloading/failed. */
    fun binaryPath(): String? =
        if (_status.value == FfmpegState.Ready && binary.isFile) binary.absolutePath else null

    /**
     * Download + extract + probe exactly once; concurrent callers share the
     * same run. true → [FfmpegState.Ready].
     */
    suspend fun fetch(): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            when (_status.value) {
                FfmpegState.Ready -> return@withContext true
                is FfmpegState.Downloading, FfmpegState.Extracting ->
                    return@withContext _status.value == FfmpegState.Ready
                else -> Unit
            }
            try {
                downloadArchive()
                _status.value = FfmpegState.Extracting
                binary.parentFile?.mkdirs()
                XZInputStream(archive.inputStream().buffered()).use { xz ->
                    if (!TarArchive.extract(xz, binary, MEMBER_SUFFIX)) {
                        throw IllegalStateException("ffmpeg member missing from archive")
                    }
                }
                archive.delete()
                binary.setExecutable(true, false)
                if (!probe()) throw IllegalStateException("binary failed -version probe")
                _status.value = FfmpegState.Ready
                true
            } catch (e: Exception) {
                archive.delete()
                _status.value = FfmpegState.Failed(e.message ?: e.javaClass.simpleName)
                false
            }
        }
    }

    private fun downloadArchive() {
        val req = Request.Builder().url(FFMPEG_URL).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("HTTP ${resp.code} fetching ffmpeg")
            val body = resp.body ?: throw IllegalStateException("empty ffmpeg response")
            val total = body.contentLength() // -1 when unknown
            var got = 0L
            var lastEmit = 0L
            body.byteStream().use { input ->
                archive.outputStream().buffered().use { out ->
                    val buf = ByteArray(128 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 250) {
                            _status.value = FfmpegState.Downloading(got, total)
                            lastEmit = now
                        }
                    }
                    out.flush()
                }
            }
            _status.value = FfmpegState.Downloading(got, if (total > 0) total else got)
        }
    }

    /** Executes `ffmpeg -version` (0 exit → the binary actually runs here). */
    private fun probe(): Boolean = try {
        val p = ProcessBuilder(binary.absolutePath, "-version")
            .redirectErrorStream(true)
            .start()
        val done = p.waitFor(8, TimeUnit.SECONDS)
        if (!done) p.destroyForcibly()
        done && p.exitValue() == 0
    } catch (_: Exception) {
        false
    }
}
