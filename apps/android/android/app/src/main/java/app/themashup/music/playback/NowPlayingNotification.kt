package app.themashup.music.playback

import android.app.Notification
import android.content.Context
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import app.themashup.music.R
import com.google.common.collect.ImmutableList

/**
 * The playback notification, in the shape LibreTube uses.
 *
 * ### Why this class exists
 *
 * The user's report was precise: *"the notification appears only when downloading but not when
 * playing songs."* Downloads post from [app.themashup.music.download.DownloadService], which calls
 * `startForeground()` itself and therefore always shows something. Playback posts through Media3,
 * which decides for itself whether a notification is warranted, how it is iconised and whether the
 * user is allowed to swipe it away.
 *
 * Relying on the stock provider with builder defaults left three problems:
 *
 *  - the small icon was the library's generic dot, which several OEM skins drop outright;
 *  - the built notification has `setOngoing(false)`, so a media notification could be swiped away
 *    while audio kept playing — the opposite of LibreTube;
 *  - nothing forced the notification to post while *playing* as opposed to merely *prepared*, so a
 *    session that loaded a track and paused before the foreground promotion produced no shade entry.
 *
 * This mirrors LibreTube's `NowPlayingNotification.kt`: it wraps the stock provider, owns the
 * notification id, channel, small icon and the "ongoing" flag, and defers to the library for the
 * transport row, the seek bar and the artwork. Buttons come from the session's custom layout, which
 * [PlaybackService] supplies.
 *
 * ### What is deliberately *not* copied
 *
 * LibreTube re-creates a content intent on every build and calls `mediaSession.setSessionActivity()`
 * each time, because its activity is `singleTop` and it wants a tap to return to the player screen.
 * Our session activity is set once, in [PlaybackService.startSession], and our activity is already
 * `singleTop` + `CLEAR_TOP` in the manifest. Re-creating the PendingIntent per build would churn it
 * for no behavioural gain.
 */
@OptIn(UnstableApi::class)
class NowPlayingNotification(context: Context) : MediaNotification.Provider {

    /**
     * The stock provider, configured once.
     *
     * `setNotificationId` is the *media* notification id (1), not the channel id. It has to stay
     * distinct from the download service's 4211/4212, or Android replaces one notification with the
     * other.
     */
    private val delegate: DefaultMediaNotificationProvider =
        DefaultMediaNotificationProvider.Builder(context)
            .setNotificationId(NOTIFICATION_ID)
            .setChannelId(PlaybackService.NOTIFICATION_CHANNEL_ID)
            .setChannelName(R.string.notification_channel_name)
            .build()

    init {
        // A single-colour alpha mask, as Android requires for a status-bar icon. The library default
        // is a generic dot; ours is a note, which is what makes the shade entry readable at a glance.
        delegate.setSmallIcon(R.drawable.ic_stat_music)
    }

    override fun createNotification(
        mediaSession: MediaSession,
        customLayout: ImmutableList<CommandButton>,
        actionFactory: MediaNotification.ActionFactory,
        onNotificationChangedCallback: MediaNotification.Provider.Callback,
    ): MediaNotification {
        val produced = delegate.createNotification(
            mediaSession,
            customLayout,
            actionFactory,
            onNotificationChangedCallback,
        )

        /*
         * Make it ongoing.
         *
         * `DefaultMediaNotificationProvider` hard-codes `setOngoing(false)`, and `MediaNotification`'s
         * fields are final, so the flag is applied to the built `Notification` instead — `flags` is a
         * plain public field and the notification manager reads it at post time.
         *
         * This is the "exactly like LibreTube" part that matters most in practice: the shade entry
         * cannot be swiped away while the session is alive, and a swipe cannot desynchronise the UI
         * from a player that is still playing. `AUTO_CANCEL` is cleared at the same time, because the
         * two flags contradict each other and the later one to be consulted wins.
         */
        val n: Notification = produced.notification
        n.flags = (n.flags or Notification.FLAG_ONGOING_EVENT) and Notification.FLAG_AUTO_CANCEL.inv()
        return produced
    }

    override fun handleCustomCommand(
        session: MediaSession,
        action: String,
        extras: Bundle,
    ): Boolean = false

    companion object {
        /**
         * The media notification id.
         *
         * 1, matching what the stock provider was given before, so an upgrade updates the existing
         * notification rather than leaving a stale one behind.
         */
        const val NOTIFICATION_ID = 1
    }
}
