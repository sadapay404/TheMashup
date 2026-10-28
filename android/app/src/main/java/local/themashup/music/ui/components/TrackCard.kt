package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ListAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.themashup.music.core.domain.Track
import local.themashup.music.ui.theme.LocalArtAccents
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Home shelf card — web `TrackCard` (home/HomePage.tsx): w-40/44 art with
 * `--art-1` bottom glow, playing pill, hover action buttons (Radio / queue /
 * play). Native: actions sit on a bottom-right overlay, always reachable.
 */
@Composable
fun TrackCard(
    track: Track,
    contextQueue: List<Track>,
    isCurrent: Boolean,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onQueue: () -> Unit,
    onRadio: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val accents = LocalArtAccents.current
    Column(modifier = modifier.width(164.dp)) {
        Box {
            Artwork(
                src = track.artworkBest ?: track.artwork,
                label = track.title,
                corner = 12.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f),
            )
            // Bottom glow — web: color-mix(--art-1 26%) rising from 30%.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.3f to Color.Transparent,
                            1f to accents.first.copy(alpha = 0.26f),
                        ),
                    ),
            )
            if (isCurrent && isPlaying) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(tokens.accent)
                        .padding(horizontal = 7.dp, vertical = 3.dp),
                ) {
                    Text(
                        text = "playing",
                        color = tokens.accentContrast,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Row(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OverlayAction(onClick = onRadio, contentDescription = "Radio") {
                    Icon(Icons.Filled.Radio, contentDescription = null, tint = Color.White)
                }
                OverlayAction(onClick = onQueue, contentDescription = "Add to queue") {
                    Icon(Icons.Filled.ListAdd, contentDescription = null, tint = Color.White)
                }
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(tokens.accent)
                        .pressClickable(pressScale = 0.9f, onClick = onPlay),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.PlayArrow,
                        contentDescription = "Play",
                        tint = tokens.accentContrast,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
        }
        Text(
            text = track.title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            text = track.artistNames,
            style = MaterialTheme.typography.bodySmall,
            color = tokens.textDim,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun OverlayAction(
    onClick: () -> Unit,
    contentDescription: String,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.6f))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}
