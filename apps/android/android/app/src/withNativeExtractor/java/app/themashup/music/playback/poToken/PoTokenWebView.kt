package app.themashup.music.playback.poToken

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.MainThread
import com.squareup.okhttp3.MediaType
import com.squareup.okhttp3.OkHttpClient
import com.squareup.okhttp3.Request
import com.squareup.okhttp3.RequestBody
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.time.Instant
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Hidden WebView that runs YouTube's BotGuard client code to obtain PoTokens.
 *
 * Ported from LibreTube (GPL-3.0). Differences from the original:
 *  - Uses OkHttp instead of Retrofit for the two BotGuard service requests
 *  - No `BuildConfig.DEBUG` gate; debug logging is unconditional but sparse
 *  - No dependency on `RetrofitInstance` or `USER_AGENT` from another module
 *
 * Lifecycle:
 *  1. [newPoTokenGenerator] creates the WebView, loads [PO_TOKEN_HTML] from assets, and runs
 *     BotGuard initialization (Create + GenerateIT) asynchronously.
 *  2. When initialization completes, [generatePoToken] runs `obtainPoToken` in the WebView for a
 *     given video ID and returns the signed token.
 *  3. [close] releases WebView resources; call when the generator is no longer needed.
 *
 * Licence: GPL-3.0. Only compiled into the `withNativeExtractor` flavour.
 */
