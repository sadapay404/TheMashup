package com.themashup.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.media3.common.util.UnstableApi

/**
 * Home-screen widget. State is mirrored into SharedPreferences by PlayerController.
 * onEnabled() intentionally does nothing: no foreground service is started from here.
 */
@UnstableApi
class MashupWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, build(context)) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return
        if (action !in listOf(ACTION_TOGGLE, ACTION_NEXT, ACTION_PREV)) return
        Graph.init(context.applicationContext)
        val result = goAsync()
        Graph.player.whenReady {
            when (action) {
                ACTION_TOGGLE -> Graph.player.toggle()
                ACTION_NEXT -> Graph.player.next()
                ACTION_PREV -> Graph.player.prev()
            }
            result.finish()
        }
    }

    companion object {
        const val ACTION_TOGGLE = "com.themashup.app.WIDGET_TOGGLE"
        const val ACTION_NEXT = "com.themashup.app.WIDGET_NEXT"
        const val ACTION_PREV = "com.themashup.app.WIDGET_PREV"

        fun publish(ctx: Context, track: Track?, playing: Boolean) {
            ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit()
                .putString("title", track?.title ?: "TheMashup")
                .putString("artist", track?.artist ?: "Nothing playing")
                .putBoolean("playing", playing).apply()
            runCatching {
                val mgr = AppWidgetManager.getInstance(ctx)
                val ids = mgr.getAppWidgetIds(ComponentName(ctx, MashupWidget::class.java))
                if (ids.isNotEmpty()) ids.forEach { mgr.updateAppWidget(it, build(ctx)) }
            }
        }

        private fun pi(ctx: Context, action: String, code: Int): PendingIntent {
            val i = Intent(ctx, MashupWidget::class.java).setAction(action)
            return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun build(ctx: Context): RemoteViews {
            val sp = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE)
            val v = RemoteViews(ctx.packageName, R.layout.widget_player)
            v.setTextViewText(R.id.widget_title, sp.getString("title", "TheMashup"))
            v.setTextViewText(R.id.widget_artist, sp.getString("artist", "Nothing playing"))
            v.setImageViewResource(
                R.id.widget_play,
                if (sp.getBoolean("playing", false)) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            )
            v.setOnClickPendingIntent(R.id.widget_play, pi(ctx, ACTION_TOGGLE, 1))
            v.setOnClickPendingIntent(R.id.widget_next, pi(ctx, ACTION_NEXT, 2))
            v.setOnClickPendingIntent(R.id.widget_prev, pi(ctx, ACTION_PREV, 3))
            val open = PendingIntent.getActivity(ctx, 4, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            v.setOnClickPendingIntent(R.id.widget_root, open)
            return v
        }
    }
}
