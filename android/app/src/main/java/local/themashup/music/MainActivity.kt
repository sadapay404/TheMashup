package local.themashup.music

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import local.themashup.music.ui.TheMashupRoot

/**
 * Single activity — edge-to-edge; the Compose root reads the persisted
 * theme from DataStore and renders the N5 shell (top bar with theme
 * switcher, 4-tab navigation, mini player).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as TheMashupApp).container
        setContent {
            TheMashupRoot(container)
        }
    }
}
