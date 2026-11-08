package app.themashup.music

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.themashup.music.extractor.Extractor
import com.getcapacitor.BridgeActivity

/**
 * The only Activity. Responsibilities kept deliberately small:
 *  - register native plugins before the bridge loads
 *  - request POST_NOTIFICATIONS once (media notification is useless without it)
 *  - start the playback service so a media session exists before the first play
 *  - handle headphone/Bluetooth connect (resume affordance, E16)
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(app.themashup.music.playback.MashupPlayerPlugin::class.java)
        registerPlugin(app.themashup.music.download.DownloadPlugin::class.java)
        registerPlugin(app.themashup.music.auth.AccountPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Optional GPL extractor is only installed in the enhanced flavour at build time.
        Extractor.delegate = BuildConfigStreamExtractorDelegate.create()

        requestNotificationPermissionOnce()
    }

    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Media button presses arrive here when the activity is already alive.
        if (intent.action == Intent.ACTION_MEDIA_BUTTON) {
            handleMediaButton(intent)
        }
    }

    private fun handleMediaButton(intent: Intent) {
        // Let Media3's MediaButtonReceiver take it; we just re-broadcast if we swallowed it.
        try {
            sendBroadcast(intent)
        } catch (_: Throwable) {
            // Never crash on a malformed media-button intent from a third-party headset app.
        }
    }

    private companion object {
        const val REQ_NOTIF = 1001
    }
}

/**
 * Build-time seam for ADR-005.
 *
 * `standard` flavour → returns null (no GPL code in the APK).
 * `withNativeExtractor` flavour → generated source returns the NewPipe-backed implementation.
 * Both variants are produced by the build script; this file never imports GPL code directly.
 */
object BuildConfigStreamExtractorDelegate {
    fun create(): app.themashup.music.extractor.StreamExtractor? {
        return try {
            val cls = Class.forName("app.themashup.music.extractor.generated.NativeExtractorImpl")
            cls.getDeclaredConstructor().newInstance() as? app.themashup.music.extractor.StreamExtractor
        } catch (_: ClassNotFoundException) {
            null
        } catch (_: Throwable) {
            null
        }
    }
}
