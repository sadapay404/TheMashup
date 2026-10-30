package local.themashup.music.core.download

import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** First-run ffmpeg lifecycle — shown by the consent sheet + header chip. */
sealed interface FfmpegState {
    /** Binary not detected yet (wrong ABI build, or probe not run). */
    data object Missing : FfmpegState

    /** Legacy states kept so existing sheet UI compiles — no network fetch. */
    data class Downloading(val bytesRead: Long, val totalBytes: Long) : FfmpegState

    /** Verifying the bundled executable (`-version` probe) — sheet spinner. */
    data object Extracting : FfmpegState

    /** Binary on disk and `-version` probe passed — transcode enabled. */
    data object Ready : FfmpegState

    data class Failed(val message: String) : FfmpegState
}

/**
 * N9 — ffmpeg is BUNDLED into the APK ("just bundle the ffmpeg"): CI builds a
 * static per-ABI executable with Javernaut/ffmpeg-android-maker (the same
 * method the linked FOSS players use) and ships it as
 * `jniLibs/<abi>/libffmpeg.so`. The package manager installs it into
 * [nativeLibraryDir] — read-only + executable, so execve() works on every
 * Android version (files under writable app data are not executable since
 * Android 10).
 *
 * Replaces the BtbN `linuxarm64` tarball, which was a glibc build that can
 * never run on Android (bionic) — the "downloads but fails to bundle" bug.
 */
class FfmpegManager(
    private val nativeLibraryDir: File,
) {
    companion object {
        /** Executable name inside `src/main/jniLibs/<abi>/`. */
        const val LIB_NAME = "libffmpeg.so"
    }

    private val binary = File(nativeLibraryDir, LIB_NAME)
    private val mutex = Mutex()

    private val _status = MutableStateFlow<FfmpegState>(FfmpegState.Extracting)
    val status: StateFlow<FfmpegState> = _status

    init {
        // Never execute an external process on the UI thread during app startup.
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            mutex.withLock {
                _status.value = when {
                    !binary.isFile -> FfmpegState.Missing
                    probe() -> FfmpegState.Ready
                    else -> FfmpegState.Failed("bundled ffmpeg failed to run on this device")
                }
            }
        }
    }

    /** Absolute path when ready — null while missing/verifying/failed. */
    fun binaryPath(): String? =
        if (_status.value == FfmpegState.Ready && binary.isFile) binary.absolutePath else null

    /**
     * Verify the bundled binary; concurrent callers share the same run.
     * Kept under the original name so the consent-sheet accept flow works —
     * there is no download anymore, so a Ready device never asks at all.
     * true → [FfmpegState.Ready].
     */
    suspend fun fetch(): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            when (_status.value) {
                FfmpegState.Ready -> return@withContext true
                is FfmpegState.Downloading, FfmpegState.Extracting ->
                    return@withContext _status.value == FfmpegState.Ready
                else -> Unit
            }
            _status.value = FfmpegState.Extracting // sheet shows "Verifying…"
            if (!binary.isFile) {
                _status.value = FfmpegState.Failed(
                    "ffmpeg is not bundled for this device ABI (${nativeLibraryDir.name})",
                )
                return@withContext false
            }
            if (probe()) {
                _status.value = FfmpegState.Ready
                true
            } else {
                _status.value = FfmpegState.Failed("bundled ffmpeg failed -version probe")
                false
            }
        }
    }

    /** Executes `ffmpeg -version` (0 exit → the binary actually runs here). */
    private fun probe(): Boolean = try {
        val p = ProcessBuilder(binary.absolutePath, "-version")
            .redirectErrorStream(true)
            .apply { environment()["LD_LIBRARY_PATH"] = nativeLibraryDir.absolutePath }
            .start()
        val done = p.waitFor(8, TimeUnit.SECONDS)
        if (!done) p.destroyForcibly()
        done && p.exitValue() == 0
    } catch (_: Exception) {
        false
    }
}
