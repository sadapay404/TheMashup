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
import java.util.concurrent.atomic.AtomicBoolean

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

        // Initialise the native extractor's PoToken generator with this Activity's Context so its
        // hidden WebView can be created. Reflection keeps the standard flavour free of any reference
        // to the GPL class — if the class doesn't exist, this is a no-op.
        try {
            Class.forName("app.themashup.music.extractor.generated.NativeExtractorImpl")
                .getMethod("initialize", android.content.Context::class.java)
                .invoke(null, this@MainActivity)
        } catch (_: Throwable) {
            // Not the withNativeExtractor flavour, or initialize missing — the JS ladder remains authoritative.
        }

        // The notification permission is requested in onResume, not here: see the note on
        // requestNotificationPermissionOnce for why asking this early silently does nothing.
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

    /**
     * Ask for POST_NOTIFICATIONS — once, and only when the activity is actually in front.
     *
     * This used to be called from `onCreate`. On API 33+ a permission request made before the
     * activity is resumed is dropped by the system without a dialog and without an error, so the
     * notification permission was never granted and the media notification never appeared. The
     * request has to happen in `onResume`, after the first frame.
     */
    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (notifPermissionAsked) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) return
        notifPermissionAsked = true
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIF) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            LogPlugin.boot("notifications: ${if (granted) "granted" else "denied by user"}")
        }
    }

    override fun onResume() {
        super.onResume()
        // Deferred by one frame: the permission dialog cannot attach to a window that has not drawn.
        window.decorView.post { requestNotificationPermissionOnce() }
    }

    override fun onNewIntent(intent: Intent) {
        // BridgeActivity forwards to the bridge (which the WebView event system needs); it is a
        // protected method, so the override must stay `protected` too.
        super.onNewIntent(intent)
        // Media3's MediaButtonReceiver already delivers media keys to the session. Re-broadcasting
        // here (as an earlier version did) would loop the intent back into the receiver forever.
    }

    /**
     * Hardware back.
     *
     * The web layer owns the navigation stack, so it decides first: it closes an open sheet or steps
     * back through visited pages. Only when it reports nothing left to do does the activity finish.
     *
     * The previous build simply finished the activity from Home, so backing out of Settings closed
     * the app instead of returning to the page before it.
     */
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val web = bridge
        if (web == null) {
            // The bridge never came up, so nothing on the web side can be holding state.
            super.onBackPressed()
            return
        }

        // One finish per press, whichever path gets there first.
        val settled = AtomicBoolean(false)
        val finishOnce = Runnable { if (settled.compareAndSet(false, true)) finish() }

        // `Bridge.eval` wraps the WebView call and marshals it onto the main thread itself; the
        // WebView's own `evaluateJavascript` is not part of the bridge's public surface.
        //
        // The callback receives the JSON-ish string the WebView produces, so a JS `true` arrives
        // as "true". Anything else — "false", "null", "" — means the web layer has nothing left to
        // step back to, and finishing is the correct answer.
        web.eval("window.__mashupBack && window.__mashupBack()") { result: String? ->
            if (result == "true") {
                // The web layer consumed the press. Mark the gesture settled so the timeout below
                // cannot then finish the activity out from under it.
                //
                // This was the bug behind "back goes back, then the app closes": `settled` was only
                // ever written inside `finishOnce`, so a *successful* web-side back left it false and
                // the 900 ms fallback fired regardless, closing the app a beat after it had
                // correctly navigated.
                settled.set(true)
            } else {
                runOnUiThread(finishOnce)
            }
        }

        // A press before the page finished loading has no handler installed yet, and the callback may
        // never arrive at all — without this the press is silently swallowed and the app has no way
        // out. Skewed long so a slow device still gets its chance to answer: a late arrival means a
        // sluggish back press, an early one would mean the app quitting from a page that had
        // somewhere to go.
        window.decorView.postDelayed({ if (!settled.get()) runOnUiThread(finishOnce) }, 900)
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

    /** Set the first time we ask, so a denial is not re-prompted on every resume. */
    private var notifPermissionAsked = false

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