class PoTokenWebView private constructor(
    context: Context,
    private val generatorContinuation: Continuation<PoTokenWebView>
) {
    private val webView = WebView(context)
    private val poTokenContinuations = mutableMapOf<String, Continuation<String>>()
    private val exceptionHandler = CoroutineExceptionHandler { _, exception ->
        onInitializationError(exception)
    }
    private lateinit var expirationInstant: Instant

    //region Initialization
    init {
        webView.settings.apply {
            // We want to use JavaScript — this is the whole point of the WebView.
            javaScriptEnabled = true
            safeBrowsingEnabled = false
            userAgentString = USER_AGENT
            blockNetworkLoads = true // The WebView does not need internet access; OkHttp handles requests.
        }

        webView.addJavascriptInterface(this, JS_INTERFACE)
    }

    /**
     * Must be called right after instantiating to perform the actual initialization. This
     * asynchronously loads BotGuard, runs it, and obtains an `integrityToken`.
     */
    private fun loadHtmlAndObtainBotguard(context: Context) {
        Log.d(TAG, "loadHtmlAndObtainBotguard() called")

        CoroutineScope(Dispatchers.IO).launch(exceptionHandler) {
            try {
                val html = context.assets.open("po_token.html").bufferedReader().use { it.readText() }
                withContext(Dispatchers.Main) {
                    webView.loadDataWithBaseURL(
                        "https://www.youtube.com",
                        html.replaceFirst(
                            "</script>",
                            // calls downloadAndRunBotguard() when the page has finished loading
                            "\n$JS_INTERFACE.downloadAndRunBotguard()</script>"
                        ),
                        "text/html",
                        "utf-8",
                        null,
                    )
                }
            } catch (e: Exception) {
                onInitializationError(e)
            }
        }
    }

    /**
     * Called during initialization by the JavaScript snippet appended to the HTML page content in
     * [loadHtmlAndObtainBotguard] after the WebView content has finished loading.
     */
    @JavascriptInterface
    fun downloadAndRunBotguard() {
        Log.d(TAG, "downloadAndRunBotguard() called")

        CoroutineScope(Dispatchers.IO).launch(exceptionHandler) {
            val responseBody = makeBotguardServiceRequest(
                "https://www.youtube.com/api/jnn/v1/Create",
                listOf(REQUEST_KEY)
            )
            val parsedChallengeData = parseChallengeData(responseBody)
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    """try {
                             data = $parsedChallengeData
                             runBotGuard(data).then(function (result) {
                                 this.webPoSignalOutput = result.webPoSignalOutput
                                 $JS_INTERFACE.onRunBotguardResult(result.botguardResponse)
                             }, function (error) {
                                 $JS_INTERFACE.onJsInitializationError(error + "\\n" + error.stack)
                             })
                         } catch (error) {
                             $JS_INTERFACE.onJsInitializationError(error + "\\n" + error.stack)
                         }""",
                    null
                )
            }
        }
    }

    /**
     * Called during initialization by the JavaScript snippets from either
     * [downloadAndRunBotguard] or [onRunBotguardResult].
     */
    @JavascriptInterface
    fun onJsInitializationError(error: String) {
        Log.e(TAG, "Initialization error from JavaScript: $error")
        onInitializationError(PoTokenException(error))
    }

    /**
     * Called during initialization by the JavaScript snippet from [downloadAndRunBotguard] after
     * obtaining the BotGuard execution output [botguardResponse].
     */
    @JavascriptInterface
    fun onRunBotguardResult(botguardResponse: String) {
        CoroutineScope(Dispatchers.IO).launch(exceptionHandler) {
            val response = makeBotguardServiceRequest(
                "https://www.youtube.com/api/jnn/v1/GenerateIT",
                listOf(REQUEST_KEY, botguardResponse)
            )
            val (integrityToken, expirationTimeInSeconds) = parseIntegrityTokenData(response)

            // Leave 10 minutes of margin just to be sure.
            expirationInstant = Instant.now().plusSeconds(expirationTimeInSeconds - 600)

            withContext(Dispatchers.Main) {
                webView.evaluateJavascript("this.integrityToken = $integrityToken") {
                    Log.d(TAG, "initialization finished, expiration=${expirationTimeInSeconds}s")
                    generatorContinuation.resume(this@PoTokenWebView)
                }
            }
        }
    }
    //endregion

    //region Obtaining poTokens
    suspend fun generatePoToken(identifier: String): String {
        Log.d(TAG, "generatePoToken() called with identifier $identifier")
        return suspendCancellableCoroutine { continuation ->
            poTokenContinuations[identifier] = continuation
            val u8Identifier = stringToU8(identifier)

            Handler(Looper.getMainLooper()).post {
                webView.evaluateJavascript(
                    """try {
                        identifier = "$identifier"
                        u8Identifier = $u8Identifier
                        poTokenU8 = obtainPoToken(webPoSignalOutput, integrityToken, u8Identifier)
                        poTokenU8String = ""
                        for (i = 0; i < poTokenU8.length; i++) {
                            if (i != 0) poTokenU8String += ","
                            poTokenU8String += poTokenU8[i]
                        }
                        $JS_INTERFACE.onObtainPoTokenResult(identifier, poTokenU8String)
                    } catch (error) {
                        $JS_INTERFACE.onObtainPoTokenError(identifier, error + "\\n" + error.stack)
                    }""",
                ) {}
            }
        }
    }

    /**
     * Called by the JavaScript snippet from [generatePoToken] when an error occurs in calling the
     * JavaScript `obtainPoToken()` function.
     */
    @JavascriptInterface
    fun onObtainPoTokenError(identifier: String, error: String) {
        Log.e(TAG, "obtainPoToken error from JavaScript: $error")
        poTokenContinuations.remove(identifier)?.resumeWithException(PoTokenException(error))
    }

    /**
     * Called by the JavaScript snippet from [generatePoToken] with the original identifier and the
     * result of the JavaScript `obtainPoToken()` function.
     */
    @JavascriptInterface
    fun onObtainPoTokenResult(identifier: String, poTokenU8: String) {
        Log.d(TAG, "Generated poToken (before decoding): identifier=$identifier poTokenU8=$poTokenU8")
        val poToken = try {
            u8ToBase64(poTokenU8)
        } catch (t: Throwable) {
            poTokenContinuations.remove(identifier)?.resumeWithException(t)
            return
        }

        Log.d(TAG, "Generated poToken: identifier=$identifier poToken=$poToken")
        poTokenContinuations.remove(identifier)?.resume(poToken)
    }

    fun isExpired(): Boolean {
        return Instant.now().isAfter(expirationInstant)
    }
    //endregion

    //region Utils
    /**
     * Makes a POST request to [url] with the given [data] by setting the correct headers.
     * Used only during initialization. Returns the response body as a String if successful.
     */
    private suspend fun makeBotguardServiceRequest(url: String, data: List<String>): String =
        withContext(Dispatchers.IO) {
            val client = OkHttpClient()
            val body = data.joinToString(",")
            val request = Request.Builder()
                .url(url)
                .post(RequestBody.create(body, MediaType.parse("text/plain")))
                .header("Content-Type", "text/plain")
                .build()
            client.newCall(request).execute().use { response ->
                response.body?.string() ?: ""
            }
        }

    /**
     * Handles any error happening during initialization, releasing resources and sending the error
     * to [generatorContinuation].
     */
    private fun onInitializationError(error: Throwable) {
        CoroutineScope(Dispatchers.Main).launch {
            close()
            generatorContinuation.resumeWithException(error)
        }
    }

    /** Releases all [webView] resources. */
    @MainThread
    fun close() = with(webView) {
        clearHistory()
        // Clears RAM cache and disk cache (globally for all WebViews).
        clearCache(true)

        // Ensures that the WebView isn't doing anything when destroying it.
        loadUrl("about:blank")

        onPause()
        removeAllViews()
        destroy()
    }
    //endregion

    companion object {
        private val TAG = PoTokenWebView::class.simpleName
        private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
        private val JS_INTERFACE = PoTokenWebView::class.simpleName!!

        /** YouTube web client user agent, so BotGuard sees a normal browser. */
        const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36"

        suspend fun newPoTokenGenerator(context: Context): PoTokenWebView {
            return suspendCancellableCoroutine { continuation ->
                Handler(Looper.getMainLooper()).post {
                    val poTokenWebView = PoTokenWebView(context, continuation)
                    poTokenWebView.loadHtmlAndObtainBotguard(context)
                }
            }
        }
    }
}

/** Thrown when BotGuard initialization or PoToken generation fails. */
class PoTokenException(message: String) : Exception(message)
