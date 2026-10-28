package local.themashup.player;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Content-frame padding captured before any inset padding is applied. */
    private int baseLeft;
    private int baseTop;
    private int baseRight;
    private int baseBottom;
    private boolean insetsHooked = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must register before the bridge initializes.
        registerPlugin(DownloadSaver.class);
        registerPlugin(NsdDiscovery.class);
        super.onCreate(savedInstanceState);

        applyEdgeToEdgeInsets();
    }

    /**
     * targetSdk 35+ enforces edge-to-edge: the WebView draws under the status
     * bar / punch-hole cutout and behind the gesture bar. Pad the content
     * frame with the reported insets so the UI never sits behind system bars,
     * and force dark system-bar styling (the app chrome is near-black).
     */
    private void applyEdgeToEdgeInsets() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final View content = findViewById(android.R.id.content);
        if (content != null && !insetsHooked) {
            insetsHooked = true;
            baseLeft = content.getPaddingLeft();
            baseTop = content.getPaddingTop();
            baseRight = content.getPaddingRight();
            baseBottom = content.getPaddingBottom();
            // The padded band shows app background, never the splash/window bg.
            content.setBackgroundColor(Color.parseColor("#0A0A0F"));

            ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
                androidx.core.graphics.Insets bar = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout());
                v.setPadding(
                    baseLeft + bar.left,
                    baseTop + bar.top,
                    baseRight + bar.right,
                    baseBottom + bar.bottom);
                // Return unconsumed: IME/other listeners still see the insets.
                return insets;
            });
            content.requestApplyInsets();
        }

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
