package com.themashup.app

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.launch

/**
 * YouTube Music sign-in: Google login in a WebView -> capture the music.youtube.com cookie ->
 * verify it with the account endpoint -> save it for home recommendations.
 */
class SignInActivity : androidx.activity.ComponentActivity() {
    private var handled = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Graph.init(applicationContext)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0A0A0F")) }
        val status = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 13f; setPadding(32, 24, 32, 24)
            setBackgroundColor(Color.parseColor("#15151F")); text = "Sign in with Google to continue…"
        }
        val web = runCatching { WebView(this) }.getOrNull()
        if (web == null) {
            status.text = "WebView is not available on this device, so sign-in can't run."
            root.addView(status)
            setContentView(root)
            return
        }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // Google blocks embedded WebViews by UA; present as a regular mobile Chrome.
        web.settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (handled || !url.contains("music.youtube.com")) return
                val cookie = CookieManager.getInstance().getCookie("https://music.youtube.com").orEmpty()
                if (!cookie.contains("SAPISID")) return
                handled = true
                status.text = "Verifying session…"
                Graph.scope.launch {
                    val r = Sources.verifyCookie(cookie)
                    r.onSuccess { name ->
                        Graph.prefs.setAccount(cookie, name)
                        Toast.makeText(this@SignInActivity, "Signed in as $name", Toast.LENGTH_SHORT).show()
                        finish()
                    }.onFailure { e ->
                        handled = false
                        status.text = "Couldn't verify the session: ${e.message}"
                    }
                }
            }
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { topMargin = 110 })
        root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110))
        setContentView(root)
        web.loadUrl("https://accounts.google.com/ServiceLogin?service=youtube&continue=" + android.net.Uri.encode("https://music.youtube.com/"))
    }
}
