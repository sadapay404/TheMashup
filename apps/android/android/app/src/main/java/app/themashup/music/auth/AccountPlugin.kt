package app.themashup.music.auth

import android.app.Dialog
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import app.themashup.music.playback.NativeEvents
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Google sign-in — the mechanism that actually works (Phase 1, Amendment A-1).
 *
 * We do NOT use OAuth device-code: its token exchange requires a client_secret, which cannot ship in
 * a public app. Instead we host Google's own sign-in page in a WebView and read the resulting
 * `music.youtube.com` cookies, exactly as InnerTune/OuterTune do. The cookie is then stored in
 * EncryptedSharedPreferences (Keystore-backed) and used to sign InnerTube requests with SAPISIDHASH
 * from the JS layer.
 *
 * Security notes that are actually implemented:
 *  - the WebView has JavaScript + DOM storage ON (Google requires it) but file access OFF
 *  - cookies are only read for the exact https://music.youtube.com origin
 *  - nothing leaves the device; there is no server to leak to
 */
@CapacitorPlugin(name = "MashupAccount")
class AccountPlugin : Plugin() {

    private var webView: WebView? = null

    // Capacitor's Plugin exposes Java accessors (`getContext()`), not Kotlin properties, so
    // `context` would not resolve. Read them lazily, after the bridge is attached.
    private val store by lazy { SecureStore(getContext()) }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.reject("no activity")
            return
        }

        activity.runOnUiThread {
            // A WebView that is not attached to a window never paints, so the user would see
            // nothing and the flow would be dead. It goes in a dialog that we can dismiss when the
            // cookie is captured or the user backs out.
            val wv = WebView(activity)
            wv.settings.javaScriptEnabled = true
            wv.settings.domStorageEnabled = true
            wv.settings.allowFileAccess = false
            wv.settings.allowContentAccess = false
            wv.settings.userAgentString = USER_AGENT

            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    // Google bounces through youtube.com before the music origin. Watching only the
                    // music origin meant this never fired — the cookie exists before that hop.
                    val finished = url ?: return
                    val onGoogleVideo = finished.startsWith("https://www.youtube.com") ||
                        finished.startsWith("https://music.youtube.com") ||
                        finished.startsWith("https://accounts.google.com")
                    if (onGoogleVideo) {
                        if (finished.startsWith("https://music.youtube.com")) {
                            view.evaluateJavascript("window.yt && yt.config_ && yt.config_.VISITOR_DATA") { v ->
                                val visitor = v?.trim('"')?.takeIf { it.isNotBlank() && it != "null" }
                                if (visitor != null) store.putVisitorData(visitor)
                            }
                        }
                        val cookie = CookieManager.getInstance().getCookie("https://music.youtube.com")
                        // Only finish on a YouTube page: the Google login form can transiently expose
                        // an unrelated SAPISID cookie, and tearing the WebView down there aborts the
                        // sign-in the user is still typing into.
                        if (cookie != null && cookie.contains("SAPISID") && !finished.startsWith("https://accounts.google.com")) {
                            store.putCookie(cookie)
                            CookieManager.getInstance().flush()
                            NativeEvents.post("accountSignedIn", mapOf("hasCookie" to true))
                            AccountHost.dismiss()
                            webView = null
                        }
                    }
                }
            }

            val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
            dialog.setContentView(wv)
            dialog.setOnDismissListener {
                if (webView === wv) {
                    webView = null
                    AccountHost.clear()
                }
                wv.destroy()
            }
            dialog.show()

            wv.loadUrl(SIGN_IN_URL)
            webView = wv
            AccountHost.attach(wv)
            AccountHost.dialog = dialog
            NativeEvents.post("accountWebViewReady", null)

            // Resolve only now: the WebView exists and is loading, which is what `started` claims.
            call.resolve(JSObject().put("started", true))
        }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val cookie = store.cookie()
        call.resolve(
            JSObject()
                .put("signedIn", cookie != null && cookie.contains("SAPISID"))
                .put("visitorData", store.visitorData()),
        )
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        // Dialog.dismiss() is not thread-safe; plugin methods may be invoked off the main thread.
        getActivity()?.runOnUiThread { AccountHost.dismiss() }
        store.clear()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        NativeEvents.post("accountSignedOut", null)
        call.resolve()
    }

    /** One-shot read used at boot so the JS layer can rehydrate its session. */
    @PluginMethod
    fun cookie(call: PluginCall) {
        call.resolve(JSObject().put("cookie", store.cookie() ?: ""))
    }

    companion object {
        /**
         * `ltmpl=music` renders the phone-friendly music flow; `continue` returns to the music origin
         * so `onPageFinished` can harvest cookies immediately.
         */
        const val SIGN_IN_URL =
            "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=" +
                "https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D" +
                "https%253A%252F%252Fmusic.youtube.com%252F"

        const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/130.0.0.0 Mobile Safari/537.36"
    }
}

/**
 * Owns the sign-in surface so the plugin does not have to track both a WebView and a Dialog.
 * All calls are main-thread; the plugin only ever touches this from `runOnUiThread`.
 */
object AccountHost {
    private var view: WebView? = null
    internal var dialog: Dialog? = null

    fun attach(v: WebView) {
        view = v
    }

    fun current(): WebView? = view

    /** Close the sign-in UI. Safe to call when nothing is showing. */
    fun dismiss() {
        try {
            dialog?.dismiss()
        } catch (_: Throwable) {
            // Already dismissed or the activity is finishing.
        }
        dialog = null
        view = null
    }

    fun clear() = dismiss()
}

/** Uri helper kept for lint-safety (avoid string-concat URLs in new code). */
internal fun musicOrigin(path: String = ""): Uri = Uri.parse("https://music.youtube.com$path")
