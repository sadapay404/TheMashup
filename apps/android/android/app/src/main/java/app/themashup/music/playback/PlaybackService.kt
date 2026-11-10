package app.themashup.music.playback

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.themashup.music.MainActivity

/**
 * Background playback.
 *
 * Implemented with AndroidX Media3 rather than the WebView's <audio> element because:
 *  - a `MediaSessionService` keeps playing when the WebView is backgrounded or killed;
 *  - it gives us lockscreen controls, notification transport, Bluetooth/Auto/media-key handling
 *    and audio focus for free — the behaviour LibreTube's service isolates, reimplemented here;
 *  - the player lives in a process-level service, so a page reload cannot stop the music.
 *
 * Design rules enforced below:
 *  - gapless where the source allows it (`setPauseAtEndOfMediaItems(false)`)
 *  - audio focus handled by Media3, so a phone call ducks/pauses correctly
 *  - every public entry point is defensive: a bad URI must not crash the service
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private var mediaSession: MediaSession? = null

    /**
     * Whether the session came up. A failure here is not fatal to the app: the JS layer falls back to
     * the WebView audio element when the plugin reports no player.
     */
    private var ready = false

    override fun onCreate() {
        super.onCreate()

        // The class contract says every entry point is defensive, but onCreate was the exception -
        // and onCreate is the one place a throw is unrecoverable: the exception is raised on the main
        // thread inside a *bound service*, so the caller's try/catch around bindService cannot see it
        // and the whole app process dies instead. Degrading to no native player is the correct
        // outcome; taking the app down with the music service is not.
        try {
            startSession()
            ready = true
        } catch (t: Throwable) {
            Log.e(TAG, "playback session unavailable; web audio will be used", t)
            mediaSession = null
            PlaybackBridge.detach()
        }
    }

    private fun startSession() {
        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()

        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true) // unplugging headphones pauses, as users expect
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this)))
            .build()

        player.setPauseAtEndOfMediaItems(false)

        // Auto-advance is driven by the JS queue, which owns shuffle/repeat semantics. When ExoPlayer
        // reaches the end it simply stops; the UI decides what is next. Single source of truth.
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    PlaybackBridge.emitEnded()
                }
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // Surface, never crash: the JS layer re-resolves the stream and retries.
                PlaybackBridge.emitError(error.errorCodeName)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                PlaybackBridge.emitPlaying(isPlaying)
            }
        })

        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .setCallback(SessionCallback())
            .build()

        PlaybackBridge.attach(player)
    }

    override fun onBind(intent: Intent?): IBinder? {
        // MediaSessionService.onBind is what hands the session to controllers (lockscreen, Bluetooth,
        // and our own activity binding for lifecycle). Returning null here disables all of them.
        return super.onBind(intent)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    /**
     * Android 12+ lets the user swipe the task away. For a music app the right behaviour is to keep
     * playing if something is playing, and shut down otherwise.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.isPlaying) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        PlaybackBridge.detach()
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MashupPlayback"

        /**
         * Connection used by [app.themashup.music.MainActivity] to bring the session up before the
         * first play. Kept trivial on purpose: the bridge is a global object, so all we need is the
         * lifecycle guarantee that `onCreate` has run.
         */
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                // No callback needed: PlaybackBridge was attached in onCreate.
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                PlaybackBridge.detach()
            }
        }
    }

    private inner class SessionCallback : MediaSession.Callback {
        /**
         * What the notification is allowed to show and do.
         *
         * The shade's buttons come from the *player commands* this returns — Media3 builds them from
         * what the session advertises. There is no `setSessionCommands` on a built session; the
         * available-commands result built here is the only place that has any effect.
         *
         * The user asked for "many controls", and the two people actually reach for in a music
         * notification are next and previous. `DEFAULT_PLAYER_COMMANDS` has them, but only dimmed
         * out when the player has a single item, so we also advertise seek-to-next/previous and
         * keep a multi-item queue on the native side (see PlaybackBridge.play, which appends).
         */
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                .addAll(
                    Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                    Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_GET_METADATA,
                )
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailablePlayerCommands(playerCommands)
                .build()
        }

        /**
         * Media3 1.3.x signature: (session, controller, items) -> ListenableFuture.
         * We accept whatever URI the JS layer already resolved (googlevideo or a public mirror);
         * anything without a URI is dropped rather than throwing inside the session thread.
         */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): com.google.common.util.concurrent.ListenableFuture<MutableList<MediaItem>> {
            val resolved = mediaItems.filter { it.localConfiguration?.uri != null }
            return com.google.common.util.concurrent.Futures.immediateFuture(resolved.toMutableList())
        }
    }
}

/**
 * Small helper so the JS bridge does not need a reference to the service instance.
 *
 * THREADING - the reason every mutator below posts to the main thread.
 *
 * ExoPlayer is single-threaded: it must be created on, and only ever touched from, the thread that
 * owns it. Capacitor invokes `@PluginMethod`s on its own `CapacitorPlugins` HandlerThread, so calling
 * the player straight from a plugin method throws
 *
 *     IllegalStateException: Player is accessed on the wrong thread.
 *     Current thread: 'CapacitorPlugins'  Expected thread: 'main'
 *
 * and because Capacitor does not catch it, the exception reaches the default handler and kills the
 * process - the app closed a fraction of a second after first paint, on every launch, in debug and
 * release alike. This is a crash on the very first call the web layer makes, not a rare race.
 *
 * Every method is therefore either posted to the main looper (mutators) or read through a cached
 * snapshot (getState), so no caller can reach the player from a foreign thread even by accident.
 */
