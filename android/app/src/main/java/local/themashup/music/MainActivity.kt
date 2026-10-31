package local.themashup.music

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import local.themashup.music.core.player.TheMashupPlayerService
import local.themashup.music.ui.TheMashupRoot

/**
 * Single activity — edge-to-edge; the Compose root reads the persisted
 * theme from DataStore and renders the N5 shell (top bar with theme
 * switcher, 4-tab navigation, mini player).
 */
class MainActivity : ComponentActivity() {

    /** Media notification must be visible in the panel (Android 13+). */
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                // Denied — playback still works; notification/lock-screen
                // controls stay unavailable until the user grants it.
                Log.w("TheMashup", "POST_NOTIFICATIONS denied; lock-screen controls unavailable")
            }
            // Do NOT startForegroundService from the permission callback — the
            // service starts on first play via ensureServiceStarted(), which
            // calls startForeground() before doing any network work.
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        val container = (application as TheMashupApp).container
        setContent {
            TheMashupRoot(container)
        }
    }
}
