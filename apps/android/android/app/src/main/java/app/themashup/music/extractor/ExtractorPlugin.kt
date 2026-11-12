package app.themashup.music.extractor

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * `MashupExtractor` — the JS-visible half of the native stream resolver.
 *
 * The web layer's resolution ladder is:
 *
 *   1. native extractor (this plugin) — real URLs, real PoTokens, full-length audio
 *   2. InnerTube client profiles — cheap, but token-gated or dead
 *   3. public Piped/Invidious mirrors — a last resort
 *   4. the direct stream downloader — even without a URL, the bytes can still be fetched
 *
 * Before this plugin existed the native extractor was unreachable from JS: the Kotlin seam
 * (`ExtractorService`) was only ever started by an unexposed intent, and no bridge method called it.
 * So the enhanced APK carried a working resolver that nothing asked.
 *
 * Contract (see `apps/web/src/lib/native.ts`):
 *   - `available()` → `{ installed, flavour }`. `installed=false` in the standard APK; JS then takes
 *     the honest, shorter route instead of pretending a native path exists.
 *   - `resolve({ videoId, preferItag })` → `{ ok: true, ...resolved }` or `{ ok: false, reason }`.
 *     Never rejects the call: a resolution failure is a value, and the JS ladder is allowed to
 *     continue to its next rung without a rejected promise turning into an unhandled rejection.
 *
 * Resolution can take many seconds — a player request, a BotGuard round trip, sometimes a signature
 * decipher. It runs on [Dispatchers.IO] and is bounded by [TIMEOUT_MS], because a call that never
 * returns is worse than one that fails: the UI would sit on a spinner with no way out.
 */
@CapacitorPlugin(name = "MashupExtractor")
class ExtractorPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun load() {
        // Nothing to hook up: the delegate is installed by MainActivity before the bridge loads.
        // This override exists to document that fact for the next reader.
    }

    @PluginMethod
    fun available(call: PluginCall) {
        val js = JSObject()
        js.put("installed", Extractor.available)
        // Reported so a bug report names the APK it came from. The GPL flavour is the only one that
        // can answer "installed", and pretending otherwise would send someone chasing a licence split
        // that is not the problem.
        js.put("flavour", if (Extractor.available) "withNativeExtractor" else "standard")
        call.resolve(js)
    }

    @PluginMethod
    fun resolve(call: PluginCall) {
        val videoId = call.getString("videoId")
        if (videoId.isNullOrBlank()) {
            call.reject("videoId is required")
            return
        }
        val preferItag = call.getInt("preferItag") ?: 0

        if (!Extractor.available) {
            // A missing capability, not a failure: the caller draws a different conclusion from
            // "there is no extractor in this APK" than from "the extractor ran and found nothing".
            call.resolve(
                JSObject().put("ok", false).put("reason", "extractor_not_installed"),
            )
            return
        }

        scope.launch {
            val outcome = withTimeoutOrNull(TIMEOUT_MS) {
                Extractor.resolveStream(videoId, preferItag)
            }

            if (outcome == null) {
                resolveOnBridge(call, JSObject().put("ok", false).put("reason", "timeout"))
                return@launch
            }

            val result = outcome.getOrNull()
            if (result == null) {
                val message = outcome.exceptionOrNull()?.message ?: "unknown_error"
                resolveOnBridge(
                    call,
                    JSObject()
                        .put("ok", false)
                        .put("reason", "extraction_failed")
                        // Truncated: this string is shown in a toast and written to the boot log.
                        .put("detail", message.take(300)),
                )
            } else {
                // The extractor already produced JSON; hand it back under `ok` so the JS side has one
                // shape to read instead of two.
                val js = JSObject()
                js.put("ok", true)
                try {
                    val obj = JSObject(result)
                    for (key in obj.keys()) js.put(key, obj.get(key))
                } catch (t: Throwable) {
                    // Malformed JSON from a GPL class we do not control must not become a crash in
                    // the bridge thread; report it as an extraction failure instead.
                    resolveOnBridge(
                        call,
                        JSObject()
                            .put("ok", false)
                            .put("reason", "bad_extractor_json")
                            .put("detail", (t.message ?: "unparseable result").take(200)),
                    )
                    return@launch
                }
                resolveOnBridge(call, js)
            }
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /**
     * Capacitor calls must be resolved on the bridge thread that owns them.
     *
     * `bridge` is what marshals the call; resolving straight from the coroutine would deliver the
     * result from an arbitrary IO thread, which Capacitor tolerates on some versions and not others.
     */
    private fun resolveOnBridge(call: PluginCall, js: JSObject) {
        // `bridge` is the inherited protected field (`getBridge()` is Java, so
        // `getBridge()`/`bridge` are the same object).
        val b = getBridge()
        if (b == null) {
            call.resolve(js)
        } else {
            b.executeOnMainThread { call.resolve(js) }
        }
    }

    private companion object {
        /**
         * Long enough for a PoToken WebView to come up cold on a slow phone (measured in seconds,
         * not milliseconds), short enough that a wedged extraction does not hold the play button
         * hostage. The JS ladder resumes the moment this elapses.
         */
        const val TIMEOUT_MS = 25_000L
    }
}
