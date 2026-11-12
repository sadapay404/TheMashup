package app.themashup.music.extractor

import android.util.Log

/**
 * Stream resolution seam — ADR-005.
 *
 * The `standard` flavour ships **no GPL code**, so this interface is all it has: nothing is
 * installed, [notInstalledReason] explains that, and the JS layer falls through to its own ladder.
 * The `withNativeExtractor` flavour compiles
 * [app.themashup.music.extractor.generated.NativeExtractorImpl] into the APK, `MainActivity` installs
 * it by reflection, and it answers with a real, playable URL produced by NewPipeExtractor (GPL-3.0).
 *
 * Why this seam exists, stated plainly — it is what broke playback:
 *
 *  - InnerTube's client profiles (`packages/core/src/innertube/profiles.ts`) can be walked from the
 *    WebView, but the clients that still hand out usable media URLs either demand a stream PoToken
 *    (WEB_REMIX / ANDROID / IOS / ANDROID_VR) or have been shut down by YouTube (VISIONOS). A
 *    token-gated URL serves roughly one megabyte — about thirty seconds at 256 kbps — and then
 *    answers 403. That is the "the song stops after a few seconds" report, exactly.
 *  - Minting a PoToken means running Google's BotGuard JavaScript against an attested WebView. That
 *    cannot be done in the page; it can be done in the app. NewPipeExtractor maintains that dance,
 *    so we take the dependency instead of reimplementing it.
 *
 * The interface is intentionally tiny and JSON-shaped: it is called across the Capacitor bridge, so
 * strings keep the two sides decoupled and there is no shared data class to drift.
 */
interface StreamExtractor {
    /**
     * Resolve a playable audio URL for [videoId].
     *
     * [preferItag] is the format the JS layer would like if it is on offer (matched against
     * NewPipeExtractor's itag table). The caller has already shown the user what it expects, so a
     * silent substitution makes the download sheet lie. Fall back freely when the exact itag is not
     * available — but prefer it when it is.
     *
     * Returns a JSON object as a string, shaped like:
     * `{"url":"…","kind":"progressive|hls|dash","itag":251,"codec":"opus","kbps":160,` +
     * `"mime":"audio/webm","durationSec":212,"headers":{…},"source":"newpipe"}`
     *
     * Null means "ran, found nothing usable". Throwing is allowed and is reported with its message.
     */
    suspend fun resolve(videoId: String, preferItag: Int): String?
}

/**
 * The live delegate, or null in the standard flavour.
 *
 * `@Volatile`: written on the activity thread at boot, read from a bridge thread on the first play.
 */
object Extractor {
    private const val TAG = "MashupExtractor"

    @Volatile
    var delegate: StreamExtractor? = null

    /** True when this APK can resolve streams natively. The JS layer asks before it gives up. */
    val available: Boolean
        get() = delegate != null

    /**
     * Why resolution is unavailable. Distinct sentences for distinct situations, because "it did not
     * work" is the report that took ten releases to get past.
     */
    fun notInstalledReason(): String = "This APK has no native extractor (standard build)."

    /**
     * Resolve [videoId], reporting *why* not rather than returning a bare null.
     *
     * The caller turns this into either a URL or a message the UI shows. Exceptions are caught here
     * so a broken extractor cannot cross the bridge as an unhandled failure.
     */
    suspend fun resolveStream(videoId: String, preferItag: Int): Result<String> {
        val d = delegate
            ?: return Result.failure(IllegalStateException(notInstalledReason()))

        return try {
            val json = d.resolve(videoId, preferItag)
            if (json.isNullOrBlank()) {
                Result.failure(IllegalStateException("no_stream_returned"))
            } else {
                Result.success(json)
            }
        } catch (t: Throwable) {
            // Logged in full: the on-device boot log is the only place a person with just the phone
            // can read this, and "resolution failed" without a cause helped nobody.
            Log.w(TAG, "resolve failed for $videoId", t)
            Result.failure(t)
        }
    }
}
