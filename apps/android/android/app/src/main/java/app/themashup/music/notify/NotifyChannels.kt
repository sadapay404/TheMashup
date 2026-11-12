package app.themashup.music.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * The one place notification channels are defined.
 *
 * ## Why a shared object
 *
 * Android 8+ silently drops a notification posted to a channel that does not exist, and it gives the
 * caller no error. Channels used to be created in two unrelated places — `DownloadService` created its
 * own on first start, `PlaybackService` created its own in `onCreate` — so whether a message could be
 * delivered depended on which service happened to have run first. A failure posted from the download
 * service onto the alert channel before any JS notification had been shown would simply vanish.
 *
 * Creation is idempotent and cheap, so every entry point that posts calls [ensure] first. There is no
 * ordering left to get wrong.
 *
 * ## Why these importances
 *
 * - [ALERTS] `DEFAULT` — anything the user must know: a failed download, a batch that finished, a
 *   playback failure worth acting on.
 * - [PLAYBACK] `DEFAULT` — the media session row. `LOW` filed it under "Silent" on the user's OEM
 *   skin, which read as "the notification never arrives". The session does not re-alert on track
 *   changes, so the higher importance costs one sound at session start and nothing after.
 * - [DOWNLOADS] `LOW`, badged — progress must not buzz every 256 KiB, but an active or finished
 *   transfer should leave a mark. The previous channel also had `setShowBadge(false)`, which made the
 *   entire download feature invisible from the shade.
 *
 * Android freezes a channel's importance at creation. The playback channel therefore carries a `v2`
 * suffix — reusing the old id would pin it to `LOW` forever on every existing install.
 */
object NotifyChannels {

    /** Needs-attention messages. */
    const val ALERTS = "mashup_alerts"

    /** The ongoing media session row. */
    const val PLAYBACK = "app.themashup.music.playback.v2"

    /** Download progress, badged. */
    const val DOWNLOADS = "mashup_downloads"

    /** The pre-v2 playback id, deleted on first create so Settings does not show two Playback rows. */
    private const val PLAYBACK_LEGACY = "app.themashup.music.playback"

    /** Create every channel, and retire the superseded one. Safe to call from anywhere, any thread. */
    fun ensure(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            nm.createNotificationChannel(
                NotificationChannel(ALERTS, "App alerts", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Downloads, failures and anything that needs your attention"
                    enableVibration(true)
                },
            )

            nm.createNotificationChannel(
                NotificationChannel(PLAYBACK, "Playback", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Controls for the song currently playing"
                    // A media row is not an alert: it should never badge the launcher.
                    setShowBadge(false)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setSound(
                        android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                },
            )

            nm.createNotificationChannel(
                NotificationChannel(DOWNLOADS, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Progress and results of music downloads"
                    setShowBadge(true)
                },
            )

            nm.deleteNotificationChannel(PLAYBACK_LEGACY)
        }
    }
}
