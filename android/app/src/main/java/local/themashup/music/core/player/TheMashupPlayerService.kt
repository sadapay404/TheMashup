package local.themashup.music.core.player

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.FlagSet
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommands
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import local.themashup.music.R
import local.themashup.music.TheMashupApp
import local.themashup.music.core.domain.RepeatMode

private const val FOREGROUND_ID = 1001

/** Media3 owns the media-style notification and foreground-service lifecycle.
 * The UI uses the in-process engine rather than binding a MediaController, so
 * the session must be explicitly registered with this service. Otherwise the
 * service never starts monitoring playback or publishing a notification.
 *
 * CRITICAL (P0): On Android 12+, startForegroundService() must be followed by
 * startForeground() within 5 seconds. Media3 only calls startForeground() when
 * the player is ready AND playing. To avoid ForegroundServiceDidNotStartInTimeException,
 * this service posts a "Connecting…" placeholder notification in onCreate()
 * before any network work happens. Media3 replaces it with the real playback
 * notification once the player is attached and playing.
 */
@OptIn(UnstableApi::class)
class TheMashupPlayerService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var exoPlayer: ExoPlayer? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val engine: PlaybackEngine
        get() = (application as TheMashupApp).container.player

    override fun onCreate() {
        super.onCreate()

        // ── P0: Post a placeholder foreground notification BEFORE anything else ──
        // This satisfies Android 12+'s 5-second startForeground() deadline.
        // Media3's DefaultMediaNotificationProvider will replace it once playback starts.
        startForeground(FOREGROUND_ID, buildPlaceholderNotification())

        // Media3 notification provider for the real playback UI.
        val provider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId("themashup_playback")
            .setChannelName(R.string.playback_notification_channel)
            .setNotificationId(FOREGROUND_ID)
            .build()
            .apply { setSmallIcon(R.drawable.ic_stat_music) }
        setMediaNotificationProvider(provider)

        // Ensure the notification channel exists (Android 8+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                "themashup_playback",
                getString(R.string.playback_notification_channel),
                android.app.NotificationManager.IMPORTANCE_LOW
            )
            channel.description = "TheMashup playback controls"
            (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .createNotificationChannel(channel)
        }

        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()
        val rawPlayer = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
            .also { it.setWakeMode(C.WAKE_MODE_LOCAL) }
        exoPlayer = rawPlayer
        engine.attachPlayer(rawPlayer)

        val sessionPlayer = QueueSessionPlayer(rawPlayer, engine)
        val sessionActivity = packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
            PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val session = MediaSession.Builder(this, sessionPlayer)
            .setCallback(TransportOnlyExternalControllers(packageName))
            .apply { sessionActivity?.let { setSessionActivity(it) } }
            .build()
        mediaSession = session
        // This app controls the player directly. With no bound UI controller,
        // onGetSession is otherwise never invoked to add the session for us.
        addSession(session)
        // Repeat ALL is implemented by the app queue, not the one-item Exo
        // timeline, so publish the app's repeat mode to system controllers.
        serviceScope.launch {
            engine.state.map { it.repeat }.distinctUntilChanged().collect { sessionPlayer.publishRepeat(it) }
        }
    }

    /** Builds a minimal "Connecting…" foreground notification so Android does not
     * kill the service for failing to call startForeground() within 5 seconds. */
    private fun buildPlaceholderNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return NotificationCompat.Builder(this, "themashup_playback").build()
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, "themashup_playback")
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle("TheMashup")
            .setContentText("Connecting…")
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        serviceScope.cancel()
        mediaSession?.let { session ->
            if (isSessionAdded(session)) removeSession(session)
            session.release()
        }
        mediaSession = null
        exoPlayer?.let { player ->
            engine.detachPlayer(player)
            player.release()
        }
        exoPlayer = null
        stopForeground(true)
        super.onDestroy()
    }

    /** The ExoPlayer timeline contains only the active item, while TheMashup's
     * queue lives in PlaybackEngine. Advertise and route previous/next to that
     * queue instead of hiding them or letting the single-item player handle them.
     */
    @OptIn(UnstableApi::class)
    private class QueueSessionPlayer(
        player: Player,
        private val engine: PlaybackEngine,
    ) : ForwardingPlayer(player) {
        private val listenerBridges = mutableMapOf<Player.Listener, Player.Listener>()
        private var publishedRepeat: RepeatMode? = null

        override fun getRepeatMode(): Int = when (engine.state.value.repeat) {
            RepeatMode.OFF -> Player.REPEAT_MODE_OFF
            RepeatMode.ONE -> Player.REPEAT_MODE_ONE
            RepeatMode.ALL -> Player.REPEAT_MODE_ALL
        }

        fun publishRepeat(mode: RepeatMode) {
            if (mode == publishedRepeat) return
            publishedRepeat = mode
            val value = getRepeatMode()
            val events = Player.Events(FlagSet.Builder().add(Player.EVENT_REPEAT_MODE_CHANGED).build())
            listenerBridges.keys.toList().forEach {
                it.onRepeatModeChanged(value)
                it.onEvents(this, events)
            }
        }

        private fun withQueueCommands(commands: Player.Commands): Player.Commands = commands.buildUpon()
            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_NEXT)
            .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .build()

        override fun getAvailableCommands(): Player.Commands = withQueueCommands(super.getAvailableCommands())

        override fun isCommandAvailable(command: Int): Boolean = when (command) {
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> true
            else -> super.isCommandAvailable(command)
        }

        override fun addListener(listener: Player.Listener) {
            if (listenerBridges.containsKey(listener)) return
            val bridge = object : Player.Listener by listener {
                override fun onAvailableCommandsChanged(availableCommands: Player.Commands) {
                    listener.onAvailableCommandsChanged(withQueueCommands(availableCommands))
                }
                // Exo uses OFF for app-level repeat ALL; publish app state instead.
                override fun onRepeatModeChanged(repeatMode: Int) = Unit
            }
            listenerBridges[listener] = bridge
            super.addListener(bridge)
        }

        override fun removeListener(listener: Player.Listener) {
            listenerBridges.remove(listener)?.let { super.removeListener(it) }
        }

        override fun seekToPrevious() = engine.prevTrack()
        override fun seekToPreviousMediaItem() = engine.prevTrack()
        override fun seekToNext() = engine.nextTrack()
        override fun seekToNextMediaItem() = engine.nextTrack()

        override fun play() {
            when (engine.state.value.status) {
                PlayStatus.IDLE, PlayStatus.ERROR -> engine.togglePlay()
                PlayStatus.LOADING -> Unit // do not resume the previous item's paused timeline
                else -> super.play()
            }
        }

        override fun setRepeatMode(repeatMode: Int) {
            engine.setRepeat(when (repeatMode) {
                Player.REPEAT_MODE_ONE -> RepeatMode.ONE
                Player.REPEAT_MODE_ALL -> RepeatMode.ALL
                else -> RepeatMode.OFF
            })
        }

        override fun setShuffleModeEnabled(shuffleModeEnabled: Boolean) {
            engine.setShuffle(shuffleModeEnabled)
        }
    }

    /** Export the service for system/BT controls without exposing queue replacement to other apps. */
    @OptIn(UnstableApi::class)
    private class TransportOnlyExternalControllers(private val ownPackage: String) : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            if (controller.packageName == ownPackage) return super.onConnect(session, controller)
            val commands = Player.Commands.Builder().addAll(
                Player.COMMAND_PLAY_PAUSE,
                Player.COMMAND_PREPARE,
                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_NEXT,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                Player.COMMAND_SEEK_BACK,
                Player.COMMAND_SEEK_FORWARD,
                Player.COMMAND_SET_REPEAT_MODE,
                Player.COMMAND_SET_SHUFFLE_MODE,
                Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                Player.COMMAND_GET_TIMELINE,
                Player.COMMAND_GET_METADATA,
                Player.COMMAND_GET_AUDIO_ATTRIBUTES,
                Player.COMMAND_GET_VOLUME,
                Player.COMMAND_GET_DEVICE_VOLUME,
                Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS,
                Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS,
            ).build()
            return MediaSession.ConnectionResult.accept(SessionCommands.EMPTY, commands)
        }
    }
}
