package app.themashup.music.playback.poToken

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.MainThread
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
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
    /**
     * Callers waiting for a token, keyed by identifier.
     *
     * Concurrent: [generatePoToken] is called from NewPipeExtractor's IO thread, while the
     * `@JavascriptInterface` callbacks that complete these continuations arrive on a WebView thread.
     * A plain `mutableMapOf` here is a data race that shows up as a token request that never returns.
     */
    private val poTokenContinuations =
        java.util.concurrent.ConcurrentHashMap<String, Continuation<String>>()
    private val exceptionHandler = CoroutineExceptionHandler { _, exception ->
        onInitializationError(exception)
    }
    private lateinit var expirationInstant: Instant

    @Volatile
    private var closed = false

    private val initSettled = java.util.concurrent.atomic.AtomicBoolean(false)

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
                    // Exactly once: `close()` resumes this same continuation with an exception, and a
                    // second resume throws on the main thread.
                    if (settleInit()) generatorContinuation.resume(this@PoTokenWebView)
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
        poTokenContinuations.remove(identifier)?.let {
            runCatching { it.resumeWithException(PoTokenException(error)) }
        }
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
            poTokenContinuations.remove(identifier)?.let { runCatching { it.resumeWithException(t) } }
            return
        }

        Log.d(TAG, "Generated poToken: identifier=$identifier poToken=$poToken")
        poTokenContinuations.remove(identifier)?.let { runCatching { it.resume(poToken) } }
    }

    fun isExpired(): Boolean {
        if (closed) return true
        // `expirationInstant` is only assigned once initialization produced an integrity token; a
        // read before that is not "expired", it is "not ready", and treating it as expired would
        // recreate the WebView in a loop.
        if (!::expirationInstant.isInitialized) return false
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
            val body = data.joinToString(",").toRequestBody(TEXT_PLAIN)
            val request = Request.Builder()
                .url(url)
                .post(body)
                .build()
            // One client per process, not per call: `OkHttpClient()` allocates a connection pool and
            // a thread pool, and this ran twice per token.
            SharedClient.get().newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw PoTokenException("$url answered HTTP ${response.code}")
                }
                response.body.string()
            }
        }

    /**
     * Handles any error happening during initialization, releasing resources and sending the error
     * to [generatorContinuation].
     */
    private fun onInitializationError(error: Throwable) {
        CoroutineScope(Dispatchers.Main).launch {
            if (settleInit()) generatorContinuation.resumeWithException(error)
            close()
        }
    }

    /** Claims the single resume of [generatorContinuation]; false if someone already did. */
    private fun settleInit(): Boolean = initSettled.compareAndSet(false, true)

    /** Releases all [webView] resources. */
    @MainThread
    fun close() {
        if (closed) return
        closed = true
        runCatching {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.clearHistory()
            webView.onPause()
            webView.removeAllViews()
            webView.destroy()
        }.onFailure { Log.w(TAG, "WebView teardown: ${it.message}") }
        // Continue any caller still waiting on this generator: it can never answer now, and a
        // coroutine that waits forever is a hung resolve.
        poTokenContinuations.values.forEach {
            runCatching { it.resumeWithException(PoTokenException("generator closed")) }
        }
        poTokenContinuations.clear()
    }
    //endregion

    companion object {
        private val TAG = "PoTokenWebView"
        private val TEXT_PLAIN = "text/plain; charset=utf-8".toMediaType()
        private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
        private val JS_INTERFACE = "MashupPoToken"

        /** Lazily built once; see the note at the call site. */
        object SharedClient {
            private val instance: OkHttpClient by lazy { OkHttpClient() }
            fun get(): OkHttpClient = instance
        }

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


