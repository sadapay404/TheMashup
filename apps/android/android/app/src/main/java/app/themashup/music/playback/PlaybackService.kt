package app.themashup.music.playback

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
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
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session).build()

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

/** Small helper so the JS bridge does not need a reference to the service instance. */
internal object PlaybackBridge {
    private var player: ExoPlayer? = null

    fun attach(p: ExoPlayer) {
        player = p
    }

    fun detach() {
        player = null
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
        val p = player
        if (p == null) {
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

        p.setMediaItem(item)
        p.prepare()
        // Honouring the flag matters: loading a track to reproduce a paused session must not start
        // audio on its own, and the JS layer relies on this being respected.
        p.playWhenReady = shouldPlay
    }

    fun pause() { player?.pause() }
    fun resume() { player?.play() }
    fun seekTo(ms: Long) { player?.seekTo(ms) }
    fun setVolume(v: Float) { player?.volume = v.coerceIn(0f, 1f) }
    fun setRate(r: Float) { player?.setPlaybackSpeed(r.coerceIn(0.5f, 3f)) }
    fun positionMs(): Long = player?.currentPosition ?: 0L
    fun durationMs(): Long = player?.duration?.takeIf { it > 0 } ?: 0L
    fun isPlaying(): Boolean = player?.isPlaying == true
}
