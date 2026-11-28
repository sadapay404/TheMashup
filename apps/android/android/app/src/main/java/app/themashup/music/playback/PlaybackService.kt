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
import app.themashup.music.extractor.Extractor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

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
/**
 * A track the service may play without the page being awake.
 *
 * Top-level rather than nested: it is referenced from the companion object, from the service, and
 * from the plugin that receives it over the bridge, and a class nested inside a companion object
 * cannot be named from outside (`PlaybackService.Companion.UpcomingTrack` is what it actually is).
 */
data class UpcomingTrack(
    val id: String,
    val title: String,
    val artist: String,
    val artUrl: String?,
    val durationMs: Long,
    /** Absolute path when the track is downloaded; null means "resolve it when it is needed". */
    val localPath: String?,
)

/** A resolved source, ready to hand to the player. */
data class Playable(
    val uri: android.net.Uri,
    val durationMs: Long,
    val headers: Map<String, String>,
)

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private var mediaSession: MediaSession? = null

    /**
     * For background resolution only.
     *
     * The extractor is a suspending call that talks to the network; it must not run on the main
     * thread, and it must not outlive the service. `SupervisorJob` so one failed resolve cannot cancel
     * the scope and silently disable auto-advance for the rest of the session.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

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

        /*
         * Play through the queue without pausing between items.
         *
         * The comment that used to stand here said auto-advance was "driven by the JS queue" and that
         * ExoPlayer "simply stops" at the end of a track, with the UI deciding what came next. That
         * was the background-autoplay bug written down as if it were a design: a suspended WebView
         * cannot decide what comes next, so playback ended at the first track boundary whenever the
         * app was not on screen. The service now keeps a lookahead of its own; see [prefetchNext].
         */
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    PlaybackBridge.emitEnded()
                }
                /*
                 * The other half of the pending-seek contract (see PlaybackBridge.seekTo).
                 *
                 * A scrub that arrives while the track is still resolving has been parked; this is
                 * the first moment ExoPlayer will accept it. Consumed exactly once, and only when a
                 * request is actually waiting, so an ordinary READY transition costs one null check.
                 */
                if (playbackState == Player.STATE_READY) {
                    val target = PlaybackBridge.takePendingSeek()
                    if (target != null) {
                        player.seekTo(target)
                        PlaybackBridge.markPosition(target)
                    }
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
        /*
         * Native auto-advance.
         *
         * THE BUG THIS FIXES, stated plainly because it is an architectural mistake, not a missing
         * flag: the player held exactly ONE media item at a time and the JS queue owned track order.
         * When a song ended, `ended` was posted to the WebView and the page called `next()`. With the
         * app in the background the WebView is suspended, so nothing ran, nothing advanced, and the
         * user had to reopen the app to make the next song start. Measured symptom: a 30-minute track
         * plays to completion and then the music simply stops.
         *
         * "No battery restrictions" could never have helped: the service was never throttled. It was
         * waiting for an instruction that only a foregrounded page could send.
         *
         * The fix is to stop making playback depend on a live WebView. The service keeps its own
         * queue of upcoming tracks and, when one ends, resolves and appends the next itself. The JS
         * layer still owns queue *semantics* (shuffle, repeat, radio), and keeps telling us what is
         * next whenever it is alive to do so; this is the fallback for when it is not.
         */
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    /*
                     * Get ahead of the music as soon as the current track is ready.
                     *
                     * Doing this here rather than at the end is the difference between gapless and a
                     * gap: the next track is already in the player's timeline, so ExoPlayer rolls
                     * into it by itself with no wake-up, no resolve and no involvement from the page.
                     */
                    prefetchNext()
                    return
                }
                if (playbackState != Player.STATE_ENDED) return
                onEndedWithNothingQueued()
            }

            /*
             * Tell the page which track the player moved to.
             *
             * Two cases, one event, because the page needs the same thing from both: the *id* of what
             * is now playing.
             *
             *  - A user-initiated transition (the notification's next/previous, a Bluetooth button)
             *    moves the player without the page knowing. Before this, the page's index stayed
             *    where it was and the UI showed the previous song while the new one played.
             *  - An *automatic* transition is the background auto-advance working: the page may be
             *    suspended, and if it is awake it must follow along without calling `load()` — the
             *    audio is already playing, and reloading would restart the song from zero.
             *
             * The id, not an index: the player's item list is not the page's queue once items have
             * been trimmed from the front, so an index would point at the wrong song.
             */
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val id = mediaItem?.mediaId?.takeIf { it.isNotBlank() }
                if (id != null) {
                    NativeEvents.post("nowPlaying", mapOf("id" to id))
                    NativeEvents.post("trackChanged", mapOf("id" to id))
                }
                /*
                 * Refill the lookahead.
                 *
                 * The transition means the previous track has been consumed, so the timeline now ends
                 * at the item that just started. Without this the queue would be exactly one track
                 * deep and the *next* end of track would find nothing behind it — a fix that works
                 * for one song and then fails, which is worse than not shipping.
                 */
                prefetchNext()
            }
        })

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
        scope.cancel()
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
         * Repeat-one, as told to us by the page.
         *
         * The service cannot decide this for itself: whether the end of a track means "again", "next"
         * or "stop" is queue semantics, and those live in the store. When the page is alive it updates
         * this on every change; when it is not, the last value it sent is still the truth.
         */
        @Volatile
        var soloRepeat: Boolean = false

        /**
         * The upcoming tracks, as last described by the page.
         *
         * Deliberately a plain snapshot of *what to play next*, not a copy of the UI queue: the
         * service only needs ids and titles to keep audio running, and duplicating the whole queue
         * would give two sources of truth for shuffle and repeat. `setUpcoming()` replaces it
         * wholesale, so the page stays authoritative whenever it is running.
         */
        @Volatile
        private var upcoming: List<UpcomingTrack> = emptyList()

        /** Which entry of [upcoming] is the next one to play. */
        @Volatile
        private var upcomingIndex: Int = 0

        /** Guards [pendingResolve] so a slow extractor call cannot be started twice for one track. */
        @Volatile
        private var resolvingNext = false

        /**
         * Ids the service already appended by itself.
         *
         * When the page wakes up it needs to know to skip these instead of repeating them, otherwise
         * reopening the app replays a song the user already heard in the background.
         */
        private val appendedIds = ConcurrentHashMap.newKeySet<String>()

        /**
         * Replace the upcoming list. Called by the page whenever its queue changes.
         *
         * `index` is the position *in this list* that should play next, not the queue index — the page
         * slices the list down to what comes after the current track, which keeps the arithmetic here
         * trivial and avoids an off-by-one that would only show up at the end of a queue.
         */
        fun setUpcoming(tracks: List<UpcomingTrack>, index: Int) {
            upcoming = tracks
            upcomingIndex = index.coerceIn(0, maxOf(0, tracks.size - 1))
        }

        /**
         * Restart the cursor into [upcoming].
         *
         * Called when the page loads a track itself: the list it is about to send describes what
         * follows *that* track, so the old position into the old list is meaningless.
         */
        fun resetUpcomingCursor() {
            upcomingIndex = 0
        }

        /**
         * Give back the entry [nextUpcoming] just took.
         *
         * Bounded to the entry that was consumed, so a resolve that fails *after* the page replaced
         * the list cannot rewind into an unrelated one.
         */
        fun rewindUpcoming() {
            if (upcomingIndex > 0) upcomingIndex -= 1
        }

        /** What the page should consider already-played when it comes back. */
        fun drainAppended(): List<String> {
            val out = appendedIds.toList()
            appendedIds.clear()
            return out
        }


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
     * Keep the player at least one track ahead of the one that is playing.
     *
     * THIS is the fix for "autoplay stops in the background", and the mechanism matters. The service
     * used to hold a single media item while the WebView's queue decided what followed: at the end of
     * a track the service posted `ended` to a page that was suspended and then waited, forever. A
     * 30-second song and a 30-minute song failed identically, which is what ruled out anything to do
     * with track length, decoding or the screen.
     *
     * The fix is to stop depending on a waking WebView. The page hands down the next few tracks
     * (`setUpcoming`); the service resolves them itself through [Extractor] — no page, no bridge, no
     * JS timer — and *appends* them, so ExoPlayer has somewhere to go when the current track ends.
     * With `setPauseAtEndOfMediaItems(false)` the hand-off is gapless: there is no ENDED state to
     * react to on the normal path, which is why pre-appending is preferred over reacting to the end.
     *
     * Three deliberate decisions:
     *
     *  - **Append, never replace.** `setMediaItem` would drop the finished item and break "previous";
     *    `addMediaItem` keeps the history the notification's back button walks.
     *  - **One item of lookahead.** Refilled after each transition. A long queue materialised up
     *    front would be a second copy of the queue that can drift, and would resolve signed URLs for
     *    songs that may never play.
     *  - **Failure stops, it does not spin.** If the extractor cannot answer, `ended` is emitted and
     *    the service waits for the page. A background loop that retries a dead id forever is how a
     *    music app drains a battery.
     */
    private fun prefetchNext() {
        if (resolvingNext) return
        /*
         * Read the player from the session rather than from the bridge.
         *
         * `PlaybackBridge.attach()` is the last thing `startSession()` does, so during the very first
         * READY transition the bridge still holds null — the prefetch would be skipped exactly once,
         * at the start of every session, which is the hardest kind of bug to notice.
         */
        val p = mediaSession?.player ?: return
        // Already has something to play next — nothing to do.
        if (p.mediaItemCount > 0 && p.currentMediaItemIndex < p.mediaItemCount - 1) return
        val next = nextUpcoming()
        if (next == null) {
            // Genuinely the end of the queue. Nothing to pre-append; the ENDED handler emits `ended`.
            return
        }
        resolvingNext = true
        scope.launch {
            try {
                val playable = resolveForBackground(next)
                if (playable == null) {
                    Log.w(TAG, "no background source for ${next.id}; will stop at end of track")
                    /*
                     * Put the entry back.
                     *
                     * Taking it off the list and then failing would silently *skip* this song: the
                     * next prefetch would start from the track after it, and the user would never
                     * hear either. Restoring it means a later attempt — after the page wakes and
                     * refreshes the list — still has the right next track.
                     */
                    PlaybackService.rewindUpcoming()
                    return@launch
                }
                PlaybackBridge.append(playable, next)
                appendedIds.add(next.id)
            } finally {
                resolvingNext = false
            }
        }
    }

    /**
     * A track ended with nothing behind it.
     *
     * Only reached when [prefetchNext] could not get ahead of the music — a slow extractor, a queue
     * that ran dry, or repeat-one. Repeat is handled here because the service is the only participant
     * still awake when the screen is off, and "repeat one" that silently advances is indistinguishable
     * from autoplay being broken in the other direction.
     */
    private fun onEndedWithNothingQueued() {
        if (soloRepeat) {
            PlaybackBridge.replayCurrent()
            return
        }
        // One last attempt: the page may have refilled the list while we were resolving.
        if (nextUpcoming() != null) {
            prefetchNext()
            return
        }
        PlaybackBridge.emitEnded()
    }

    /** Resolve [next] to something ExoPlayer can start, or null. */
    private suspend fun resolveForBackground(next: UpcomingTrack): Playable? {
        // A downloaded file needs no network and cannot be truncated mid-song, so it is always the
        // first choice — this is also what makes a background queue work with no signal at all.
        next.localPath?.let { path ->
            val file = java.io.File(path)
            if (file.exists() && file.canRead()) {
                return Playable(android.net.Uri.fromFile(file), next.durationMs, emptyMap())
            }
        }

        // The native extractor, when this APK ships one. A `standard` APK has none, and then the
        // page's own resolver ladder is the only route — which needs the page. Reported honestly
        // rather than retried: this is why the GPL flavour is the one that auto-advances in the
        // background, and it is stated in the release notes rather than left as a mystery.
        /*
         * No native extractor in this APK.
         *
         * Reported as its own event rather than as a generic failure, because the fix is different
         * and the user cannot guess it: the `standard` flavour ships no GPL code and therefore has
         * no way to turn a video id into a playable URL on its own. Its background queue still works
         * for *downloaded* songs (handled above, no network needed); streaming needs the
         * `withNativeExtractor` build. Saying so once is the difference between a limitation and a
         * silent dead end.
         */
        if (!Extractor.available) {
            Log.w(TAG, "no native extractor; cannot continue to ${next.id} without the page")
            NativeEvents.post("autoplayUnavailable", mapOf("reason" to "no_extractor"))
            return null
        }

        val result = Extractor.resolveStream(next.id, 0)
        val json = result.getOrNull() ?: run {
            Log.w(TAG, "background resolve failed for ${next.id}: ${result.exceptionOrNull()?.message}")
            return null
        }
        return parseExtractorJson(json)
    }

    /**
     * Turn the extractor's JSON into a media item.
     *
     * Parsed with `org.json` rather than a data class because the payload crosses a JSON seam by
     * design (see [Extractor]); a shared class would couple the two halves of the app for no gain.
     */
    private fun parseExtractorJson(json: String): Playable? {
        return try {
            val o = org.json.JSONObject(json)
            val url = o.optString("url")
            if (url.isBlank()) {
                null
            } else {
                val headers = HashMap<String, String>()
                o.optJSONObject("headers")?.let { h ->
                    for (key in h.keys()) {
                        val v = h.optString(key, "")
                        if (key.isNotBlank() && v.isNotBlank()) headers[key] = v
                    }
                }
                Playable(
                    uri = android.net.Uri.parse(url),
                    durationMs = o.optLong("durationSec", 0L) * 1000L,
                    headers = headers,
                )
            }
        } catch (t: Throwable) {
            // A malformed payload is a bug in the extractor, not a reason to kill a background
            // session. Reported, and treated as "no source".
            Log.w(TAG, "unreadable extractor payload", t)
            null
        }
    }

    /**
     * The next track the service knows how to play, or null when it has run out.
     *
     * `@Synchronized` because it is called from the main thread (the ENDED handler) and from a
     * resolve coroutine, and it *mutates* the cursor. Two unsynchronised callers could take the same
     * entry and append the same song twice.
     */
    @Synchronized
    private fun nextUpcoming(): UpcomingTrack? {
        val list = upcoming
        val i = upcomingIndex
        if (i < 0 || i >= list.size) return null
        upcomingIndex = i + 1
        return list[i]
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

    /**
     * A seek that arrived before the player could take it.
     *
     * Set by [seekTo] when the player is not `STATE_READY`, consumed by the playback-state listener in
     * [PlaybackService.startSession] the moment it becomes ready. Without this, a scrub during the
     * initial buffer is discarded by ExoPlayer with no error and no retry — the UI moves, the audio
     * does not, and the next position report puts the thumb back where it started.
     */
    @Volatile private var pendingSeekMs: Long? = null
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
        /**
         * The track's video id.
         *
         * Stored as the media item's `mediaId` so a transition can be announced by identity. Absent
         * for a local file with no known id, which simply means no transition event.
         */
        videoId: String? = null,
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
            /*
             * `mediaId` carries the track id purely so transitions can be announced.
             *
             * Without it Media3 hands us a null id at the transition and there is no way to say
             * *which* track started — only its position in a list that is being trimmed.
             */
            .setMediaId(videoId.orEmpty())
            .setMediaMetadata(metadata)
            .build()

        // The MediaItem and its metadata are built here, off the player's thread, because building
        // them touches nothing the player owns. Only the three calls below have to be on main.
        onMain { p ->
            /*
             * A page-driven load wins the queue.
             *
             * `setMediaItem` drops the pre-appended items, which is right when the user picked a
             * different song — the background lookahead belongs to the old queue and playing it now
             * would be playing the wrong thing. The page pushes a fresh `setUpcoming` immediately
             * after `play()`, so the cursor restarts here rather than pointing into a stale list.
             */
            PlaybackService.resetUpcomingCursor()
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

    /**
     * Append a resolved track to the player and keep playing through it.
     *
     * Called from the service's background coroutine, so it hops to main like every other mutator.
     *
     * `setPauseAtEndOfMediaItems(false)` on the player plus a real item list is what makes this
     * gapless: ExoPlayer moves to the next item itself, with no JS, no broadcast and no wake-up of a
     * suspended WebView. The previous behaviour — one item at a time, re-set from JS — is why a
     * backgrounded app went quiet at the end of every song.
     *
     * Trimming is on the *finished* end only, and only beyond [TRIM_AT]: `removeMediaItem(0)` while
     * the user can still meaningfully press "previous" would break that button, so history is kept
     * for a reasonable window and then dropped to bound memory.
     */
    /**
     * Replay the current track from the start.
     *
     * Repeat-one, done natively. The page implements it too, but the page is exactly what is not
     * running when this matters.
     */
    fun replayCurrent() = onMain { p ->
        if (p.mediaItemCount == 0) return@onMain
        p.seekTo(p.currentMediaItemIndex, 0L)
        p.play()
        snapshot(p)
    }

    fun append(playable: Playable, next: UpcomingTrack) {
        if (playable.headers.isNotEmpty()) MediaItemHeaders.put(playable.uri.toString(), playable.headers)
        val metadata = MediaMetadata.Builder()
            .setTitle(next.title)
            .setArtist(next.artist)
            .setArtworkUri(next.artUrl?.let { Uri.parse(it) })
            .build()
        val item = MediaItem.Builder()
            .setUri(playable.uri)
            // The video id, so a transition can be reported as an identity the page can look up.
            .setMediaId(next.id)
            .setMediaMetadata(metadata)
            .build()

        onMain { p ->
            val atEnd = p.playbackState == Player.STATE_ENDED
            val addAt = p.mediaItemCount
            p.addMediaItem(item)
            if (atEnd) {
                /*
                 * The track already ended, so appending is not enough: the player is parked past the
                 * last item and will not move on its own. Seek onto the new item explicitly and
                 * start it. Without this the queue grows while nothing plays — a fix that looks
                 * right in the logs and is silent in the speaker.
                 */
                p.seekTo(addAt, 0L)
                p.prepare()
                p.play()
            }
            while (p.mediaItemCount > TRIM_AT && p.currentMediaItemIndex > 1) {
                p.removeMediaItem(0)
            }
            snapshot(p)
        }
        PlaybackService.current?.refreshNotification(startInForeground = true)
    }

    /** How many player items to keep before dropping the oldest. */
    private const val TRIM_AT = 8

    fun pause() = onMain { it.pause() }
    /**
     * Resume the loaded item, and *report whether there was one*.
     *
     * The JS side asks this exact question — `nativeResume()` returning true means "the player had
     * something and is now playing it", false means "nothing was loaded, load the track instead".
     * It was answering `true` unconditionally, because the plugin method resolved regardless of
     * whether the player had a media item. That made the recovery branch in `setPlaying` dead code,
     * and a cold start that restored a queue but never resolved a stream would show a pause icon
     * over a player holding nothing.
     *
     * Empty is not an error: it is the normal state before the first `play()` of a session.
     */
    fun resume(): Boolean {
        val p = player ?: return false
        var hadItem = false
        onMainSync {
            hadItem = it.mediaItemCount > 0
            it.play()
        }
        PlaybackService.current?.refreshNotification(startInForeground = true)
        return hadItem
    }
    fun seekTo(ms: Long) {
        val target = ms.coerceAtLeast(0L)
        /*
         * Why this is not just `p.seekTo(target)`.
         *
         * `ExoPlayer.seekTo()` is a **no-op unless the player has a prepared timeline**. The UI is
         * perfectly willing to accept a drag while the track is still resolving or buffering — that
         * is the whole point of a scrubber — and in that window the call is silently discarded. The
         * user then sees the thumb snap back and the song start from the beginning, which is the
         * long-standing "playback slider still has that silly issue" report.
         *
         * So: record the intent, apply it immediately if the player can take it, and otherwise leave
         * it as [pendingSeekMs] for the `STATE_READY` transition to consume. The listener below is
         * the other half of this contract.
         */
        cachedPositionMs = target
        onMain { p ->
            if (p.playbackState == Player.STATE_READY) {
                pendingSeekMs = null
                p.seekTo(target)
                snapshot(p)
            } else {
                /*
                 * Not seekable yet. Hold the request *and* keep the cached position at the target, so
                 * a poll that lands before the player is ready reports what the user asked for rather
                 * than the old offset. Otherwise the thumb visibly springs back in the second between
                 * the drag and the track becoming ready.
                 */
                pendingSeekMs = target
                cachedPositionMs = target
            }
        }
    }
    /**
     * Hand over the parked seek, if any, and clear it.
     *
     * Called from the service's own player listener, which lives on the main thread — the same thread
     * [seekTo] writes from — so the read/write pair needs no locking beyond @Volatile.
     */
    fun takePendingSeek(): Long? {
        val v = pendingSeekMs
        pendingSeekMs = null
        return v
    }

    /** Keep the reported position in step with a seek the service just applied. */
    fun markPosition(ms: Long) {
        cachedPositionMs = ms.coerceAtLeast(0L)
    }

    fun setVolume(v: Float) = onMain { it.volume = v.coerceIn(0f, 1f) }
    fun setRate(r: Float) = onMain { it.setPlaybackSpeed(r.coerceIn(0.5f, 3f)) }

    // Reads come from the snapshot. Touching the player here would reintroduce the exact crash these
    // accessors exist to avoid, and a synchronous hop to main from a plugin thread risks an ANR.
    fun positionMs(): Long = cachedPositionMs
    fun durationMs(): Long = cachedDurationMs
    fun isPlaying(): Boolean = cachedIsPlaying
}
