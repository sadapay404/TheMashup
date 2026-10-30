package local.themashup.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.PlaylistPlay
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.formatDuration
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Scrollable queue — web `QueueDrawer.QueueList`: index/▶ marker, art,
 * title/artist, duration, remove. Tap → play from that index
 * (`playAtIndex` parity via playQueue(startIndex)). Remove stays visible on
 * touch (web hides it behind desktop hover).
 */
@Composable
fun QueueList(
    state: PlayerSnapshot,
    engine: PlaybackEngine,
    library: LibraryRepository,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()

    if (state.queue.isEmpty()) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Outlined.PlaylistPlay,
                contentDescription = null,
                tint = tokens.textFaint,
                modifier = Modifier.size(30.dp),
            )
            Text(
                text = "Your queue is empty",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = tokens.textDim,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(
                text = "Play a track or use “Add to queue” on a song.",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textFaint,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        return
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        state.queue.forEachIndexed { i, track ->
            val isCurrent = state.current?.id == track.id && i == state.cursor
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (isCurrent) tokens.surface2 else Color.Transparent)
                    .clickable {
                        engine.playQueue(state.queue, startIndex = i, context = "queue")
                        scope.launch { library.recordPlay(track, context = "queue") }
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = if (isCurrent) "▶" else (i + 1).toString(),
                    color = if (isCurrent) tokens.accent else tokens.textFaint,
                    fontSize = 11.sp,
                    modifier = Modifier.width(20.dp),
                )
                Artwork(
                    src = track.artworkBest ?: track.artwork,
                    label = track.title,
                    corner = 6.dp,
                    modifier = Modifier.size(36.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        color = if (isCurrent) tokens.accent else scheme.onBackground,
                        fontSize = 14.sp,
                        fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = track.artistNames,
                        color = tokens.textDim,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = formatDuration(track.durationSec),
                    color = tokens.textFaint,
                    fontSize = 11.sp,
                )
                Icon(
                    Icons.Outlined.Clear,
                    contentDescription = "Remove from queue",
                    tint = tokens.textFaint,
                    modifier = Modifier
                        .size(18.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { engine.removeFromQueue(i) },
                )
            }
        }
    }
}
