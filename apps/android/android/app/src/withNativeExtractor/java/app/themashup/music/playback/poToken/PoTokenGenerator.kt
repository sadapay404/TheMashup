package app.themashup.music.playback.poToken

import android.content.Context
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.services.youtube.InnertubeClientRequestInfo
import org.schabi.newpipe.extractor.services.youtube.PoTokenProvider
import org.schabi.newpipe.extractor.services.youtube.PoTokenResult
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper

/**
 * WebView-based BotGuard PoToken generator.
 *
 * Scope of this file, stated honestly because the stakes are real: it implements the **streaming
 * PoToken only**. It does not obtain the *player* PoToken, because that one requires executing
 * YouTube's VM inside a WebView, and this build does not do that. What it does is the half that
 * matters for the failure this app has: YouTube throttles a media URL to roughly a megabyte unless
 * the request carries a valid `pot=`, so the song dies ~30 seconds in. `poToken.html` mints exactly
 * that value with `obtainPoToken(webPoSignalOutput, integrityToken, u8Identifier)`.
 *
 * [PoTokenResult] carries two tokens. `playerRequestPoToken` is `@Nonnull` in v0.27.1, so it must be
 * a string: it is set to the token we do have rather than to `null`, because a null there is a
 * compile-time-correct lie that crashes at runtime. `streamingDataPoToken` is the one that changes
 * playback, and it is genuinely this token.
 *
 * Nothing here touches `kotlinx.serialization` or `okio`: neither is a declared dependency of this
 * module, and the previous revision imported both — one of the reasons the enhanced flavour never
 * compiled. JSON is parsed with `org.json`, which is part of the platform.
 *
 * Licence: GPL-3.0. Only compiled into the `withNativeExtractor` flavour.
 */
class PoTokenGenerator : PoTokenProvider {

    companion object {
        private const val TAG = "PoTokenGenerator"
    }

    /** Set once from `NativeExtractorImpl.initialize`; WebView needs a real Context. */
    @Volatile
    private var appContext: Context? = null

    private val lock = Any()

    @Volatile
    private var generator: PoTokenWebView? = null

    @Volatile
    private var visitorData: String? = null

    @Volatile
    private var lastResult: PoTokenResult? = null

    fun setAppContext(context: Context) {
        appContext = context.applicationContext ?: context
    }

    fun getCachedWebClientPoToken(): PoTokenResult? = lastResult

    /**
     * Called by NewPipeExtractor from its own IO thread, possibly concurrently.
     *
     * Returns `null` — the documented "cannot provide one" answer — instead of throwing, because a
     * missing token must degrade to "YouTube will throttle this stream" rather than to "extraction
     * failed", which would be a lie about the cause.
     */
    override fun getWebClientPoToken(videoId: String): PoTokenResult? {
        val ctx = appContext
        if (ctx == null) {
            Log.w(TAG, "no Context installed; cannot mint a PoToken")
            return null
        }
        return try {
            val result = obtain(ctx, videoId, forceRecreate = false)
            lastResult = result
            result
        } catch (t: Throwable) {
            Log.w(TAG, "PoToken request failed for $videoId: ${t.message}")
            null
        }
    }

    private fun obtain(ctx: Context, videoId: String, forceRecreate: Boolean): PoTokenResult {
        synchronized(lock) {
            var current = generator
            var visitor = visitorData
            if (current == null || forceRecreate || current.isExpired()) {
                // Close the old WebView before creating a second one: two live WebViews both hold the
                // HTML asset and the BotGuard VM, which is how this leaks on every token refresh.
                current?.close()
                visitor = fetchVisitorData()
                visitorData = visitor
                current = runBlocking { PoTokenWebView.newPoTokenGenerator(ctx) }
                generator = current
                Log.d(TAG, "created a fresh WebView for PoTokens")
            }
            val generatorNow = current ?: throw PoTokenException("no WebView generator")
            val visitorNow = visitor ?: throw PoTokenException("no visitor data")
            val token = runBlocking { generatorNow.generatePoToken(videoId) }
            return PoTokenResult(visitorNow, token, token)
        }
    }

