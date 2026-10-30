package local.themashup.music

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import local.themashup.music.ui.TheMashupRoot

/**
 * Single activity — edge-to-edge; the Compose root reads the persisted
 * theme from DataStore and renders the N5 shell (top bar with theme
 * switcher, 4-tab navigation, mini player).
 */
class MainActivity : ComponentActivity() {

    /** Media notification must be visible in the panel (Android 13+). */
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

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
