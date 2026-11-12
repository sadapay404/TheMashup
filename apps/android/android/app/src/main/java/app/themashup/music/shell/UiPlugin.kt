package app.themashup.music.shell

import android.content.Context
import android.os.Build
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Reports the real system-bar geometry to the page.
 *
 * ## Why the page needs this
 *
 * The app draws edge-to-edge so the artwork and the wash reach the physical edges of the screen. That
 * is deliberate, but it moves the responsibility for staying clear of the status bar and the
 * navigation gesture area onto CSS. `env(safe-area-inset-top)` is the standard answer and it does not
 * work here: Capacitor's WebView does not enable the viewport-fit inset propagation on most devices, so
 * the value is `0px` on a phone with a punch-hole camera — and the app's title rendered underneath the
 * clock, which is exactly what the user reported.
 *
 * So the shell measures the bars it is actually drawing under and hands the numbers over. The CSS has a
 * sane fallback (`max(env(...), 28px)`) for the frame between first paint and this call, and this
 * corrects it to the device's true geometry — a 24dp bar on one phone, 44dp on another with a notch.
 *
 * Values are in **density-independent pixels**, which is what a WebView CSS pixel is.
 */
@CapacitorPlugin(name = "MashupUi")
class UiPlugin : Plugin() {

    /**
     * `{ top, bottom, left, right }` in dp, or zeros if the window has not been laid out yet.
     *
     * The page retries once on the next frame when it gets zeros, so a call made before the first
     * layout is not a silent failure.
     */
    @PluginMethod
    fun insets(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.resolve(empty())
            return
        }
        val root: View = activity.window.decorView
        val density = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f

        val compat = ViewCompat.getRootWindowInsets(root)
        if (compat == null) {
            // Pre-layout (or an OEM that does not dispatch insets to this view). Fall back to the
            // resource-derived status bar height, which is right on every device we have seen.
            call.resolve(
                JSObject()
                    .put("top", (statusBarRes(activity) / density.toDouble()))
                    .put("bottom", 0.0)
                    .put("left", 0.0)
                    .put("right", 0.0)
                    .put("reliable", false),
            )
            return
        }

        val top = compat.getInsets(WindowInsetsCompat.Type.statusBars()).top
        val bottom = compat.getInsets(
            WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.mandatorySystemGestures(),
        ).bottom
        // A cutout can sit beside the status bar (landscape) or inside it (portrait punch-hole).
        val cutout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            compat.getInsets(WindowInsetsCompat.Type.displayCutout())
        } else {
            null
        }

        call.resolve(
            JSObject()
                .put("top", maxOf(top, cutout?.top ?: 0) / density.toDouble())
                .put("bottom", bottom / density.toDouble())
                .put("left", (cutout?.left ?: 0) / density.toDouble())
                .put("right", (cutout?.right ?: 0) / density.toDouble())
                .put("reliable", true),
        )
    }

    /**
     * The framework's status-bar height, in pixels.
     *
     * Read from the system dimen rather than from a display cutout: it is correct on every device
     * including ones whose insets have not been dispatched yet, and it does not need the deprecated
     * `defaultDisplay` API.
     */
    private fun statusBarRes(ctx: Context): Int {
        val id = ctx.resources.getIdentifier("status_bar_height", "dimen", "android")
        // 24dp is the platform's standard status bar; only used if the framework dimen is missing.
        return if (id > 0) {
            ctx.resources.getDimensionPixelSize(id)
        } else {
            (24 * ctx.resources.displayMetrics.density).toInt()
        }
    }

    private fun empty(): JSObject =
        JSObject().put("top", 0.0).put("bottom", 0.0).put("left", 0.0).put("right", 0.0).put("reliable", false)
}
