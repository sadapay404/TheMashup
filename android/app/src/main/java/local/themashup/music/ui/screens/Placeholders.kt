package local.themashup.music.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Honest placeholder — Downloads lands in N7 (ffmpeg first-run + quality
 * jobs). Library has its real N6 screen; web blurb kept verbatim.
 */
@Composable
fun DownloadsScreen(modifier: Modifier = Modifier) = PhasePlaceholder(
    title = "Downloads",
    blurb = "MP3 · FLAC · MP4 in every quality",
    phase = "N7",
    body = "Quality downloads with ffmpeg on first run (one-time ~128 MB fetch), " +
        "per-track progress and the offline queue land here in phase N7.",
    icon = { Icon(Icons.Outlined.Download, contentDescription = null) },
    modifier = modifier,
)

@Composable
private fun PhasePlaceholder(
    title: String,
    blurb: String,
    phase: String,
    body: String,
    icon: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .padding(0.dp),
                contentAlignment = Alignment.Center,
            ) {
                icon()
            }
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = scheme.onBackground,
                modifier = Modifier.padding(top = 14.dp),
            )
            Text(
                text = blurb,
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textFaint,
                modifier = Modifier.padding(top = 4.dp),
            )
            Text(
                text = "Lands in Phase $phase",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = tokens.accent,
                modifier = Modifier.padding(top = 18.dp),
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textDim,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
