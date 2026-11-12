package app.themashup.music.playback

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import java.util.concurrent.TimeUnit as JTimeUnit
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.HttpDataSource
import app.themashup.music.notify.NotifyChannels
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.themashup.music.MainActivity
import app.themashup.music.R

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
     * Force a notification refresh.
     *
     * Media3 1.3.1 predates `triggerNotificationUpdate()`, so this goes through the one public entry
     * point that exists here: `onUpdateNotification(session, startInForeground)`. Must be called on
     * the main thread — every caller already is.
     *
     * `startInForeground` is not a hint, it is a demand: `true` promotes the service, `false` only
     * re-posts. Passing `true` while paused would keep the service in the foreground forever, so the
     * callers pass the player's own play-when-ready rather than a constant.
     */
    fun refreshNotification(startInForeground: Boolean) {
        val session = mediaSession ?: return
        runCatching { onUpdateNotification(session, startInForeground) }
            .onFailure { Log.w(TAG, "notification refresh failed", it) }
    }

    /**
     * Whether the session came up. A failure here is not fatal to the app: the JS layer falls back to
     * the WebView audio element when the plugin reports no player.
     */
    private var ready = false

    override fun onCreate() {
        super.onCreate()

        // Create the notification channel before the session comes up so Media3 can post the
        // playback foreground notification immediately. Android 8+ requires a channel; on older
        // releases this is a no-op.
        createNotificationChannel()

        // The class contract says every entry point is defensive, but onCreate was the exception -
        // and onCreate is the one place a throw is unrecoverable: the exception is raised on the main
        // thread inside a *bound service*, so the caller's try/catch around bindService cannot see it
        // and the whole app process dies instead. Degrading to no native player is the correct
        // outcome; taking the app down with the music service is not.
        try {
            startSession()
            current = this
            ready = true
        } catch (t: Throwable) {
            Log.e(TAG, "playback session unavailable; web audio will be used", t)
            mediaSession = null
            PlaybackBridge.detach()
        }
    }

    /**
     * Create the notification channels.
     *
     * Delegated to [NotifyChannels] so there is exactly one definition of every channel id and
     * importance. This service used to own a copy, the download service owned another, and a message
     * posted to a channel that had not been created by *that* process was dropped silently by Android.
     */
    private fun createNotificationChannel() = NotifyChannels.ensure(this)

    private fun startSession() {
        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()

        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true) // unplugging headphones pauses, as users expect
            .setWakeMode(C.WAKE_MODE_NETWORK)
            /*
             * Header-aware data source.
             *
             * A natively resolved URL carries its own request headers (Referer / User-Agent). Without
             * them the CDN answers 403, which the UI can only report as "playback failed". See
             * [MediaItemHeaders].
             */
            .setMediaSourceFactory(DefaultMediaSourceFactory(MediaItemHeaders.defaultFactory(this)))
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
                /*
                 * Surface, never crash — but surface *everything*.
                 *
                 * This used to emit `error.errorCodeName` and nothing else. That string says
                 * "ERROR_CODE_IO_BAD_HTTP_STATUS" and then stops, which is the least useful half of
                 * the answer: it does not say which status, from which URL, or how many bytes had
                 * been read when it happened. Every "the song stops" report has therefore been
                 * argued about instead of measured.
                 *
                 * The three numbers that actually separate the candidate causes:
                 *  - the HTTP status: 403 mid-stream is a token/CDN refusal, 404 is a dead URL,
                 *    5xx is the edge failing, and no status at all is a socket/dial problem.
                 *  - the position: how many seconds of audio were successfully delivered before the
                 *    cut. A cut near a constant wall-clock offset is a gated stream being truncated;
                 *    a cut that moves around is a network fault.
                 *  - the URL's shape: whether it carries `pot=`, which is the literal token. Its
                 *    presence with a 403 says the token was rejected; its absence with a 403 says one
                 *    was required and never sent. Those are different problems with different fixes.
                 *
                 * Emitted as an event so the JS layer still re-resolves and retries exactly as
                 * before; the extra fields are inert to the existing handler.
                 */
                val cause = error.cause
                val status = (cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
                PlaybackBridge.emitError(
                    code = error.errorCodeName,
                    status = status,
                    positionMs = PlaybackBridge.positionMs(),
                    detail = cause?.message?.take(180),
                )
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
            /*
             * The notification's buttons come from this layout, not from the player's commands.
             *
             * Media3 only ever puts play/pause, previous and next in the shade by default, and next
             * and previous are *dimmed* whenever the player holds a single item — which it always
             * does here, because the JS queue owns track ordering. The result was a notification
             * with one working button, which is the "notification must carry many controls" report.
             *
             * Adding a custom layout is not enough on its own: the same commands must also be
             * advertised as available session commands in [SessionCallback.onConnect], or the
             * buttons render but do nothing when tapped.
             */
            .setCustomLayout(notificationControls())
            .build()

        /*
         * The foreground notification.
         *
         * Provided by [NowPlayingNotification], which wraps the stock Media3 provider with the three
         * things a music app needs and the library does not do by default: our own single-colour small
         * icon (the default dot is dropped by several OEM skins, which is one way a playback
         * notification silently never appears), the playback channel, and an ongoing flag so the entry
         * cannot be swiped away while audio is still coming out of the speaker. This is the shape
         * LibreTube uses; see that class for what was copied and what was deliberately not.
         *
         * The transport row (previous / play-pause / next), the seek bar and the artwork all still come
         * from the library. The four extra buttons — shuffle, repeat, like, stop — come from the custom
         * layout set on the session above, which is why they appear at all.
         */
        setMediaNotificationProvider(NowPlayingNotification(this))

        /*
         * Register the session with the service — the actual reason playback had no notification.
         *
         * `MediaSessionService` only calls `addSession()` from `onGetSession()`, i.e. when some
         * *controller* connects. Our app never creates a `MediaController`: playback is driven by
         * `PlaybackBridge` calling `player.setMediaItem()` straight on the ExoPlayer. So no controller
         * ever connected, `MediaNotificationManager` never registered the session, and every
         * notification refresh was a no-op — `getConnectedControllerForSession()` returned null and
         * `shouldShowNotification()` therefore always said no.
         *
         * Downloads were unaffected because `DownloadService` posts its own notification by hand, which
         * is exactly the asymmetry the user described: "the notification appears only when downloading
         * but not when playing songs".
         *
         * Registering here is idempotent (the service checks for an existing id) and it is what makes
         * Media3 attach its own internal controller, which in turn is what makes the shade entry real.
         */
        mediaSession?.let { addSession(it) }

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
        if (current === this) current = null
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
         * The live service, if one exists.
         *
         * [PlaybackBridge] is a singleton with no service reference — it only holds the ExoPlayer — so
         * a notification refresh requested from a bridge call has no other way back to the service.
         * Written in `onCreate`, cleared in `onDestroy`, both on the main thread.
         */
        @Volatile
        var current: PlaybackService? = null

        /**
         * Notification channel id for the playback foreground notification.
         *
         * Suffixed `v2` because Android freezes a channel's importance at creation: an upgrade that
         * reused the old id would keep LOW forever, and the notification would stay buried.
         */
        val NOTIFICATION_CHANNEL_ID = NotifyChannels.PLAYBACK
        const val NOTIFICATION_CHANNEL_NAME = "Playback"

        /** Custom notification actions. Declared here so layout and handler cannot disagree. */
        const val ACTION_SHUFFLE = "app.themashup.music.SHUFFLE"
        const val ACTION_REPEAT = "app.themashup.music.REPEAT"
        const val ACTION_LIKE = "app.themashup.music.LIKE"
        const val ACTION_STOP = "app.themashup.music.STOP"

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

    /**
     * The custom controls this app adds to the media notification.
     *
     * Media3 renders whatever the session advertises, so these are declared **once** here and used in
     * two places that must agree:
     *   - `MediaSession.Builder.setCustomLayout` — puts the button in the shade;
     *   - `SessionCallback.onConnect` — advertises the matching session command, without which the
     *     button is drawn but a tap does nothing.
     *
     * Actions are prefixed `app.themashup.music.` because they travel through the legacy
     * MediaSessionCompat path under a PendingIntent; an unprefixed action risks colliding with a
     * command another app sends to us.
     */
    private fun customCommand(action: String) = SessionCommand(action, Bundle.EMPTY)

    private fun notificationControls(): List<CommandButton> = listOf(
        CommandButton.Builder()
            .setSessionCommand(customCommand(ACTION_SHUFFLE))
            .setIconResId(R.drawable.ic_notif_shuffle)
            .setDisplayName(getString(R.string.notif_shuffle))
            .build(),
        CommandButton.Builder()
            .setSessionCommand(customCommand(ACTION_REPEAT))
            .setIconResId(R.drawable.ic_notif_repeat)
            .setDisplayName(getString(R.string.notif_repeat))
            .build(),
        CommandButton.Builder()
            .setSessionCommand(customCommand(ACTION_LIKE))
            .setIconResId(R.drawable.ic_notif_like)
            .setDisplayName(getString(R.string.notif_like))
            .build(),
        CommandButton.Builder()
            .setSessionCommand(customCommand(ACTION_STOP))
            .setIconResId(R.drawable.ic_notif_stop)
            .setDisplayName(getString(R.string.notif_stop))
            .build(),
    )

    /**
     * The same actions, as commands the session will actually accept.
     *
     * Started from the *default* session commands and extended with ours. There is no
     * `SessionCommands.Builder.addAllSessionCommands()` in media3 1.3.1 — that method exists on
     * `ConnectionResult.Builder`, which is a different builder — so the previous version of this
     * function did not compile. Building from [MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS]
     * is the equivalent and does not depend on a member that is not there.
     */
    private fun customSessionCommands(): SessionCommands {
        val builder = SessionCommands.Builder()
            .addSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.commands)
        for (button in notificationControls()) {
            val cmd = button.sessionCommand ?: continue
            builder.add(cmd)
        }
        return builder.build()
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
                // Custom buttons are inert unless their commands are advertised here as well.
                .setAvailableSessionCommands(customSessionCommands())
                .build()
        }

        /**
         * A tap on one of the notification's custom buttons.
         *
         * Shuffle / repeat / like are *state* questions and the JS layer owns that state, so the tap
         * is forwarded to it as an event and the UI updates there. Stop is different: it must also
         * clear the player and take the notification away, which only the service can do, so it is
         * handled here and mirrored to JS so the page does not keep showing a track that is gone.
         */
        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                ACTION_SHUFFLE -> NativeEvents.post("toggleShuffle", null)
                ACTION_REPEAT -> NativeEvents.post("toggleRepeat", null)
                ACTION_LIKE -> NativeEvents.post("toggleLike", null)
                ACTION_STOP -> {
                    PlaybackBridge.stop()
                    NativeEvents.post("stopped", null)
                }
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        /**
         * The path a request from a *controller* actually takes.
         *
         * `PlaybackBridge.play()` sets the item on the player directly, which bypasses this. But
         * resumption from the notification or a Bluetooth headset — and any future
         * `MediaController.setMediaItems` — arrives here, and an empty list would be handed to the
         * player unchanged: no media item, no playback, no error. Delegating to `onAddMediaItems`
         * keeps one implementation of "what counts as playable".
         */
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            // `onAddMediaItems` answers with a future of the *list*; the wrapper that supplies the
            // start position is a second, separate step. Returning the list future directly is a type
            // error, not a shortcut.
            return Futures.transform(
                onAddMediaItems(mediaSession, controller, mediaItems),
                { list ->
                    MediaSession.MediaItemsWithStartPosition(list, startIndex, startPositionMs)
                },
                MoreExecutors.directExecutor(),
            )
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
        ): ListenableFuture<MutableList<MediaItem>> {
            val resolved = mediaItems.filter { it.localConfiguration?.uri != null }
            return Futures.immediateFuture(resolved.toMutableList())
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

    /*
     * When the cache was last refreshed, and whether a main-thread read is already in flight.
     *
     * `p.currentPosition` is a cheap in-memory field, but it may only be read on the thread that
     * owns the player, so the read itself has to be posted. Coalescing means a 1 Hz poll costs one
     * post per second no matter how many callers ask.
     */
    @Volatile private var cacheStampMs: Long = 0L
    @Volatile private var readInFlight = false

    private fun snapshot(p: Player) {
        cachedPositionMs = p.currentPosition
        cachedDurationMs = p.duration.takeIf { it > 0 } ?: 0L
        cachedIsPlaying = p.isPlaying
        cacheStampMs = SystemClock.elapsedRealtime()
    }

    /**
     * True when the cache is stale enough to be worth refreshing.
     *
     * 250 ms is chosen so the UI's 1 Hz poll always sees fresh data while an event burst (a seek,
     * a transition) still wins: the stamp is updated by [snapshot] too, so events suppress a
     * redundant read.
     */
    private fun cacheIsStale(): Boolean =
        SystemClock.elapsedRealtime() - cacheStampMs >= 250L

    /**
     * Refresh the position cache **before** returning the value.
     *
     * This is a correctness fix to a fix, and the distinction matters.
     *
     * The cache used to be written only from a `Player.Listener` on playback-state / is-playing /
     * discontinuity / transition events. A track playing normally fires none of those: the position
     * advances continuously and ExoPlayer does not treat that as an event. So `getState()` answered
     * `positionMs = 0` for the whole song, and the JS stall watchdog — which correctly treats "the
     * position stopped changing" as a stall — declared one a few seconds in and reloaded the stream.
     *
     * The first attempt at a fix posted the read to the main looper and returned immediately. The
     * caller then read the *old* cache on its own thread, so it changed nothing: the release that
     * was supposed to make playback work is the one after which nothing played at all. Posting is
     * not refreshing. The read has to have completed by the time this returns, or the caller is
     * answering a question nobody asked.
     *
     * So this blocks caller until the main thread has served one read. It is safe because the
     * callers are Capacitor plugin threads (`CapacitorPlugins` / bridge), never the main thread —
     * and [onMainSync] detects the main-thread case rather than deadlocking on it if that ever
     * changes. The read itself is a field access on the owning thread; it costs microseconds.
     */
    fun refreshCache() {
        onMainSync { snapshot(it) }
    }

    /**
     * Run [block] with the player on the main thread.
     *
     * `post` rather than `runOnUiThread`: this object is not an Activity, and posting keeps the call
     * asynchronous, so a plugin method never blocks its own thread waiting for the main looper.
     */
    /**
     * Run [block] with the player on the main thread and **wait for it to finish**.
     *
     * Used only by [refreshCache], where the whole point is that the value is current when the
     * caller reads it. Everything that does not need an answer keeps using the fire-and-forget
     * [onMain].
     *
     * Two guards, because a synchronous cross-thread wait is the classic place to hang an app:
     *  - if we are already on the main thread, run inline. Posting and waiting from the main thread
     *    would wait forever for a queue we are blocking.
     *  - the wait is bounded. A 250 ms ceiling is longer than any legitimate field read and short
     *    enough that a wedged main looper degrades one position update instead of freezing the UI
     *    thread's caller. On timeout the caller gets the previous cache, which is stale but safe.
     */
    private inline fun onMainSync(crossinline block: (ExoPlayer) -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            player?.let { runCatching { block(it) } }
            return
        }
        val done = java.util.concurrent.CountDownLatch(1)
        main.post {
            try {
                player?.let { runCatching { block(it) } }
            } finally {
                done.countDown()
            }
        }
        done.await(250, JTimeUnit.MILLISECONDS)
    }

    private inline fun onMain(crossinline block: (ExoPlayer) -> Unit) {
        main.post {
            val p = player ?: return@post
            runCatching { block(p) }
                .onFailure { Log.w("MashupPlayback", "player call failed", it) }
        }
    }

    fun emitEnded() = NativeEvents.post("ended", null)
    /**
     * Emit a playback error with everything needed to diagnose it.
     *
     * Null fields are dropped rather than sent as nulls: the JS handler tests for presence, and a
     * `"status": null` would read as "there was no status" in some paths and "status unknown" in
     * others, which is exactly the ambiguity this is meant to remove.
     */
    fun emitError(
        code: String,
        status: Int? = null,
        positionMs: Long = -1,
        url: String? = null,
        detail: String? = null,
    ) = NativeEvents.post(
        "error",
        buildMap {
            put("code", code)
            if (status != null) put("status", status)
            if (positionMs >= 0) put("positionMs", positionMs)
            val resolvedUrl = url ?: player?.currentMediaItem?.localConfiguration?.uri?.toString()
            if (!resolvedUrl.isNullOrBlank()) put("host", urlHost(resolvedUrl))
            if (!detail.isNullOrBlank()) put("detail", detail)
        },
    )

    /** Host only. The query string is a signed token and must not land in a log or a screenshot. */
    private fun urlHost(url: String): String = runCatching {
        java.net.URI(url).host ?: ""
    }.getOrDefault("")

    /** The URL currently loaded, so an error can name what failed without the JS layer guessing. */
    private fun currentUrl(): String? = player?.currentMediaItem?.localConfiguration?.uri?.toString()
    fun emitPlaying(playing: Boolean) = NativeEvents.post("playing", mapOf("playing" to playing))

    fun play(
        url: String,
        title: String,
        artist: String,
        artUrl: String?,
        durationMs: Long,
        shouldPlay: Boolean = true,
        /**
         * Request headers the media URL needs, if the resolver reported any.
         *
         * Registered before the item is handed to the player so the very first request already has
         * them; a header registered afterwards would arrive after the 403 it was meant to prevent.
         */
        headers: Map<String, String> = emptyMap(),
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

        if (headers.isNotEmpty()) MediaItemHeaders.put(url, headers)

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
            /*
             * Ask for the notification now.
             *
             * Media3 refreshes on `EVENT_MEDIA_METADATA_CHANGED`, `EVENT_TIMELINE_CHANGED` and the
             * play-state changes it observes through its *internal controller*. Those events do fire,
             * but the first one is emitted while the player is still `STATE_IDLE`-adjacent, and
             * `shouldRunInForeground()` refuses anything that is not READY or BUFFERING. Triggering the
             * refresh after `prepare()` closes that window: by the time the service reads the player it
             * is BUFFERING and the notification is allowed to promote to foreground.
             *
             * This is also what the user meant by "appears when playing" — the notification has to be
             * there for the whole session, not only after a state change that happens to land later.
             */
            PlaybackService.current?.refreshNotification(startInForeground = shouldPlay)
        }
    }

    /**
     * End playback outright — the native half of the X on the song card.
     *
     * Pause is not enough: a paused Media3 session keeps its notification, its media item and its
     * lockscreen entry alive, so "stopped" still looked like "still playing, just quiet". Clearing
     * the item after stopping is what makes the notification disappear.
     */
    fun stop() {
        onMain { p ->
            p.pause()
            p.stop()
            p.clearMediaItems()
            snapshot(p)
        }
    }

    fun pause() = onMain { it.pause() }
    fun resume() = onMain {
        it.play()
        PlaybackService.current?.refreshNotification(startInForeground = true)
    }
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
