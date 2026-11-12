package app.themashup.music.auth

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Dialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import app.themashup.music.playback.NativeEvents
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Google sign-in — two paths, and an honest account of what each can do.
 *
 * ## Why a plain "Sign in with Google" button cannot be enough here
 *
 * This app has no backend. A real Google Sign-In yields an OAuth **token**, and turning that token
 * into a YouTube Music session requires a Web client ID plus the app's signing SHA-1 to be registered
 * in a Google Cloud project. That registration does not exist for this build, and it cannot be
 * invented on the device. Shipping a button that *pretends* to do it is worse than shipping none.
 *
 * What the app actually needs is not a token — it is the `music.youtube.com` session cookie, because
 * every InnerTube request is signed from it with SAPISIDHASH. So there are two ways to obtain one:
 *
 *  1. **[accounts] — the picker the user asked for.** Enumerate the Google accounts already on the
 *     device with `AccountManager` and show them as a list. Picking one signs in against that identity
 *     with no typing and no "which account?" Google page. On API 30+ this only returns accounts the
 *     user has already granted to this app (`GET_ACCOUNTS` is a runtime permission from 30 onward),
 *     which is what makes the list short and correct rather than a dump of everything on the phone.
 *
 *  2. **[signIn] — the fallback.** If the picker finds nothing, the WebView flow runs exactly as
 *     before. It is slower and it is the one the user called "opens the YT Music website in a
 *     container", so it is now the *fallback*, not the default.
 *
 * Both paths end in the same place: a cookie in [SecureStore], used to sign InnerTube requests with
 * SAPISIDHASH from the JS layer.
 *
 * ## The "sign in, then back closes it" bug
 *
 * The old flow opened Google's login page and watched `onPageFinished`. Pressing back dismissed the
 * dialog, and because nothing had captured a cookie yet, the result was a silent no-op: the button
 * looked broken. The picker path removes the page entirely for its case, and [signIn] now reports a
 * real reason on dismissal instead of leaving the caller polling into a void.
 *
 * Security notes that are actually implemented:
 *  - the WebView has JavaScript + DOM storage ON (Google requires it) but file access OFF
 *  - cookies are only read for the exact https://music.youtube.com origin
 *  - account enumeration is guarded, permission-checked, and never sends anything off the device
 *  - nothing leaves the device; there is no server to leak to
 */
@CapacitorPlugin(name = "MashupAccount")
class AccountPlugin : Plugin() {

    private var webView: WebView? = null

    // Capacitor's Plugin exposes Java accessors (`getContext()`), not Kotlin properties, so
    // `context` would not resolve. Read them lazily, after the bridge is attached.
    private val store by lazy { SecureStore(getContext()) }

    /**
     * The Google accounts already signed in on this device.
     *
     * This is the whole point of the picker: the user should not have to type a password into a
     * WebView that then strands them on google.com. `AccountManager` knows which identities the phone
     * already trusts, so the app can offer them and sign in as one of them.
     *
     * ### Why the result can legitimately be empty
     *
     * From API 30, `GET_ACCOUNTS` is a runtime permission and `getAccountsByType("com.google")`
     * returns only accounts this app has been **granted** — a deliberate privacy change, not a bug.
     * The caller therefore treats an empty list as "ask for the WebView fallback", never as an error.
     * `getAccountsByTypeAndFeatures` with the `service_yt` feature additionally excludes accounts that
     * do not have YouTube provisioned at all, which is the vast majority of work profiles.
     */
    @PluginMethod
    fun accounts(call: PluginCall) {
        val ctx = getContext()
        val result = JSObject()

        if (!hasAccountsPermission()) {
            // Not a failure: the JS layer asks for the permission and calls again.
            result.put("accounts", JSArray())
            result.put("needsPermission", true)
            call.resolve(result)
            return
        }

        val list = JSArray()
        try {
            val am = AccountManager.get(ctx)
            // `service_yt` = the account has YouTube provisioned. Requesting it here is what keeps
            // a corporate/exchange Google account (which exists, but has no YouTube) out of the list.
            val found: Array<Account> = am.getAccountsByTypeAndFeatures(
                GOOGLE_ACCOUNT_TYPE,
                arrayOf(FEATURE_SERVICE_YT),
                null,
                null,
            )?.result ?: emptyArray()
            for (a in found) {
                list.put(
                    JSObject()
                        .put("name", a.name)
                        .put("type", a.type),
                )
            }
        } catch (t: Throwable) {
            // A device that refuses enumeration is entitled to: report the empty list so the JS layer
            // falls back to the WebView, instead of surfacing a scary native error for a lost cause.
            android.util.Log.w(TAG, "account enumeration failed", t)
        }

        result.put("accounts", list)
        result.put("needsPermission", false)
        call.resolve(result)
    }

