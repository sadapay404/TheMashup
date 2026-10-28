package local.themashup.music.ui.lyrics

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import local.themashup.music.core.domain.Lyrics
import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.ui.logic.activeLineIndex
import local.themashup.music.ui.theme.LocalArtAccents
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Timestamp-synced lyric scroller — web `lyrics/LyricsPanel`: active line
 * follows engine position (+0.05 tolerance), auto-scrolls the active line to
 * center only when it changes, tap any line to seek; plain-text/instrumental
 * fallbacks and the same loading/empty states.
 */
@Composable
fun LyricsPanel(
    track: Track?,
    positionMs: Long,
    extraction: ExtractionService,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val accents = LocalArtAccents.current
    val trackId = track?.id
    var lyrics by remember(trackId) { mutableStateOf<Lyrics?>(null) }
    var loading by remember(trackId) { mutableStateOf(track != null) }
    var note by remember(trackId) { mutableStateOf<String?>(null) }

    LaunchedEffect(trackId) {
        if (track == null) {
            lyrics = null
            loading = false
            note = null
            return@LaunchedEffect
        }
        loading = true
        note = null
        val result = withContext(Dispatchers.IO) { runCatching { extraction.lyricsFor(track) } }
        lyrics = result.getOrNull()
        note = if (result.isFailure) "Lyrics service unavailable" else null
        loading = false
    }

    if (track == null) {
        CenteredEmpty(modifier) {
            Icon(Icons.Outlined.Mic, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(30.dp))
            Text(
                text = "Lyrics appear here during playback",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textDim,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
        return
    }

    if (loading) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = tokens.accent)
                Text(
                    text = "  Matching lyrics…",
                    color = tokens.textFaint,
                    fontSize = 12.sp,
                )
            }
            listOf(88, 72, 94, 60, 80).forEach { w ->
                Box(
                    modifier = Modifier
                        .padding(top = 14.dp)
                        .fillMaxWidth(w / 100f)
                        .height(16.dp)
                        .background(tokens.surface2),
                )
            }
        }
        return
    }

    val currentLyrics = lyrics
    if (currentLyrics == null) {
        CenteredEmpty(modifier) {
            Icon(Icons.Outlined.MusicNote, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(30.dp))
            Text(
                text = "No lyrics found",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = tokens.textDim,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(
                text = note ?: "LRCLIB has no match for this track yet — try another version.",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textFaint,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        return
    }

    val lines = currentLyrics.synced
    if (lines.isEmpty()) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = currentLyrics.plain ?: if (currentLyrics.instrumental) "Instrumental" else "",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textDim,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
            )
        }
        return
    }

    val positionSec = positionMs / 1000.0
    val activeIdx = activeLineIndex(lines, positionSec)

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val viewportPx = with(density) { maxHeight.toPx() }
        val itemHalfPx = with(density) { 26.dp.toPx() }
        val centerOffset = (viewportPx / 2 - itemHalfPx).toInt().coerceAtLeast(0)
        val listState = rememberLazyListState()
        var lastScrolled by remember(trackId) { mutableStateOf(-1) }

        LaunchedEffect(activeIdx) {
            if (activeIdx < 0 || activeIdx == lastScrolled) return@LaunchedEffect
            lastScrolled = activeIdx
            listState.animateScrollToItem(activeIdx, scrollOffset = centerOffset)
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            itemsIndexed(lines) { i, line ->
                val active = i == activeIdx
                val past = i < activeIdx
                val lineAlpha = when {
                    active -> 1f
                    past -> 0.55f
                    else -> 0.35f
                }
                Text(
                    text = line.text.ifBlank { "♪" },
                    style = TextStyle(
                        fontSize = 18.sp,
                        lineHeight = 26.sp,
                        fontWeight = if (active) FontWeight.ExtraBold else FontWeight.Medium,
                        color = if (active) MaterialTheme.colorScheme.onBackground else tokens.textDim,
                        textAlign = TextAlign.Center,
                        shadow = if (active) {
                            Shadow(color = accents.first.copy(alpha = 0.55f), blurRadius = 24f)
                        } else {
                            null
                        },
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .graphicsLayer {
                            alpha = lineAlpha
                            scaleX = if (active) 1.03f else 1f
                            scaleY = scaleX
                        }
                        .clickable { onSeek((line.time * 1000).toLong()) }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
            item {
                Box(
                    modifier = Modifier
                        .height(96.dp)
                        .fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun CenteredEmpty(modifier: Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        content()
    }
}
