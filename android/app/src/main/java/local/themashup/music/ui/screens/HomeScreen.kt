package local.themashup.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.RadioOptions
import local.themashup.music.core.domain.Shelves
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.buildRadioQueue
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.FadeSlideIn
import local.themashup.music.ui.components.ShelfSection
import local.themashup.music.ui.theme.LocalMashupTokens
import local.themashup.music.ui.theme.LocalArtAccents

/**
 * Home — web `HomePage.tsx`: welcome hero + shelf grid
 * (listen_again · quick · discover · trending). Charts pool = native
 * trending walk (Piped/Invidious); listen_again/discover = local Recommend
 * domain over the on-device library (web AUTHED order — local profile).
 */
@Composable
fun HomeScreen(
    extraction: ExtractionService,
    library: LibraryRepository,
    engine: PlaybackEngine,
    playerState: PlayerSnapshot,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val accents = LocalArtAccents.current
    val scope = rememberCoroutineScope()
    var retryTick by remember { mutableIntStateOf(0) }
    var charts by remember { mutableStateOf<List<Track>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(retryTick) {
        loading = true
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching { extraction.trending(limit = 40) }
        }
        charts = result.getOrElse { emptyList() }
        error = if (result.isFailure || charts.isEmpty()) {
            "No recommendation data available"
        } else {
            null
        }
        loading = false
    }

    val libState by library.state.collectAsState()
    val shelves = remember(libState, charts, retryTick) {
        Shelves.build(
            kinds = Shelves.AUTHED_ORDER,
            history = library.historyEntries(),
            likes = library.likedTracks(),
            charts = charts,
            nowMs = System.currentTimeMillis(),
        )
    }

    val chartShelvesLoaded = !loading && error == null

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
    ) {
        // Web hero entrance: initial y −8, ease-out ~350 ms.
        FadeSlideIn(offsetYDp = (-8).dp) {
            WelcomeHero(
                accent = accents.first,
                accentAlt = accents.second,
            )
        }

        if (loading && charts.isEmpty()) {
            // Chart shelves skeleton (web shows two shimmer shelves).
            repeat(2) { i ->
                ShelfSection(
                    title = if (i == 0) "Quick picks" else "Trending now",
                    kindPill = if (i == 0) "quick" else "trending",
                    tracks = emptyList(),
                    loading = true,
                    modifier = Modifier.padding(top = if (i == 0) 28.dp else 20.dp),
                )
            }
        }

        if (error != null && !loading) {
            ChartsErrorCard(message = error.orEmpty(), onRetry = { retryTick++ })
        }

        shelves.forEachIndexed { i, shelf ->
            // Web card stagger (min(i*40, 320) ms) expressed per shelf —
            // LazyRow recycling would otherwise re-animate rows on scroll-back.
            FadeSlideIn(delayMillis = minOf(i * 40, 320)) {
                ShelfSection(
                    title = shelf.title,
                    kindPill = shelf.kind.replace('_', ' '),
                    tracks = shelf.tracks,
                    currentTrackId = playerState.current?.id,
                    isPlaying = playerState.status == local.themashup.music.core.player.PlayStatus.PLAYING,
                    modifier = Modifier.padding(top = if (i == 0 && charts.isEmpty() && error == null) 20.dp else 26.dp),
                    onCardPlay = { track, queue ->
                        val index = queue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
                        engine.playQueue(queue, startIndex = index, context = "home")
                        scope.launch { library.recordPlay(track, context = "home") }
                    },
                    onCardQueue = { track -> engine.addToEnd(track) },
                    onCardRadio = { track, queue ->
                        val pool = (queue + charts).distinctBy { it.id }
                        val radio = if (pool.size >= 3) {
                            buildRadioQueue(track, pool, RadioOptions(limit = 30))
                        } else {
                            queue
                        }
                        engine.playQueue(radio, startIndex = 0, context = "radio")
                        scope.launch { library.recordPlay(track, context = "radio") }
                    },
                )
            }
        }

        // A "see all" affordance is unnecessary: shelves are full horizontal lists.
        if (chartShelvesLoaded && shelves.isEmpty() && error == null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Nothing on the charts yet — play something to seed your feed.",
                    color = tokens.textDim,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun WelcomeHero(accent: androidx.compose.ui.graphics.Color, accentAlt: androidx.compose.ui.graphics.Color) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    0f to accent.copy(alpha = 0.15f),
                    0.5f to scheme.background,
                    1f to accentAlt.copy(alpha = 0.10f),
                ),
            )
            .border(
                width = 1.dp,
                color = tokens.border,
                shape = RoundedCornerShape(16.dp),
            )
            .padding(20.dp),
    ) {
        Column {
            Text(
                text = "WELCOME BACK",
                color = accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
            )
            Text(
                text = "Ready when you are.",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.ExtraBold,
                color = scheme.onBackground,
                modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                text = "Aggregated streams, lyric search and endless radio — all resolved " +
                    "on-device with automatic source failover.",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textDim,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

/** Web chart-unavailable card: amber alert + retry pill. */
@Composable
private fun ChartsErrorCard(message: String, onRetry: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 24.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(scheme.surface)
            .border(width = 1.dp, color = androidx.compose.ui.graphics.Color(0xFFF59E0B).copy(alpha = 0.4f), shape = RoundedCornerShape(14.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.Warning, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFFF59E0B))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onBackground,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = "Sources may be rate-limited. Retry any time.",
                style = MaterialTheme.typography.bodySmall,
                color = androidx.compose.ui.graphics.Color(0xFF9CA3AF),
            )
        }
        TextButton(onClick = onRetry) {
            Icon(Icons.Outlined.Refresh, contentDescription = null)
            Text(" Retry", fontWeight = FontWeight.SemiBold)
        }
    }
}
