package local.themashup.music.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.themashup.music.core.domain.Track
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Horizontal shelf — web `ShelfSection` (home/HomePage.tsx): title + kind
 * pill + card row with hidden scrollbar; `enter` flag drives the shimmer
 * skeleton (web loading state) with N skeleton cards.
 */
@Composable
fun ShelfSection(
    title: String,
    kindPill: String,
    tracks: List<Track>,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    skeletons: Int = 6,
    currentTrackId: String? = null,
    isPlaying: Boolean = false,
    onCardPlay: (Track, List<Track>) -> Unit = { _, _ -> },
    onCardQueue: (Track) -> Unit = {},
    onCardRadio: (Track, List<Track>) -> Unit = { _, _ -> },
) {
    val tokens = LocalMashupTokens.current
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f, fill = true),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Text(
                    text = kindPill,
                    color = tokens.textFaint,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.8.sp,
                )
            }
        }
        if (loading) {
            LazyRow(
                modifier = Modifier.padding(top = 12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(skeletons) { i -> SkeletonCard(index = i) }
            }
        } else {
            LazyRow(
                modifier = Modifier.padding(top = 12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                itemsIndexed(tracks) { _, track ->
                    TrackCard(
                        track = track,
                        contextQueue = tracks,
                        isCurrent = currentTrackId == track.id,
                        isPlaying = isPlaying,
                        onPlay = { onCardPlay(track, tracks) },
                        onQueue = { onCardQueue(track) },
                        onRadio = { onCardRadio(track, tracks) },
                    )
                }
            }
        }
    }
}

/** Web skeleton: shimmer sweep (1.4s, `animate-pulse` + gradient sweep). */
@Composable
private fun SkeletonCard(index: Int) {
    val tokens = LocalMashupTokens.current
    val transition = rememberInfiniteTransition(label = "skeleton")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1400),
            repeatMode = RepeatMode.Restart,
        ),
        label = "skeleton-progress",
    )
    Column(modifier = Modifier.width(164.dp)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(164.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            tokens.surface2,
                            tokens.surface2,
                            tokens.accent.copy(alpha = 0.10f),
                            tokens.surface2,
                        ),
                        start = Offset(progress * 600f - 300f, 0f),
                        end = Offset(progress * 600f, 600f),
                    ),
                ),
        )
        Box(
            modifier = Modifier
                .padding(top = 10.dp)
                .width((100 + (index * 7) % 60).dp)
                .height(12.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(tokens.surface2),
        )
        Box(
            modifier = Modifier
                .padding(top = 6.dp)
                .width(70.dp)
                .height(10.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(tokens.surface2),
        )
    }
}
