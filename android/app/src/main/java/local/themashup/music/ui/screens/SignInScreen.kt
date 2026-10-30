package local.themashup.music.ui.screens

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * N9 sign-in — the innertune/SimpMusic WebView method the user pointed at:
 * sign into Google on the YouTube Music service, capture the session cookie
 * once ([CookieManager] → settings → process-wide holder), and every
 * extraction request afterwards carries it.
 *
 * The WebView exists ONLY inside this screen for the OAuth flow; the app
 * itself remains native (the standing "no WebView" rule covers the shell).
 */
@Composable
fun SignInScreen(
    hasCookie: Boolean,
    onSaveCookie: (String) -> Unit,
    onClearCookie: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    var signedIn by rememberSaveable { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    val signed = signedIn || hasCookie

    // Back walks the WebView history first; leaves the screen only at its root.
    BackHandler(enabled = true) {
        val wv = webView
        if (wv?.canGoBack() == true) wv.goBack() else onClose()
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(scheme.background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            // ── header ──
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "Close",
                    tint = tokens.textDim,
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .clickable(onClick = onClose)
                        .padding(7.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Sign in to YouTube",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = scheme.onBackground,
                    )
                    Text(
                        text = "Google sign-in for personalized suggestions",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.textFaint,
                    )
                }
            }

            // ── status pill ──
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (signed) tokens.accent.copy(alpha = 0.14f) else tokens.surface)
                    .border(1.dp, if (signed) tokens.accent.copy(alpha = 0.5f) else tokens.border, RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = if (signed) tokens.accent else tokens.textDim,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = if (signed) "Signed in — extraction is personalized" else "Not signed in yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (signed) scheme.onBackground else tokens.textDim,
                    modifier = Modifier.weight(1f),
                )
                if (signed) {
                    Text(
                        text = "Sign out",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = tokens.accent,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable {
                                signedIn = false
                                onClearCookie()
                                CookieManager.getInstance().apply {
                                    removeCookie("https://accounts.google.com")
                                    removeCookie("https://www.youtube.com")
                                    removeCookie("https://music.youtube.com")
                                    flush()
                                }
                                webView?.reload()
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── the sign-in flow itself ──
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .border(1.dp, tokens.border, RoundedCornerShape(16.dp)),
            ) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { context ->
                        @SuppressLint("SetJavaScriptEnabled")
                        WebView(context).apply {
                            webViewClient = object : WebViewClient() {
                                override fun doUpdateVisitedHistory(
                                    view: WebView?,
                                    url: String?,
                                    isReload: Boolean,
                                ) {
                                    // Landed on YouTube Music → the cookie jar now
                                    // holds the signed-in session (innertune verbatim).
                                    if (url != null && url.startsWith(YOUTUBE_MUSIC_URL_PREFIX)) {
                                        val cookie = CookieManager.getInstance().getCookie(url)
                                        if (!cookie.isNullOrBlank()) {
                                            CookieManager.getInstance().flush()
                                            onSaveCookie(cookie)
                                            signedIn = true
                                        }
                                    }
                                }
                            }
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            CookieManager.getInstance().setAcceptCookie(true)
                            webView = this
                            loadUrl(GOOGLE_LOGIN_URL)
                        }
                    },
                )
            }
        }
    }

    companion object {
        /** InnerTune's exact music-service service-login URL. */
        const val GOOGLE_LOGIN_URL =
            "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true" +
                "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue" +
                "%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"

        const val YOUTUBE_MUSIC_URL_PREFIX = "https://music.youtube.com"
    }
}
