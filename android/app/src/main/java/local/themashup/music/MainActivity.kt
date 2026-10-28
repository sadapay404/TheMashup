package local.themashup.music

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import local.themashup.music.ui.theme.TheMashupTheme
import local.themashup.music.ui.theme.ThemeId

/**
 * Single activity. Edge-to-edge is native here: Compose consumes
 * WindowInsets through Modifier.safeDrawing in later phases (no WebView
 * underlap like the Capacitor build had).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            TheMashupTheme(themeId = rememberAppTheme()) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    PhaseOneShell()
                }
            }
        }
    }
}

/**
 * In-memory theme pick for the skeleton — Phase N5 swaps this for the
 * DataStore-backed store (same persistence contract as the web themes).
 */
@Composable
private fun rememberAppTheme(): ThemeId {
    var theme by remember { mutableStateOf(ThemeId.FROSTED) }
    return theme
}

/** Phase N1 landing shell — themed, edge-to-edge, ready for N5 navigation. */
@Composable
fun PhaseOneShell() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "TheMashup",
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = "Native Android · Phase N1 skeleton\nFull player lands in phases N3–N8",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
