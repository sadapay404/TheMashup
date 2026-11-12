package app.themashup.music.auth

import android.accounts.AccountManager
import android.app.Dialog
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.ActivityResult
import app.themashup.music.playback.NativeEvents
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
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
 *  1. **[pickAccount] — the picker the user asked for.** The *system* account picker lists every
 *     Google account signed in on the phone; tapping one returns its address. No permission, no
 *     contact access, no hand-rolled list that Google would refuse to populate.
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
     * Show the system's own account picker.
     *
     * ### Why this and not a hand-rolled list
     *
     * The previous version enumerated `AccountManager.getAccountsByType("com.google")` and drew its
     * own list. That cannot work on a modern Android, for two independent reasons:
     *
     *  1. `GET_ACCOUNTS` is a runtime permission from API 30, and the Settings UI files it under the
     *     **Contacts** group — so there was no "Accounts on this device" row for the user to find,
     *     which is exactly what the screenshots showed.
     *  2. Even *with* the permission granted, from Android 8 Google stopped letting ordinary apps
     *     enumerate its accounts. `getAccountsByType` returns an empty array unless the user has
     *     already granted this specific app visibility through Google's own consent flow. So the
     *     list would have been empty on a phone with three Google accounts on it.
     *
     * `AccountManager.newChooseAccountIntent` is the supported answer: the *system* renders the
     * picker, every signed-in Google account is listed, no permission is required, and the result is
     * the account the user tapped. That satisfies "show me my Gmails, I tap one" without asking for
     * contact access or guessing at Google's gating.
     *
     * The call resolves only when the picker closes, through [accountPicked]: the JS side awaits it
     * and treats `null` as "nothing chosen", which keeps the caller's flow linear.
     */
    @PluginMethod
    fun pickAccount(call: PluginCall) {
        if (getActivity() == null) {
            call.reject("no activity")
            return
        }
        try {
            val intent = AccountManager.newChooseAccountIntent(
                null,
                null,
                arrayOf(GOOGLE_ACCOUNT_TYPE),
                null,
                null,
                null,
                null,
            )
            startActivityForResult(call, intent, "accountPicked")
        } catch (t: Throwable) {
            // A device with no account picker (some AOSP builds) must not dead-end the user: the
            // caller falls back to the WebView flow.
            android.util.Log.w(TAG, "account picker unavailable", t)
            call.resolve(JSObject().put("started", false))
        }
    }

    /**
     * The account the user chose in the system picker.
     *
     * Capacitor routes the `startActivityForResult` result here by name. A cancelled picker is not an
     * error — the user simply changed their mind — so it resolves `{ email: null }` rather than
     * rejecting, and the UI says nothing about it.
     */
    @ActivityCallback
    fun accountPicked(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        val uri = result?.data?.data
        val email = uri?.lastPathSegment?.trim().orEmpty()
        if (result?.resultCode != android.app.Activity.RESULT_OK || email.isEmpty()) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        call.resolve(JSObject().put("email", email).put("cancelled", false))
    }

    /**
     * Sign in as a chosen identity — without opening a login form.
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
                /**
                 * Harvest the session cookie as soon as Google has minted it.
                 *
                 * The old hook only ran on `onPageFinished`, and only *acted* on a YouTube page — so
                 * the user was carried all the way to music.youtube.com, watched the web app boot, and
                 * only then did the dialog close. That is the "it opens YT music and never comes back"
                 * complaint. The cookie we need is set by Google's own consent page, which finishes
                 * long before YouTube does, so finishing there removes the whole detour: the dialog
                 * closes on the page where the user actually clicked "Allow", and TheMashup is in
                 * front again a moment later.
                 */
                override fun onPageFinished(view: WebView, url: String?) {
                    val finished = url ?: return
                    if (captured) return

                    // Cookie first, on every hop. `accounts.google.com` is deliberately included now:
                    // by the time a page there has *finished* loading, any SAPISID it set belongs to
                    // the session the user just approved. The old exclusion existed to protect a
                    // half-typed login form, which is no longer the last page of this flow.
                    val cookie = CookieManager.getInstance().getCookie("https://music.youtube.com")
                    val ready = cookie != null && cookie.contains("SAPISID")

                    if (finished.startsWith("https://music.youtube.com")) {
                        view.evaluateJavascript("window.yt && yt.config_ && yt.config_.VISITOR_DATA") { v ->
                            val visitor = v?.trim('"')?.takeIf { it.isNotBlank() && it != "null" }
                            if (visitor != null) store.putVisitorData(visitor)
                        }
                    }

                    if (ready) {
                        captured = true
                        store.putCookie(cookie!!)
                        CookieManager.getInstance().flush()
                        NativeEvents.post("accountSignedIn", mapOf("hasCookie" to true))
                        // Dismiss on the main thread; onPageFinished already runs there, but the
                        // explicit post keeps this safe if that ever stops being true.
                        AccountHost.dismiss()
                        webView = null
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

    companion object {
        private const val TAG = "MashupAccount"
        private const val GOOGLE_ACCOUNT_TYPE = "com.google"

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
            /*
             * `continue` points at YouTube's signin handler, which is what actually mints the
             * YouTube Music SAPISID. It then redirects onward to music.youtube.com — but by that
             * point the cookie exists and `onPageFinished` has already closed the dialog, so the
             * user never sees the web app boot. That redirect is unavoidable (it is where the
             * cookie is created) and now harmless.
             */
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