    /**
     * The visitor data must be the *same one* the token was minted against, so it is fetched together
     * with the WebView it belongs to and cached alongside it.
     */
    private fun fetchVisitorData(): String {
        val requestInfo = InnertubeClientRequestInfo.ofWebClient()
        requestInfo.clientInfo.clientVersion = YoutubeParsingHelper.getClientVersion()
        return YoutubeParsingHelper.getVisitorDataFromInnertube(
            requestInfo,
            NewPipe.getPreferredLocalization(),
            NewPipe.getPreferredContentCountry(),
            YoutubeParsingHelper.getYouTubeHeaders(),
            YoutubeParsingHelper.YOUTUBEI_V1_URL,
            null,
            false,
        )
    }
}

// ── Parsing, kept in this file so the enhanced flavour has no file-level dependency on a JSON
//    library. Everything below is a pure function of an HTTP body.

internal fun parseChallengeData(raw: String): String {
    // The Create endpoint answers either `[challenge]` or `[null, <scrambled>]`; the scrambled form is
    // base64 with every byte shifted by +97.
    val outer = JSONArray(raw)
    val challenge = if (outer.length() > 1 && outer.opt(1).let { it is String }) {
        JSONArray(descramble(outer.getString(1)))
    } else {
        outer.optJSONArray(0) ?: JSONArray()
    }

    val interpreter = challenge.optJSONArray(1)?.let { firstString(it) }
    val resource = challenge.optJSONArray(2)?.let { firstString(it) }
    val interpreterJavascript = JSONObject()
    interpreterJavascript.put(
        "privateDoNotAccessOrElseSafeScriptWrappedValue",
        interpreter ?: JSONObject.NULL,
    )
    interpreterJavascript.put(
        "privateDoNotAccessOrElseTrustedResourceUrlWrappedValue",
        resource ?: JSONObject.NULL,
    )

    return JSONObject().apply {
        put("messageId", challenge.optString(0, ""))
        put("interpreterJavascript", interpreterJavascript)
        put("interpreterHash", challenge.optString(3, ""))
        put("program", challenge.optString(4, ""))
        put("globalName", challenge.optString(5, ""))
        put("clientExperimentsStateBlob", challenge.optString(7, ""))
    }.toString()
}

/** Returns `(Uint8Array literal, lifetime in seconds)`. */
internal fun parseIntegrityTokenData(raw: String): Pair<String, Long> {
    val arr = JSONArray(raw)
    val lifetime = arr.optLong(1, 0L)
    return base64ToU8(arr.optString(0, "")) to lifetime
}

internal fun stringToU8(value: String): String = newUint8Array(value.toByteArray(Charsets.UTF_8))

/** `"97,98,99"` (a JavaScript `Uint8Array#toString`) to URL-safe base64. */
internal fun u8ToBase64(csv: String): String {
    val bytes = if (csv.isEmpty()) {
        ByteArray(0)
    } else {
        csv.split(',').mapTo(ByteArray(csv.count { it == ',' } + 1)) { it.trim().toInt().toByte() }
    }
    return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
}

private fun descramble(scrambled: String): String =
    base64ToBytes(scrambled).map { (it + 97).toByte() }.toByteArray().toString(Charsets.UTF_8)

private fun base64ToU8(value: String): String = newUint8Array(base64ToBytes(value))

private fun newUint8Array(bytes: ByteArray): String =
    "new Uint8Array([" + bytes.joinToString(",") { (it.toInt() and 0xFF).toString() } + "])"

/** YouTube uses base64url with `.` standing in for `=`, and no padding. */
private fun base64ToBytes(value: String): ByteArray {
    val normalised = value
        .replace('-', '+')
        .replace('_', '/')
        .replace('.', '=')
    val padded = when (normalised.length % 4) {
        2 -> "$normalised=="
        3 -> "$normalised="
        else -> normalised
    }
    return try {
        Base64.decode(padded, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
        throw PoTokenException("challenge is not valid base64: ${e.message}")
    }
}

private fun firstString(array: JSONArray): String? {
    for (i in 0 until array.length()) {
        val v = array.opt(i)
        if (v is String) return v
    }
    return null
}

/** Thrown when BotGuard initialization or token generation fails. */
class PoTokenException(message: String) : Exception(message)
