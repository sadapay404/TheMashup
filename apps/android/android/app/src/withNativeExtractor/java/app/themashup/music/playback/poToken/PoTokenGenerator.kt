package app.themashup.music.playback.poToken

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import kotlinx.coroutines.runBlocking
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.services.youtube.InnertubeClientRequestInfo
import org.schabi.newpipe.extractor.services.youtube.PoTokenProvider
import org.schabi.newpipe.extractor.services.youtube.PoTokenResult
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper

/**
 * WebView-based BotGuard PoToken generator, ported from LibreTube (GPL-3.0).
 *
 * Runs YouTube's BotGuard client code inside a hidden WebView to obtain a signed `pot=` parameter
 * that NewPipeExtractor attaches to stream requests. Without this, most YouTube audio streams are
 * throttled to ~1-2 MB and then cut — the exact failure this app has been debugging for months.
 *
 * Threading: [getWebClientPoToken] may be called from NewPipeExtractor's IO thread. WebView
 * creation and JavaScript evaluation happen on the main looper via [Handler]; coroutine blocking
 * with [runBlocking] bridges the two.
 *
 * Only [getWebClientPoToken] is implemented. The web-embed, Android-client and iOS-client
 * providers return null because we never use those clients for audio extraction.
 *
 * Licence: GPL-3.0. Only compiled into the `withNativeExtractor` flavour.
 */
class PoTokenGenerator : PoTokenProvider {

    private val TAG = PoTokenGenerator::class.simpleName

    /** WebView may not exist on every Android build; fail gracefully rather than crash. */
    private val supportsWebView by lazy { runCatching { CookieManager.getInstance() }.isSuccess }

    private object WebPoTokenGenLock

    private var webPoTokenVisitorData: String? = null
    private var webPoTokenGenerator: PoTokenWebView? = null

    private var poToken: PoTokenResult? = null

    /** Set by [NativeExtractorImpl.initialize] before the generator is first used. */
    private var appContext: Context? = null

    fun setAppContext(context: Context) {
        appContext = context
    }

    fun getCachedWebClientPoToken(): PoTokenResult? = poToken

    override fun getWebClientPoToken(videoId: String): PoTokenResult? {
        if (!supportsWebView) {
            Log.w(TAG, "WebView unavailable; cannot generate PoToken")
            return null
        }

        return getWebClientPoToken(videoId, false).also { poToken = it }
    }

    /**
     * @param forceRecreate whether to force recreation of [webPoTokenGenerator], used when the
     * previous generator threw an error.
     */
    private fun getWebClientPoToken(videoId: String, forceRecreate: Boolean): PoTokenResult {
        val (poTokenGenerator, visitorData, hasBeenRecreated) =
            synchronized(WebPoTokenGenLock) {
                val shouldRecreate =
                    webPoTokenGenerator == null || forceRecreate || webPoTokenGenerator!!.isExpired()

                if (shouldRecreate) {
                    val innertubeClientRequestInfo = InnertubeClientRequestInfo.ofWebClient()
                    innertubeClientRequestInfo.clientInfo.clientVersion =
                        YoutubeParsingHelper.getClientVersion()

                    webPoTokenVisitorData = YoutubeParsingHelper.getVisitorDataFromInnertube(
                        innertubeClientRequestInfo,
                        NewPipe.getPreferredLocalization(),
                        NewPipe.getPreferredContentCountry(),
                        YoutubeParsingHelper.getYouTubeHeaders(),
                        YoutubeParsingHelper.YOUTUBEI_V1_URL,
                        null,
                        false
                    )

                    runBlocking {
                        // Close the current webPoTokenGenerator on the main thread.
                        webPoTokenGenerator?.let {
                            Handler(Looper.getMainLooper()).post { it.close() }
                        }

                        // Create a new WebView-based generator.
                        val ctx = appContext
                            ?: error("PoTokenGenerator.setAppContext(Context) must be called before getWebClientPoToken")
                        webPoTokenGenerator = PoTokenWebView.newPoTokenGenerator(ctx)
                    }
                }

                return@synchronized Triple(
                    webPoTokenGenerator!!,
                    webPoTokenVisitorData!!,
                    shouldRecreate
                )
            }

        val result = try {
            // PoToken generation itself can run in parallel; only one visitorData/streaming PoToken
            // must be generated before anything else.
            runBlocking {
                poTokenGenerator.generatePoToken(videoId)
            }
        } catch (throwable: Throwable) {
            if (hasBeenRecreated) {
                Log.e(TAG, "Failed to obtain poToken after retry; giving up", throwable)
                throw throwable
            } else {
                Log.e(TAG, "Failed to obtain poToken, retrying with fresh WebView", throwable)
                return getWebClientPoToken(videoId = videoId, forceRecreate = true)
            }
        }

        Log.d(TAG, "poToken for $videoId: ${result.isNotEmpty()}, visitor_data=$visitorData")

        return PoTokenResult(visitorData, result, result)
    }

    override fun getWebEmbedClientPoToken(videoId: String?): PoTokenResult? = null

    override fun getAndroidClientPoToken(videoId: String?): PoTokenResult? = null

    override fun getIosClientPoToken(videoId: String?): PoTokenResult? = null
}
