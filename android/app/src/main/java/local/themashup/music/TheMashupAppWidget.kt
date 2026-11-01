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
        // Do NOT startForegroundService from an AppWidgetProvider broadcast receiver —
        // Android 12+ throws ForegroundServiceStartNotAllowedException from receivers.
        // The service is started on first play via PlaybackEngine.ensureServiceStarted().
    }

    private fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.themashup_appwidget)
        views.setTextViewText(R.id.widget_title, context.getString(R.string.app_name))
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}
