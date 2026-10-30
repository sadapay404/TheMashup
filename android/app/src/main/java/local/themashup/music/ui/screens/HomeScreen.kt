package local.themashup.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.style.TextOverflow
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
import local.themashup.music.core.network.YouTubeMusicHome
import local.themashup.music.core.network.MusicHomeShelf
import local.themashup.music.core.network.MusicHomeItem
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.FadeSlideIn
import local.themashup.music.ui.components.ShelfSection
import local.themashup.music.ui.components.TrackCard
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.theme.LocalMashupTokens
import local.themashup.music.ui.theme.LocalArtAccents

/**
 * Home displays the connected YouTube Music account's recommendations.
 * Tracks are played by TheMashup's native player, not by the sign-in WebView.
 */
@Composable
fun HomeScreen(
    extraction: ExtractionService,
    library: LibraryRepository,
    engine: PlaybackEngine,
    playerState: PlayerSnapshot,
    youtubeCookie: String,
    onConnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val accents = LocalArtAccents.current
    val scope = rememberCoroutineScope()
    var retryTick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var personalized by remember { mutableStateOf<List<MusicHomeShelf>>(emptyList()) }
    val musicHome = remember { YouTubeMusicHome() }
    LaunchedEffect(retryTick, youtubeCookie) {
        personalized = emptyList()
        error = null
        if (youtubeCookie.isBlank()) {
            loading = false
        } else {
            loading = true
            val result = withContext(Dispatchers.IO) { runCatching { musicHome.load(youtubeCookie) } }
            personalized = result.getOrDefault(emptyList())
            error = result.exceptionOrNull()?.message
            loading = false
        }
    }

    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            FadeSlideIn(offsetYDp = (-8).dp) { WelcomeHero(accent = accents.first, accentAlt = accents.second) }
        }
        if (loading) {
            items(2) { i ->
                ShelfSection(
                    title = "Loading recommendations", kindPill = "FOR YOU", tracks = emptyList(),
                    loading = true, modifier = Modifier.padding(top = if (i == 0) 28.dp else 20.dp),
                )
            }
        }
        if (error != null && !loading) {
            item {
                ChartsErrorCard(message = error.orEmpty(), onRetry = { retryTick++ })
                TextButton(onClick = onConnect, modifier = Modifier.padding(horizontal = 16.dp)) { Text("Manage connection") }
            }
        }
        if (youtubeCookie.isBlank()) {
            item { TextButton(onClick = onConnect, modifier = Modifier.padding(16.dp)) {
                Text("Connect your YouTube account to see your recommendations")
            } }
        }
        itemsIndexed(personalized, key = { index, shelf -> "$index:${shelf.title}" }) { _, shelf ->
            RecommendationShelf(
                shelf = shelf, cookie = youtubeCookie, musicHome = musicHome,
                playerState = playerState,
                onPlay = { track ->
                    engine.playNow(track, context = "home")
                    scope.launch { library.recordPlay(track, context = "home") }
                },
                onQueue = { engine.addToEnd(it) },
            )
        }
    }
}

/** YouTube albums and playlists expand here on Home; neither expansion nor playback auto-fills a queue. */
@Composable
private fun RecommendationShelf(
    shelf: MusicHomeShelf,
    cookie: String,
    musicHome: YouTubeMusicHome,
    playerState: PlayerSnapshot,
    onPlay: (Track) -> Unit,
    onQueue: (Track) -> Unit,
) {
    val tokens = LocalMashupTokens.current
    var selected by remember(shelf) { mutableStateOf<MusicHomeItem.Collection?>(null) }
    var tracks by remember(shelf) { mutableStateOf<List<Track>>(emptyList()) }
    var loading by remember(shelf) { mutableStateOf(false) }
    var error by remember(shelf) { mutableStateOf<String?>(null) }
    LaunchedEffect(selected, cookie) {
        val choice = selected
        tracks = emptyList()
        error = null
        if (choice != null) {
            loading = true
            val result = withContext(Dispatchers.IO) { runCatching { musicHome.loadCollection(cookie, choice.browseId) } }
            tracks = result.getOrDefault(emptyList())
            error = result.exceptionOrNull()?.message
            loading = false
        } else loading = false
    }
    Column(Modifier.fillMaxWidth().padding(top = 26.dp)) {
        Text(
            shelf.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.padding(horizontal = 16.dp),
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        LazyRow(
            modifier = Modifier.padding(top = 12.dp),
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(shelf.items) { _, item ->
                when (item) {
                    is MusicHomeItem.Song -> TrackCard(
                        track = item.track, contextQueue = emptyList(),
                        isCurrent = playerState.current?.id == item.track.id,
                        isPlaying = playerState.status == local.themashup.music.core.player.PlayStatus.PLAYING,
                        onPlay = { onPlay(item.track) }, onQueue = { onQueue(item.track) }, onRadio = {}, showRadio = false,
                    )
                    is MusicHomeItem.Collection -> Column(
                        Modifier.width(164.dp).clip(RoundedCornerShape(12.dp)).clickable {
                            selected = if (selected == item) null else item
                        },
                    ) {
                        Artwork(src = item.artwork, label = item.title, corner = 12.dp,
                            modifier = Modifier.fillMaxWidth().aspectRatio(1f))
                        Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
                        Text(if (selected == item) "Hide songs" else "Show songs", style = MaterialTheme.typography.bodySmall,
                            color = tokens.textDim)
                    }
                }
            }
        }
        val choice = selected
        if (choice != null) {
            if (loading) {
                CircularProgressIndicator(modifier = Modifier.padding(16.dp).size(24.dp), strokeWidth = 2.dp)
            } else if (error != null || tracks.isEmpty()) {
                Text(error ?: "No playable songs were returned for this collection.",
                    color = tokens.textDim, modifier = Modifier.padding(16.dp))
            } else {
                ShelfSection(title = choice.title, kindPill = "SONGS", tracks = tracks,
                    currentTrackId = playerState.current?.id,
                    isPlaying = playerState.status == local.themashup.music.core.player.PlayStatus.PLAYING,
                    showRadio = false, modifier = Modifier.padding(top = 16.dp),
                    onCardPlay = { track, _ -> onPlay(track) }, onCardQueue = onQueue)
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
                text = "Your recommendations, your queue, and your music — all in TheMashup.",
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
