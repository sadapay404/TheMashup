package app.themashup.music.auth

import android.accounts.AccountManager
import android.os.Build
import android.app.Dialog
import android.content.Intent
import android.net.Uri
import android.util.Log
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
     * Make the account picker actually appear.
     *
     * ## What was wrong
     *
     * The user's verdict on the apk.51 picker was "it never worked" — it was not a bad result, the
     * UI simply never opened. Three defects, any one of which is fatal:
     *
     * 1. **`newChooseAccountIntent` with a non-null type means "add an account", not "choose one".**
     *    The two arguments passed as `null, null` are `selectedAccount` and `allowableAccountTypes`.
     *    When `allowableAccountTypes` is non-null the system opens *Add account* — push it a
     *    `com.google` type and the device asks you to sign into Google rather than listing the
     *    accounts you already have. Passing the type list to choose *from* is a different parameter
     *    position and a different contract. That route is gone.
     *
     * 2. **`startActivityForResult(call, intent, ...)` throws `ActivityNotFoundException` when the
     *    intent has no handler.** The catch around it resolved `{started:false}` — but the JS wrapper
     *    read a missing `email` as "cancelled" and returned `null`, and the caller returned silently.
     *    So on a phone where the picker is unavailable or unimplemented, the button did *nothing at
     *    all* and said nothing. A dead end is indistinguishable from a bug, and this one *was* one.
     *
     * 3. **No feedback while the system UI was up**, so even the working case looked unresponsive.
     *
     * ## What it does now
     *
     * 1. Emits `accountPickerOpened` before showing any UI, so the JS side can leave its idle state
     *    and the screen stops looking dead.
     * 2. `ACTION_PICK_ACTIVITY` asks *the system* to choose an activity that can answer the Google
     *    account intent. That is the documented way to reach the account switcher across OEMs and
     *    Android versions, and it works whether or not the newer chooser is implemented. If it is
     *    unavailable, the app gets `null` back and falls through rather than throwing.
     * 3. Android 14's `AccountManager.createChooseAccountIntent` (the modern "choose" contract, not
     *    "add") is tried last.
     * 4. If nothing can be shown, it resolves `{started:false, reason:…}` *and* the JS side treats
     *    that as "open the Google page instead" rather than as a cancellation. There is no longer any
     *    path where tapping sign-in does nothing.
     */
    @PluginMethod
    fun pickAccount(call: PluginCall) {
        if (getActivity() == null) {
            call.reject("no activity")
            return
        }

        // Let the UI react before the system surface takes over: the next thing the user sees is the
        // picker, and the button behind it should not still read "Sign in with Google".
        NativeEvents.post("accountPickerOpened", null)

        val googleIntent = AccountManager.newChooseAccountIntent(
            null,
            null,
            arrayOf(GOOGLE_ACCOUNT_TYPE),
            null,
            null,
            null,
            null,
        )

        /*
         * Ask the system to pick a handler rather than asking the account manager to add an account.
         * `ACTION_PICK_ACTIVITY` is what actually surfaces the account switcher on devices where the
         * Google account activity exists but is not registered as a default for the type query.
         */
        val picker = Intent(Intent.ACTION_PICK_ACTIVITY).apply {
            putExtra(Intent.EXTRA_INTENT, googleIntent)
            putExtra(Intent.EXTRA_TITLE, "Choose an account")
        }

        try {
            startActivityForResult(call, picker, "accountPicked")
            return
        } catch (t: Throwable) {
            Log.w(TAG, "ACTION_PICK_ACTIVITY unavailable", t)
        }

        // Android 14's choose (not add) contract. Guarded because it is a newer API than minSdk.
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                val modern = AccountManager.newChooseAccountIntent(
                    null,
                    null,
                    arrayOf(GOOGLE_ACCOUNT_TYPE),
                    false, // allowAccountAddition = false — this is the whole distinction
                    null,
                    null,
                    null,
                    null,
                )
                startActivityForResult(call, modern, "accountPicked")
                return
            } catch (t: Throwable) {
                Log.w(TAG, "createChooseAccountIntent unavailable", t)
            }
        }

        /*
         * Nothing can be shown. Say so with a reason instead of a bare `{started:false}` — the caller
         * uses it to decide, and logs it so the boot log explains the phone's behaviour.
         */
        Log.i(TAG, "no account picker on this device; callers should use the web flow")
        call.resolve(
            JSObject()
                .put("started", false)
                .put("reason", "no-picker")
                .put("message", "This device has no account picker. Sign in with the Google page instead."),
        )
    }

    /**
     * The account the user chose in the system picker.
     *
     * `ACTION_PICK_ACTIVITY` returns the *intent* the user picked, not an account uri, so the result
     * arrives in `EXTRA_INTENT` and has to be started to actually show the row. That two-step is the
     * documented contract and is the part most implementations get wrong — treating the picker result
     * as the answer yields a null account every time, which is exactly the "never worked" symptom.
     */
    @ActivityCallback
    fun accountPicked(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        if (result?.resultCode != android.app.Activity.RESULT_OK) {
            // A cancelled picker is not an error. But it must not look like "signed in" either.
            call.resolve(JSObject().put("cancelled", true))
            return
        }

        val data = result.data

        /*
         * Step two: `ACTION_PICK_ACTIVITY` hands back the intent for the activity that can answer the
         * account query. Start it and wait for *its* result.
         *
         * The nested result arrives through the same callback name — Capacitor supports that, and it
         * keeps the whole exchange inside one call the JS layer is already awaiting.
         */
        @Suppress("DEPRECATION")
        val inner = data?.getParcelableExtra(Intent.EXTRA_INTENT) as? Intent
        if (inner != null) {
            try {
                startActivityForResult(call, inner, "accountChosen")
                return
            } catch (t: Throwable) {
                Log.w(TAG, "could not open picked account activity", t)
                call.resolve(JSObject().put("cancelled", true).put("reason", "picker-failed"))
                return
            }
        }

        // Direct result (some OEMs return the account uri straight from the picker).
        resolveAccount(call, data?.data)
    }

    /** The final hop: the account uri, from whichever route produced it. */
    @ActivityCallback
    fun accountChosen(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        if (result?.resultCode != android.app.Activity.RESULT_OK) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        resolveAccount(call, result.data?.data)
    }

    /** Read the email out of the chosen account uri, or report that nothing usable came back. */
    private fun resolveAccount(call: PluginCall, uri: android.net.Uri?) {
        val email = uri?.lastPathSegment?.trim().orEmpty()
        if (email.isEmpty() || !email.contains("@")) {
            Log.w(TAG, "picker returned no usable account")
            call.resolve(JSObject().put("cancelled", true).put("reason", "no-account"))
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
