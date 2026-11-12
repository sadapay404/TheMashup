package app.themashup.music.playback

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native → JS event bus.
 *
 * Native code must never assume a WebView exists (the activity can be dead while the service plays).
 * So events are buffered when no listener is attached and flushed on attach. This is what stops the
 * classic "audio keeps playing but the UI froze" bug.
 */
object NativeEvents {
    private val TAG = "TheMashupEvents"
    private val buffer = ArrayDeque<Pair<String, Map<String, Any?>?>>()
    private var sink: ((String, Map<String, Any?>?) -> Unit)? = null

    fun setSink(s: ((String, Map<String, Any?>?) -> Unit)?) {
        sink = s
        flush()
    }

    fun post(name: String, payload: Map<String, Any?>?) {
        val s = sink
        if (s == null) {
            if (buffer.size > 64) buffer.removeFirst()
            buffer.addLast(name to payload)
            return
        }
        try {
            s(name, payload)
        } catch (t: Throwable) {
            Log.w(TAG, "event delivery failed for $name", t)
        }
    }

    private fun flush() {
        val s = sink ?: return
        while (buffer.isNotEmpty()) {
            val (name, payload) = buffer.removeFirst()
            try {
                s(name, payload)
            } catch (t: Throwable) {
                Log.w(TAG, "flush failed for $name", t)
            }
        }
    }
}

@CapacitorPlugin(name = "MashupPlayer")
class MashupPlayerPlugin : Plugin() {

    override fun load() {
        NativeEvents.setSink { name, payload ->
            val js = JSObject()
            js.put("type", name)
            payload?.forEach { (k, v) -> js.put(k, v) }
            notifyListeners(name, js)
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("url is required")
            return
        }
        // Headers the resolver reported (Referer / User-Agent). Optional: a plain URL has none, and
        // an absent map must not read as "clear the headers".
        val headers = call.getObject("headers")?.let { obj ->
            val map = HashMap<String, String>()
            for (key in obj.keys()) {
                val value = obj.optString(key, "")
                if (key.isNotBlank() && value.isNotBlank()) map[key] = value
            }
            map
        } ?: emptyMap()

        PlaybackBridge.play(
            url = url,
            title = call.getString("title") ?: "",
            artist = call.getString("artist") ?: "",
            artUrl = call.getString("artUrl"),
            durationMs = call.getLong("durationMs") ?: 0L,
            // Defaults to true: a play() call has always meant "start playing".
            shouldPlay = call.getBoolean("shouldPlay") ?: true,
            headers = headers,
        )
        call.resolve()
    }

    /**
     * End playback and retire the notification.
     *
     * Distinct from [pause] on purpose: the X on the song card means "make it stop", and a paused
     * Media3 session keeps its media item, its lockscreen entry and its shade entry alive — so a
     * pause-based stop is why the player was still in the notification tray after the user closed it.
     */
    @PluginMethod
    fun stop(call: PluginCall) {
        PlaybackBridge.stop()
        call.resolve()
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        PlaybackBridge.pause()
        call.resolve()
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        // `resumed: false` means the player held no media item — the caller must load one instead of
        // assuming audio started. Previously this resolved unconditionally and the JS recovery branch
        // that depends on it could never run.
        val resumed = PlaybackBridge.resume()
        call.resolve(JSObject().put("resumed", resumed))
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        PlaybackBridge.seekTo(call.getLong("positionMs") ?: 0L)
        call.resolve()
    }

    /**
     * The current playhead, straight from the player rather than from the JS store.
     *
     * The seek bar needs this to decide whether a drag is a *seek* or a *reload*: if the store's
     * position and the player's disagree, a later `load()` will resume from the store's value and
     * visibly undo the drag. Cheap enough to call on release only.
     */
    @PluginMethod
    fun position(call: PluginCall) {
        PlaybackBridge.refreshCache()
        call.resolve(JSObject().put("positionMs", PlaybackBridge.positionMs()))
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        PlaybackBridge.setVolume((call.getDouble("volume") ?: 1.0).toFloat())
        call.resolve()
    }

    @PluginMethod
    fun setRate(call: PluginCall) {
        PlaybackBridge.setRate((call.getDouble("rate") ?: 1.0).toFloat())
        call.resolve()
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        // Refresh first. The cache is only written on player *events*, and steady playback emits
        // none, so without this the reported position was 0 for the whole song — which the JS stall
        // watchdog correctly read as a stall, then "recovered" by restarting the track.
        PlaybackBridge.refreshCache()
        val js = JSObject()
        js.put("positionMs", PlaybackBridge.positionMs())
        js.put("durationMs", PlaybackBridge.durationMs())
        js.put("isPlaying", PlaybackBridge.isPlaying())
        call.resolve(js)
    }
}
