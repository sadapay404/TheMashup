package local.themashup.music

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home screen widget for TheMashup — shows current track + play/pause. */
class TheMashupAppWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onEnabled(context: Context) {
        // Start playback service when widget first added
        val intent = Intent(context, local.themashup.music.core.player.TheMashupPlayerService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.themashup_appwidget)
        views.setTextViewText(R.id.widget_title, context.getString(R.string.app_name))
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}
