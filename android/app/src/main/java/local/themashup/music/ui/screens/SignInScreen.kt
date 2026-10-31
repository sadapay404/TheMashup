package local.themashup.music.ui.screens

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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import local.themashup.music.core.network.YouTubeMusicHome
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * N9 sign-in — the innertune/SimpMusic WebView method the user pointed at:
 * sign into Google on the YouTube Music service, capture the session cookie
 * once, verify it with the account endpoint, and save it for Home requests.
 * The native player does not use this WebView to play music.
 *
 * The WebView exists ONLY inside this screen for the OAuth flow; the app
 * itself remains native (the standing "no WebView" rule covers the shell).
 */
@Composable
@Suppress("SetJavaScriptEnabled") // JS only inside this sign-in WebView
fun SignInScreen(
    hasCookie: Boolean,
    onSaveCookie: suspend (String) -> Unit,
    onClearCookie: suspend () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val musicHome = remember { YouTubeMusicHome() }
    var checking by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingCookie by remember { mutableStateOf<String?>(null) }
    val signed = hasCookie

    fun verifyAndSave(cookie: String) {
        if (checking) return
        pendingCookie = cookie
        checking = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { musicHome.verify(cookie) }
                onSaveCookie(cookie)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "Could not verify or securely save this account. Check your connection and try again."
            } finally {
                checking = false
            }
        }
    }

    BackHandler(enabled = true) {
        onClose()
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
                        text = "Sign in to your YouTube account",
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
                    .background(if (signed) tokens.accent.copy(alpha = 0.14f) else scheme.surface)
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
                    text = when {
                        signed -> "YouTube session saved"
                        checking -> "Verifying account…"
                        else -> "Sign in to connect recommendations"
                    },
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
                            .clickable(enabled = !clearing) {
                                clearing = true
                                scope.launch {
                                    try {
                                        onClearCookie()
                                        CookieManager.getInstance().removeAllCookies {
                                            CookieManager.getInstance().flush()
                                            clearing = false
                                        }
                                    } catch (e: Exception) {
                                        clearing = false
                                        error = "Could not clear the saved account. Please try again."
                                    }
                                }
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }

            if (error != null) {
                Text(error.orEmpty(), color = scheme.error, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                if (pendingCookie != null && !signed) TextButton(
                    onClick = { pendingCookie?.let(::verifyAndSave) }, enabled = !checking,
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) { Text("Retry verification") }
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
                if (!signed && !clearing) {
                    // Track the WebView instance so we can destroy it when the sheet closes.
                    val webViewRef = remember { mutableStateOf<WebView?>(null) }

                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            WebView(context).apply {
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                CookieManager.getInstance().setAcceptCookie(true)
                                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                                loadUrl(GOOGLE_LOGIN_URL)
                                webViewRef.value = this
                            }
                        },
                        update = { webView ->
                            webViewRef.value = webView
                            // Only install the WebViewClient once — recomposition would
                            // re-install it every time checking/error/pendingCookie/signed changes.
                            if (webView.webViewClient == null) {
                                webView.webViewClient = object : WebViewClient() {
                                    override fun doUpdateVisitedHistory(
                                        view: WebView?,
                                        url: String?,
                                        isReload: Boolean,
                                    ) {
                                        // Landed on YouTube Music → the cookie jar now
                                        // holds the signed-in session (innertune verbatim).
                                        if (url != null && url.startsWith(YOUTUBE_MUSIC_URL_PREFIX)) {
                                            scope.launch(Dispatchers.IO) {
                                                val cookie = CookieManager.getInstance().getCookie(url)
                                                if (!cookie.isNullOrBlank() && YouTubeMusicHome.sessionId(cookie) != null &&
                                                    cookie != pendingCookie && !checking) {
                                                    CookieManager.getInstance().flush()
                                                    withContext(Dispatchers.Main) { verifyAndSave(cookie) }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                    )
                    DisposableEffect(webViewRef.value) {
                        onDispose {
                            webViewRef.value?.stopLoading()
                            webViewRef.value?.destroy()
                            webViewRef.value = null
                        }
                    }
                }
            }
        }
    }

}

/** InnerTune's music-service sign-in URL. */
private const val GOOGLE_LOGIN_URL =
            "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true" +
                "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue" +
                "%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"

private const val YOUTUBE_MUSIC_URL_PREFIX = "https://music.youtube.com/"
