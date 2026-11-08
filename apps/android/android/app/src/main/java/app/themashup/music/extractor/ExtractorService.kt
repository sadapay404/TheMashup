package app.themashup.music.extractor

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Stream-resolution fallback — ADR-005.
 *
 * The default (standard) build flavour ships WITHOUT any GPL extractor. This service is a port with a
 * pure-Kotlin InnerTube fallback that:
 *   1. asks the JS layer to try the token-free profiles (VISIONOS/TVHTML5/ANDROID/IOS),
 *   2. if all fail, resolves through the public API ladder,
 *   3. only in the `withNativeExtractor` flavour does it delegate to NewPipe Extractor.
 *
 * Keeping this behind an interface is what lets the default APK stay licence-clean while the optional
 * flavour can be built by anyone who wants it. See docs/03-OSS-HARVEST.md §4.
 */
class ExtractorService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val videoId = intent?.getStringExtra(EXTRA_VIDEO_ID) ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        scope.launch {
            try {
                val url = Extractor.resolveStreamUrl(videoId)
                Log.i(TAG, "resolved $videoId -> ${if (url != null) "ok" else "failed"}")
                app.themashup.music.playback.NativeEvents.post(
                    "extractorResult",
                    mapOf("videoId" to videoId, "url" to url),
                )
            } catch (t: Throwable) {
                Log.w(TAG, "extractor failed for $videoId", t)
                app.themashup.music.playback.NativeEvents.post(
                    "extractorResult",
                    mapOf("videoId" to videoId, "url" to null, "error" to (t.message ?: "unknown")),
                )
            } finally {
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MashupExtractor"
        const val EXTRA_VIDEO_ID = "videoId"
    }
}

/**
 * Pluggable resolution strategy. `NativeExtractor` (below) is the *only* GPL-touching seam, and it is
 * compiled out of the standard flavour via a build flag (see build.gradle.kts `withNativeExtractor`).
 */
interface StreamExtractor {
    suspend fun resolve(videoId: String): String?
}

object Extractor {
    /**
     * Set at app start. In the standard flavour this stays null and the JS ladder is authoritative.
     * In the `withNativeExtractor` flavour MainActivity installs [NativeExtractor].
     */
    @Volatile
    var delegate: StreamExtractor? = null

    suspend fun resolveStreamUrl(videoId: String): String? = delegate?.resolve(videoId)
}