    /**
     * Sign in as one of [accounts] — without opening a login page.
     *
     * The selected identity is baked into Google's *silent* sign-in URL (`passive=true` plus
     * `Email=`), so Google authenticates against the identity the phone already holds and redirects
     * straight back to the music origin. There is no password prompt, no account chooser, and no
     * chance of stranding the user on a Google page.
     *
     * "Silent" is not "invisible": Google may still want a consent tap the first time, so the WebView
     * remains the surface. It is simply *usually* one page that closes itself. If Google insists on
     * interaction, the user sees the normal account page — which is the same fallback as before, only
     * reached deliberately and pre-filled.
     */
    @PluginMethod
    fun signInAs(call: PluginCall) {
        val email = call.getString("email")?.trim().orEmpty()
        if (email.isEmpty()) {
            call.reject("email required")
            return
        }
        openSignIn(call, email)
    }

    @PluginMethod
    fun signIn(call: PluginCall) = openSignIn(call, email = null)

    /**
     * The WebView body, shared by [signIn] and [signInAs].
     *
     * [email] is null for the plain flow and set for a picked account. When set, it is threaded into
     * Google's silent endpoint so the flow authenticates as that identity instead of asking the user
     * to choose again inside the page.
     */
    private fun openSignIn(call: PluginCall, email: String?) {
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

            /*
             * A cookie captured once must not be captured twice: the hook below can fire on several
             * page loads, and re-posting `accountSignedIn` would make the JS layer re-run its whole
             * rehydrate for a session it already has.
             */
            var captured = false

            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    // Google bounces through youtube.com before the music origin. Watching only the
                    // music origin meant this never fired — the cookie exists before that hop.
                    val finished = url ?: return
                    if (captured) return
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
                            captured = true
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
                /*
                 * Back-out is now reported.
                 *
                 * The user's complaint was that pressing back "does not sign up" — the screen simply
                 * vanished and the button looked dead. A `signInDismissed` event lets the JS layer end
                 * its "Waiting for Google…" state immediately and say what happened, instead of
                 * polling for two minutes against a dialog that no longer exists.
                 */
                if (!captured) NativeEvents.post("signInDismissed", null)
            }
            dialog.show()

            wv.loadUrl(if (email.isNullOrBlank()) SIGN_IN_URL else silentSignInUrl(email))
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

    /**
     * Whether this process may enumerate accounts.
     *
     * Below API 30 `GET_ACCOUNTS` is granted at install time; from 30 it is a runtime permission the
     * user can refuse. Checked rather than assumed, because an unguarded call returns an empty list
     * and the picker would silently look empty on a device that actually has accounts.
     */
    private fun hasAccountsPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true
        return getContext().checkSelfPermission(android.Manifest.permission.GET_ACCOUNTS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    /** Ask for `GET_ACCOUNTS`; the JS layer calls `accounts` again when this returns. */
    @PluginMethod
    fun requestAccountsPermission(call: PluginCall) {
        if (hasAccountsPermission()) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        // The activity result route would need a `@Permission` alias and an annotation processor
        // round; a plain intent to the app's own settings page is smaller and cannot hang, which is
        // the failure mode this codebase has already been bitten by with alias-based requests.
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", getContext().packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            getContext().startActivity(intent)
            call.resolve(JSObject().put("granted", false).put("openedSettings", true))
        } catch (t: Throwable) {
            call.resolve(JSObject().put("granted", false).put("openedSettings", false))
        }
    }

    companion object {
        private const val TAG = "MashupAccount"
        private const val GOOGLE_ACCOUNT_TYPE = "com.google"
        private const val FEATURE_SERVICE_YT = "service_yt"

        /**
         * `ltmpl=music` renders the phone-friendly music flow; `continue` returns to the music origin
         * so `onPageFinished` can harvest cookies immediately.
         */
        const val SIGN_IN_URL =
            "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=" +
                "https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D" +
                "https%253A%252F%252Fmusic.youtube.com%252F"

        /**
         * Google's silent sign-in for a *known* identity.
         *
         * `passive=true` suppresses the interactive account chooser, and `Email=` names the account
         * the user picked from the device list. Google still owns the page — this does not forge a
         * token — but in the normal case it authenticates from the existing device session and
         * redirects straight back to `continue`, where `onPageFinished` harvests the cookie.
         */
        fun silentSignInUrl(email: String): String {
            val encoded = Uri.encode(email)
            return "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true" +
                "&Email=$encoded" +
                "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D" +
                "%252Fmusic.youtube.com"
        }

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
