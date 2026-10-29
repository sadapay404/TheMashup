package local.themashup.music.core.player

import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionResult
import local.themashup.music.TheMashupApp

/**
 * Media3 session service — the notification, lock-screen, bluetooth and
 * Android Auto surface for playback. The ExoPlayer instance is created here
 * (lifecycle owner), attached to the shared [PlaybackEngine], and released
 * with the service.
 *
 * Button routing: PLAY/PAUSE/SEEK/STOP act on the player natively (engine
 * observes and mirrors state); NEXT/PREV/REPEAT/SHUFFLE are intercepted and
 * routed through the engine because queue sequencing is engine-owned (web
 * audioEngine parity) — the command is rejected afterwards so the player's
 * single-item timeline never double-handles it.
 */
class TheMashupPlayerService : MediaSessionService() {

    private var mediaSession: MediaSession? = null
    private val engine: PlaybackEngine
        get() = (application as TheMashupApp).container.player

    override fun onCreate() {
        super.onCreate()
        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()
        val player = ExoPlayerFactory.create(
            this,
            audioAttributes,
        )
        engine.attachPlayer(player)
        mediaSession = MediaSession.Builder(this, player)
            .setCallback(SessionCallback(engine))
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mediaSession?.let { session ->
            engine.detachPlayer(session.player)
            session.player.release()
            session.release()
        }
        mediaSession = null
        super.onDestroy()
    }
}

/** Builds the playback ExoPlayer: audio focus + unplug-pause + wake lock. */
private object ExoPlayerFactory {
    fun create(
        context: android.content.Context,
        audioAttributes: AudioAttributes,
    ): androidx.media3.exoplayer.ExoPlayer =
        androidx.media3.exoplayer.ExoPlayer.Builder(context)
            .setAudioAttributes(audioAttributes, true) // handle audio focus
            .setHandleAudioBecomingNoisy(true) // pause on unplug/headset off
            .build()
            .also { it.setWakeMode(C.WAKE_MODE_LOCAL) }
}

private class SessionCallback(
    private val engine: PlaybackEngine,
) : MediaSession.Callback {

    override fun onPlayerCommandRequest(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        playerCommand: Int,
    ): Int {
        when (playerCommand) {
            Player.COMMAND_SEEK_TO_NEXT,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            -> {
                engine.nextTrack()
                return SessionResult.RESULT_ERROR_NOT_SUPPORTED
            }
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            -> {
                engine.prevTrack()
                return SessionResult.RESULT_ERROR_NOT_SUPPORTED
            }
            Player.COMMAND_SET_REPEAT_MODE -> {
                engine.cycleRepeat()
                return SessionResult.RESULT_ERROR_NOT_SUPPORTED
            }
            Player.COMMAND_SET_SHUFFLE_MODE -> {
                engine.toggleShuffle()
                return SessionResult.RESULT_ERROR_NOT_SUPPORTED
            }
        }
        return super.onPlayerCommandRequest(session, controller, playerCommand)
    }
}
