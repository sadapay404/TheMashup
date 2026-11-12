package app.themashup.music.notify

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * The app's own notification surface.
 *
 * ## Why this exists
 *
 * Until now there were exactly two notifications in the whole app, and both were side effects of
 * *other* features: the download service's foreground progress and Media3's playback session. Every
 * in-app message — "Downloaded", "Added to queue", "Saved 12 tracks", a resolve failure — was a toast
 * drawn inside the WebView. A toast is gone in four seconds and only exists while the app is on
 * screen, which is the opposite of what a notification is for. If the user backgrounded the app while a
 * playlist download ran, or the screen was off when a track started, nothing appeared at all.
 *
 * So the JS store's `notify()` now also crosses the bridge. It is the same event, delivered to both
 * surfaces: a toast while the app is in front, a real shade entry when it is not (or when the message
 * matters enough to keep).
 *
 * ## Channels
 *
 * Android 8+ locks a channel's importance forever after creation — you cannot raise it, only replace
 * the whole channel id. Three separate ids, therefore:
 *
 *  - `mashup_alerts`   — DEFAULT. Anything the user must be told about.
 *  - `mashup_playback` — LOW. Ongoing playback; must never buzz on every track change.
 *  - `mashup_downloads`— LOW, but with a badge and no `setSilent`, so completions are visible.
 *
 * The downloads channel was IMPORTANCE_MIN-adjacent in practice (LOW + `setShowBadge(false)`), which
 * is why the user could download an album and see nothing in the shade. It is re-created here with
 * badges on; existing installs get the new settings because the JSON payload requests it (the
 * `setShowBadge` part is live-updatable even when the importance is not).
 */
@CapacitorPlugin(
    name = "MashupNotify",
    permissions = [
        Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS],
        ),
    ],
)
class NotifyPlugin : Plugin() {

    /**
     * Post or update a notification.
     *
     * `id` is stable per logical notification, so posting the same id twice updates in place rather
     * than stacking — the same rule the download service uses for its progress row.
     */
    @PluginMethod
    fun show(call: PluginCall) {
        val title = call.getString("title")?.takeIf { it.isNotBlank() }
        val body = call.getString("body")?.takeIf { it.isNotBlank() }
        if (title == null && body == null) {
            call.reject("title or body is required")
            return
        }
        // A notification on a channel the user has switched off is not an error; it is their choice.
        // Resolve anyway so the JS side does not retry a message that will never be wanted.
        if (!notificationsAllowed()) {
            call.resolve(JSObject().put("shown", false).put("reason", "permission"))
            return
        }

        val id = call.getInt("id") ?: DEFAULT_ID
        val channel = channelFor(call.getString("channel") ?: CHANNEL_ALERTS)
        val important = call.getBoolean("important") ?: false
        val ongoing = call.getBoolean("ongoing") ?: false
        val progress = call.getInt("progress") ?: -1
        val route = call.getString("route")

        ensureChannels()

        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(
                if (important) android.R.drawable.stat_notify_error else android.R.drawable.stat_notify_sync,
            )
            .setContentTitle(title ?: "TheMashup")
            .setContentText(body ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.orEmpty()))
            .setPriority(if (important) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(
                if (important) NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_STATUS,
            )
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            // Grouped so an album's worth of saves does not become eleven separate lines.
            .setGroup(GROUP)
            .setWhen(System.currentTimeMillis())

        if (progress in 0..100) {
            builder.setProgress(100, progress, false)
        }

        // Tapping opens the app on the screen the message is about. Without this a notification is a
        // message with nowhere to go, which is most of why people swipe them away.
        val target = launchActivityClass()
        val launch = if (target != null) {
            Intent(context, target).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (route != null) putExtra(EXTRA_ROUTE, route)
            }
        } else {
            // No activity class resolvable: open the launcher entry instead of dropping the tap.
            Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                setPackage(context.packageName)
            }
        }
        val pending = PendingIntent.getActivity(
            context,
            id,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        builder.setContentIntent(pending)

        runCatching {
            NotificationManagerCompat.from(context).notify(id, builder.build())
            call.resolve(JSObject().put("shown", true))
        }.onFailure { t ->
            // Never throw across the bridge for a notification: the caller is a toast, and a toast that
            // crashes the app is worse than a toast that is missed.
            call.resolve(JSObject().put("shown", false).put("reason", t.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getInt("id") ?: DEFAULT_ID
        runCatching { NotificationManagerCompat.from(context).cancel(id) }
        call.resolve()
    }

    /**
     * Ask for POST_NOTIFICATIONS from the web layer.
     *
     * `MainActivity` already asks once on resume. This is the second chance: a user who dismissed the
     * first dialog while doing something else can be asked again the moment a notification is
     * genuinely about to be useful (a download they just started), which is the difference between a
     * permission prompt and a nag.
     */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (notificationsAllowed()) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        val perm = getPermissionState("notifications")
        if (perm == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        // `requestPermissionForAlias` answers through the callback, not through this call.
        requestPermissionForAlias("notifications", call, "permissionCallback")
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", notificationsAllowed()))
    }

    /**
     * Hand the JS layer the route a notification was tapped for, exactly once.
     *
     * The launch intent is read before the WebView exists and the page asks for it at boot, so there is
     * no window in which the tap can be missed — evaluating JS from `onCreate` would race the page load
     * and, on a cold start, land on a `window` that has not been created yet.
     */
    @PluginMethod
    fun takePendingRoute(call: PluginCall) {
        val route = pendingRoute
        pendingRoute = null
        // `put(String, Object)` has no nullable overload: omit the key entirely when there is nothing
        // waiting, which is also what the JS side treats as "no pending route".
        call.resolve(if (route != null) JSObject().put("route", route) else JSObject())
    }

    /** Report the current state without prompting. */
    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("granted", notificationsAllowed())
                .put("canAsk", canAsk()),
        )
    }

    // ---------------------------------------------------------------- internals

    private fun notificationsAllowed(): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun canAsk(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notificationsAllowed()

    /**
     * The activity a tap should open.
     *
     * Taken from the live bridge rather than by class literal: the plugin is compiled into both
     * flavours, and resolving the class by name keeps this file free of any dependency on the activity's
     * extractor wiring. The activity is always present while a plugin can be called, and the type is
     * only used to build an Intent — `null` is handled by falling back to the launcher intent.
     */
    private fun launchActivityClass(): Class<*>? =
        try {
            Class.forName("app.themashup.music.MainActivity")
        } catch {
            null
        }

    private fun channelFor(requested: String): String = when (requested) {
        CHANNEL_PLAYBACK, CHANNEL_DOWNLOADS -> requested
        else -> CHANNEL_ALERTS
    }

    /** Create the channels before the first post, so a message cannot land on a channel that does not exist. */
    private fun ensureChannels() = NotifyChannels.ensure(context)

    companion object {
        const val CHANNEL_ALERTS = NotifyChannels.ALERTS
        const val CHANNEL_PLAYBACK = NotifyChannels.PLAYBACK
        const val CHANNEL_DOWNLOADS = NotifyChannels.DOWNLOADS
        private const val GROUP = "mashup.alert"
        private const val DEFAULT_ID = 5301

        /**
         * A route delivered by a notification tap, waiting for the web layer to pick it up.
         *
         * `@Volatile` because it is written on the main thread (from the Activity's intent) and read
         * from the Capacitor plugin thread when the page asks for it at boot.
         */
        @Volatile
        var pendingRoute: String? = null

        /** Extra key the Activity reads from the launch intent. Must match [NotifyPlugin.show]. */
        const val EXTRA_ROUTE = "mashup.route"
    }
}
