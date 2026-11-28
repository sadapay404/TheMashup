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
            videoId = call.getString("id"),
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

    /**
     * Tell the service what to play after the current track.
     *
     * The page remains the source of truth for queue order, shuffle and repeat; it simply hands the
     * already-computed "next few tracks" down so the service can continue without it. Sending an empty
     * list is meaningful — it means "this is the end", and the service stops rather than guessing.
     *
     * `tracks` is a list of `{id, title, artist, artUrl, durationMs, localPath}`. Only what the
     * service needs to build a media item and resolve a stream; nothing here duplicates shuffle or
     * repeat logic.
     */
    @PluginMethod
    fun setUpcoming(call: PluginCall) {
        val arr = call.getArray("tracks")
        val tracks = ArrayList<UpcomingTrack>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val id = o.optString("id").takeIf { it.isNotBlank() } ?: continue
                tracks.add(
                    UpcomingTrack(
                        id = id,
                        title = o.optString("title", ""),
                        artist = o.optString("artist", ""),
                        artUrl = o.optString("artUrl").takeIf { it.isNotBlank() },
                        durationMs = o.optLong("durationMs", 0L),
                        localPath = o.optString("localPath").takeIf { it.isNotBlank() },
                    ),
                )
            }
        }
        PlaybackService.setUpcoming(tracks, call.getInt("index") ?: 0)
        call.resolve()
    }

    /**
     * Repeat-one, mirrored from the page.
     *
     * The service has to know this, because at the end of a track it is the service that decides
     * whether to replay or advance — and it is the only participant still running when the screen is
     * off.
     */
    @PluginMethod
    fun setRepeat(call: PluginCall) {
        PlaybackService.soloRepeat = call.getString("mode") == "one"
        call.resolve()
    }

    /**
     * Tracks the service played on its own while the page was suspended.
     *
     * Without this the app would resume showing the pre-background queue and, on the next render,
     * quietly replay songs the user already heard. The page uses the ids to catch up its index.
     */
    @PluginMethod
    fun drainAppended(call: PluginCall) {
        val js = JSObject()
        js.put("ids", com.getcapacitor.JSArray(PlaybackService.drainAppended()))
        call.resolve(js)
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