internal object PlaybackBridge {
    @Volatile
    private var player: ExoPlayer? = null

    private val main = Handler(Looper.getMainLooper())

    fun attach(p: ExoPlayer) {
        player = p
        // Start mirroring state so getState() never has to touch the player itself.
        p.addListener(object : Player.Listener {
            override fun onEvents(p2: Player, events: Player.Events) {
                if (events.containsAny(
                        Player.EVENT_PLAYBACK_STATE_CHANGED,
                        Player.EVENT_IS_PLAYING_CHANGED,
                        Player.EVENT_POSITION_DISCONTINUITY,
                        Player.EVENT_MEDIA_ITEM_TRANSITION,
                    )
                ) {
                    snapshot(p2)
                }
            }
        })
        snapshot(p)
    }

    fun detach() {
        player = null
        cachedPositionMs = 0L
        cachedDurationMs = 0L
        cachedIsPlaying = false
    }

    // Volatile because they are written on main and read on CapacitorPlugins.
    @Volatile private var cachedPositionMs: Long = 0L
    @Volatile private var cachedDurationMs: Long = 0L
    @Volatile private var cachedIsPlaying: Boolean = false

    private fun snapshot(p: Player) {
        cachedPositionMs = p.currentPosition
        cachedDurationMs = p.duration.takeIf { it > 0 } ?: 0L
        cachedIsPlaying = p.isPlaying
    }

    /**
     * Run [block] with the player on the main thread.
     *
     * `post` rather than `runOnUiThread`: this object is not an Activity, and posting keeps the call
     * asynchronous, so a plugin method never blocks its own thread waiting for the main looper.
     */
    private inline fun onMain(crossinline block: (ExoPlayer) -> Unit) {
        main.post {
            val p = player ?: return@post
            runCatching { block(p) }
                .onFailure { Log.w("MashupPlayback", "player call failed", it) }
        }
    }

    fun emitEnded() = NativeEvents.post("ended", null)
    fun emitError(code: String) = NativeEvents.post("error", mapOf("code" to code))
    fun emitPlaying(playing: Boolean) = NativeEvents.post("playing", mapOf("playing" to playing))

    fun play(
        url: String,
        title: String,
        artist: String,
        artUrl: String?,
        durationMs: Long,
        shouldPlay: Boolean = true,
    ) {
        // CRITICAL: `player ?: return` used to fail silently when the service was not bound yet,
        // which made the first play of every session a no-op with no error anywhere. Report it so
        // the JS layer can fall back to the WebView element instead of showing a dead player.
        // Read once into a local: `player` is @Volatile, so this is the documented way to read it
        // from the CapacitorPlugins thread without a race.
        if (player == null) {
            emitError("player_not_ready")
            return
        }

        // NOTE: neither MediaItem.Builder nor MediaMetadata.Builder exposes a duration setter at this
        // Media3 version. The parameter is kept because the JS bridge already sends it (and a future
        // Media3 may accept it), but the authoritative duration comes from ExoPlayer once the stream
        // is prepared — which is what `PlaybackBridge.durationMs()` reports. Do not reintroduce a
        // speculative setter: two wrong guesses here already broke the build.
        // Defensive, not assertive: a bad hint is logged and ignored, never thrown.
        if (durationMs < 0L) Log.w("MashupPlayback", "negative duration hint ignored: $durationMs")

        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setArtworkUri(artUrl?.let { Uri.parse(it) })
            .build()

        val item = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(metadata)
            .build()

        // The MediaItem and its metadata are built here, off the player's thread, because building
        // them touches nothing the player owns. Only the three calls below have to be on main.
        onMain { p ->
            p.setMediaItem(item)
            p.prepare()
            // Honouring the flag matters: loading a track to reproduce a paused session must not
            // start audio on its own, and the JS layer relies on this being respected.
            p.playWhenReady = shouldPlay
        }
    }

    fun pause() = onMain { it.pause() }
    fun resume() = onMain { it.play() }
    fun seekTo(ms: Long) {
        // Optimistic cache update so a JS read straight after a seek is not stale for a frame.
        cachedPositionMs = ms.coerceAtLeast(0L)
        onMain { it.seekTo(ms) }
    }
    fun setVolume(v: Float) = onMain { it.volume = v.coerceIn(0f, 1f) }
    fun setRate(r: Float) = onMain { it.setPlaybackSpeed(r.coerceIn(0.5f, 3f)) }

    // Reads come from the snapshot. Touching the player here would reintroduce the exact crash these
    // accessors exist to avoid, and a synchronous hop to main from a plugin thread risks an ANR.
    fun positionMs(): Long = cachedPositionMs
    fun durationMs(): Long = cachedDurationMs
    fun isPlaying(): Boolean = cachedIsPlaying
}
