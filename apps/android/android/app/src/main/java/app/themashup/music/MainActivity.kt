package app.themashup.music

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaSessionService
import app.themashup.music.diagnostics.LogPlugin
import app.themashup.music.extractor.Extractor
import app.themashup.music.playback.PlaybackService
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
        // Installed before anything else: the gap between process start and this method is where a
        // broken plugin registration would throw, and a handler installed later would miss it.
        // Order matters. The uncaught-exception handler goes on first, then a boot log that lands in
        // external storage - the only place a person with just the phone can read after a crash.
        LogPlugin.install(this)
        LogPlugin.startBootLog(this)
        LogPlugin.beginSession(this)

        registerPlugin(app.themashup.music.playback.MashupPlayerPlugin::class.java)
        registerPlugin(app.themashup.music.download.DownloadPlugin::class.java)
        registerPlugin(app.themashup.music.auth.AccountPlugin::class.java)
        registerPlugin(app.themashup.music.diagnostics.LogPlugin::class.java)
        LogPlugin.boot("plugins registered")
        super.onCreate(savedInstanceState)
        // Past this point the WebView exists. A log that stops before here means the bridge itself
        // failed; one that stops after means the failure is in the page or a service it touched.
        LogPlugin.boot("bridge created")

        // Optional GPL extractor is only installed in the enhanced flavour at build time.
        LogPlugin.boot("extractor: resolving")
        Extractor.delegate = BuildConfigStreamExtractorDelegate.create()
        LogPlugin.boot("extractor: resolved")

        LogPlugin.boot("requesting notification permission")
        requestNotificationPermissionOnce()
        LogPlugin.boot("binding playback service")
        preparePlaybackSession()
        LogPlugin.boot("boot complete")
    }

    /**
     * Start the media session service.
     *
     * CRITICAL: without this, `PlaybackBridge.player` is null and every play/pause call from the web
     * layer is a silent no-op. Starting it creates the MediaSession that Media3's MediaButtonReceiver
     * needs (otherwise a media key press throws IllegalStateException), so this is also what makes
     * lockscreen and headset controls work.
     *
     * `bindService` rather than `startService`: the service is a bound MediaSessionService, and
     * binding is what guarantees `onCreate` (and therefore our ExoPlayer) runs before the first play.
     */
    private fun preparePlaybackSession() {
        try {
            val intent = Intent(this, PlaybackService::class.java)
            // MediaSessionService requires this action when starting it from an activity.
            intent.action = MediaSessionService.SERVICE_INTERFACE
            bindService(intent, PlaybackService.connection, BIND_AUTO_CREATE)
        } catch (t: Throwable) {
            // A device that refuses the bind must not crash the app; playback falls back to the
            // WebView <audio> element, which the JS layer handles when the plugin reports no state.
            android.util.Log.w("MashupMain", "playback service unavailable", t)
        }
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
        // BridgeActivity forwards to the bridge (which the WebView event system needs); it is a
        // protected method, so the override must stay `protected` too.
        super.onNewIntent(intent)
        // Media3's MediaButtonReceiver already delivers media keys to the session. Re-broadcasting
        // here (as an earlier version did) would loop the intent back into the receiver forever.
    }

    override fun onDestroy() {
        // `isFinishing` separates a real exit from a configuration change or an activity that the
        // system reclaimed while the app stayed alive. Marking every onDestroy as clean would hide
        // the kills we are trying to detect.
        if (isFinishing) LogPlugin.endSession(this)
        try {
            unbindService(PlaybackService.connection)
        } catch (_: IllegalArgumentException) {
            // Never bound (the bind failed) — nothing to release.
        }
        super.onDestroy()
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
        } catch (_: Throwable) {
            // Covers ClassNotFoundException, LinkageError, a missing constructor, and a GPL class
            // that fails to initialise. One clause deliberately, because Kotlin forbids two.
            null
        }
    }
}
