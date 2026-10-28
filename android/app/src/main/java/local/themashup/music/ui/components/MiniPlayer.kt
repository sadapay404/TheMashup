package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import local.themashup.music.core.domain.PlayStatus
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Floating mini player above the bottom nav — web `PlayerBar` compact mode:
 * full-width progress line, art + meta, transport controls. Expanded player
 * (tap meta) and queue/lyrics/volume actions land in N6.
 */
@Composable
fun MiniPlayer(
    state: PlayerSnapshot,
    onPrev: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val current = state.current ?: return
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val playing = state.status == PlayStatus.PLAYING
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(scheme.background.copy(alpha = 0.96f))
            .border(width = 1.dp, color = tokens.border),
    ) {
        // Compact progress line (web: full-width above the row).
        val fraction =
            if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f)
            else 0f
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(tokens.border),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(2.dp)
                    .background(tokens.accent),
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(
                src = current.artworkBest ?: current.artwork,
                label = current.title,
                corner = 8.dp,
                modifier = Modifier.size(44.dp),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp),
            ) {
                Text(
                    text = current.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = current.artistNames,
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.textDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TransportButton(onClick = onPrev, label = "Previous") {
                Icon(Icons.Filled.SkipPrevious, contentDescription = null, tint = scheme.onBackground)
            }
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .padding(horizontal = 4.dp)
                    .clip(CircleShape)
                    .background(tokens.accent)
                    .clickable(onClick = onToggle),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (playing) "Pause" else "Play",
                    tint = tokens.accentContrast,
                    modifier = Modifier.size(22.dp),
                )
            }
            TransportButton(onClick = onNext, label = "Next") {
                Icon(Icons.Filled.SkipNext, contentDescription = null, tint = scheme.onBackground)
            }
        }
    }
}

@Composable
private fun TransportButton(
    onClick: () -> Unit,
    label: String,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}
