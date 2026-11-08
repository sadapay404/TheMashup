package app.themashup.music.auth

import android.annotation.SuppressLint
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

    private val store by lazy { SecureStore(context) }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val activity = activity ?: run {
            call.reject("no activity")
            return
        }
        activity.runOnUiThread {
            val wv = WebView(activity)
            wv.settings.javaScriptEnabled = true
            wv.settings.domStorageEnabled = true
            wv.settings.allowFileAccess = false
            wv.settings.allowContentAccess = false
            wv.settings.userAgentString = USER_AGENT

            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    // Capture visitorData from the page config once we land on the music origin.
                    if (url?.startsWith("https://music.youtube.com") == true) {
                        view.evaluateJavascript("window.yt && yt.config_ && yt.config_.VISITOR_DATA") { v ->
                            val visitor = v?.trim('"')?.takeIf { it.isNotBlank() && it != "null" }
                            if (visitor != null) store.putVisitorData(visitor)
                        }
                        val cookie = CookieManager.getInstance().getCookie("https://music.youtube.com")
                        if (cookie != null && cookie.contains("SAPISID")) {
                            store.putCookie(cookie)
                            NativeEvents.post("accountSignedIn", mapOf("hasCookie" to true))
                            view.destroy()
                            webView = null
                        }
                    }
                }
            }

            wv.loadUrl(SIGN_IN_URL)
            webView = wv
            // The activity shows this via a full-screen dialog; the plugin exposes it through the event.
            NativeEvents.post("accountWebViewReady", null)
            AccountHost.attach(wv)
        }
        call.resolve(JSObject().put("started", true))
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun defaultUserAgent(): String = CookieManager.getInstance().getCookie("https://music.youtube.com") ?: ""

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

/** Bridges the WebView into an AndroidView/Compose or a plain FrameLayout host. */
object AccountHost {
    private var view: WebView? = null
    fun attach(v: WebView) {
        view = v
    }
    fun current(): WebView? = view
    fun clear() {
        view?.destroy()
        view = null
    }
}

/** Uri helper kept for lint-safety (avoid string-concat URLs in new code). */
internal fun musicOrigin(path: String = ""): Uri = Uri.parse("https://music.youtube.com$path")
