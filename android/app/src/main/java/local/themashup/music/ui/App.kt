package local.themashup.music.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.AppContainer
import local.themashup.music.core.domain.Track
import local.themashup.music.core.download.FfmpegState
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.art.rememberArtAccents
import local.themashup.music.ui.components.FfmpegSheet
import local.themashup.music.ui.components.MiniPlayer
import local.themashup.music.ui.components.QualityPicker
import local.themashup.music.ui.components.ThemeSwatchPicker
import local.themashup.music.ui.logic.DEFAULT_THEME_ID
import local.themashup.music.ui.logic.themeFromKey
import local.themashup.music.ui.player.ExpandedPlayer
import local.themashup.music.ui.player.QueueList
import local.themashup.music.ui.screens.DownloadsScreen
import local.themashup.music.ui.screens.HomeScreen
import local.themashup.music.ui.screens.LibraryScreen
import local.themashup.music.ui.screens.SearchScreen
import local.themashup.music.ui.theme.LocalMashupTokens
import local.themashup.music.ui.theme.TheMashupTheme
import local.themashup.music.ui.theme.WithArtAccents

/** Per-page title + blurb — web PAGE_TITLES. */
private val PAGE_TITLES: Map<String, Pair<String, String>> = mapOf(
    "home" to ("Home" to "Picks tuned by what you play"),
    "search" to ("Search" to "Songs, artists & lyric lookup"),
    "library" to ("Library" to "Likes, playlists & history"),
    "downloads" to ("Downloads" to "MP3 · FLAC · MP4 in every quality"),
)

private data class NavItem(val id: String, val label: String, val icon: ImageVector)

private val NAV_ITEMS = listOf(
    NavItem("home", "Home", Icons.Filled.Home),
    NavItem("search", "Search", Icons.Filled.Search),
    NavItem("library", "Library", Icons.Filled.LibraryMusic),
    NavItem("downloads", "Downloads", Icons.Filled.Download),
)

/**
 * Root UI: persisted theme (DataStore) + scaffold shell — top bar with the
 * 5-swatch switcher, page content (Crossfade like the web AnimatePresence
 * route swap), mini player + 4-tab bottom nav, plus N6 overlays: expanded
 * fullscreen player and the slide-in queue drawer. Art accents sample the
 * current artwork app-wide (`--art-1` / `--art-2`).
 */
@Composable
fun TheMashupRoot(container: AppContainer) {
    val themeKey by container.settings.themeKey.collectAsState(initial = DEFAULT_THEME_ID.storageKey)
    TheMashupTheme(themeId = themeFromKey(themeKey)) {
        MashupShell(container)
    }
}

@Composable
private fun MashupShell(container: AppContainer) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val playerState by container.player.state.collectAsState()

    var page by rememberSaveable { mutableStateOf("home") }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var queueOpen by rememberSaveable { mutableStateOf(false) }
    var playerTab by rememberSaveable { mutableStateOf("lyrics") }
    // N7: track queued for the quality picker (web uiStore.downloadTrack).
    var pendingDownload by remember { mutableStateOf<Track?>(null) }
    var ffmpegManualOpen by remember { mutableStateOf(false) }
    val themeKeyState by container.settings.themeKey.collectAsState(initial = DEFAULT_THEME_ID.storageKey)

    val artwork = playerState.current?.artworkBest ?: playerState.current?.artwork
    val accents = rememberArtAccents(url = artwork, seed = playerState.current?.id ?: "themashup")

    BackHandler(enabled = page != "home") { page = "home" }

    WithArtAccents(accents) {
        Box(modifier = Modifier.fillMaxSize()) {
            Scaffold(
                topBar = {
                    AppTopBar(
                        page = page,
                        themeKey = themeKeyState,
                        onSelectTheme = { theme ->
                            scope.launch { container.settings.setThemeKey(theme.storageKey) }
                        },
                    )
                },
                bottomBar = {
                    Column {
                        AnimatedVisibility(
                            visible = playerState.current != null,
                            enter = fadeIn(),
                            exit = fadeOut(),
                        ) {
                            MiniPlayer(
                                state = playerState,
                                onPrev = { container.player.prevTrack() },
                                onToggle = { container.player.togglePlay() },
                                onNext = { container.player.nextTrack() },
                                onQueue = { queueOpen = !queueOpen },
                                onExpand = { expanded = true },
                                queueOpen = queueOpen,
                            )
                        }
                        NavigationBar(
                            containerColor = scheme.surface,
                            tonalElevation = 0.dp,
                        ) {
                            NAV_ITEMS.forEach { item ->
                                NavigationBarItem(
                                    selected = page == item.id,
                                    onClick = { page = item.id },
                                    icon = { Icon(item.icon, contentDescription = item.label) },
                                    label = { Text(item.label, fontSize = 11.sp) },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = tokens.accentContrast,
                                        indicatorColor = tokens.accent,
                                        selectedTextColor = tokens.accent,
                                        unselectedIconColor = tokens.textDim,
                                        unselectedTextColor = tokens.textDim,
                                    ),
                                )
                            }
                        }
                    }
                },
            ) { padding ->
                Box(modifier = Modifier.padding(padding)) {
                    Crossfade(targetState = page, label = "page") { current ->
                        when (current) {
                            "home" -> HomeScreen(
                                extraction = container.extraction,
                                library = container.library,
                                engine = container.player,
                                playerState = playerState,
                                modifier = Modifier.fillMaxSize(),
                            )
                            "search" -> SearchScreen(
                                query = searchQuery,
                                onQueryChange = { searchQuery = it },
                                extraction = container.extraction,
                                engine = container.player,
                                library = container.library,
                                playerState = playerState,
                                onDownload = { pendingDownload = it },
                                modifier = Modifier.fillMaxSize(),
                            )
                            "library" -> LibraryScreen(
                                engine = container.player,
                                library = container.library,
                                playerState = playerState,
                                onDownload = { pendingDownload = it },
                                modifier = Modifier.fillMaxSize(),
                            )
                            else -> DownloadsScreen(
                                downloads = container.downloads,
                                engine = container.downloadEngine,
                                ffmpegManager = container.ffmpeg,
                                onFindSomething = { page = "search" },
                                onOpenSetup = { ffmpegManualOpen = true },
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                }
            }

            /* ── queue drawer (web QueueDrawer: right slide-in) ─────── */
            BackHandler(enabled = queueOpen) { queueOpen = false }
            AnimatedVisibility(
                visible = queueOpen,
                enter = slideInHorizontally(initialOffsetX = { it }) + fadeIn(),
                exit = slideOutHorizontally(targetOffsetX = { it }) + fadeOut(),
                modifier = Modifier.fillMaxSize(),
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color.Black.copy(alpha = 0.45f))
                            .clickable { queueOpen = false },
                    )
                    QueueDrawerPanel(
                        state = playerState,
                        engine = container.player,
                        library = container.library,
                        onClose = { queueOpen = false },
                        modifier = Modifier.align(Alignment.CenterEnd),
                    )
                }
            }

            /* ── expanded fullscreen player ─────────────────────────── */
            BackHandler(enabled = expanded) { expanded = false }
            AnimatedVisibility(
                visible = expanded,
                enter = slideInVertically(initialOffsetY = { it / 6 }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { it / 4 }) + fadeOut(),
                modifier = Modifier.fillMaxSize(),
            ) {
                ExpandedPlayer(
                    state = playerState,
                    engine = container.player,
                    library = container.library,
                    extraction = container.extraction,
                    playerTab = playerTab,
                    onTabChange = { playerTab = it },
                    onCollapse = { expanded = false },
                    modifier = Modifier.fillMaxSize(),
                    onDownload = { pendingDownload = it },
                )
            }

            /* ── N7 overlays: quality picker + first-run ffmpeg sheet ── */
            pendingDownload?.let { track ->
                QualityPicker(
                    track = track,
                    extraction = container.extraction,
                    onDismiss = { pendingDownload = null },
                    onStart = { t, quality, containerKey ->
                        container.downloadEngine.enqueue(t, quality, containerKey)
                        pendingDownload = null
                    },
                )
            }

            val ffmpegState by container.ffmpeg.status.collectAsState()
            val ffmpegConsent by container.downloadEngine.consent.collectAsState()
            val ffmpegVisible = ffmpegConsent != null ||
                ffmpegState is FfmpegState.Downloading ||
                ffmpegState is FfmpegState.Extracting ||
                ffmpegManualOpen
            if (ffmpegVisible) {
                FfmpegSheet(
                    status = ffmpegState,
                    pending = ffmpegConsent != null,
                    onAccept = {
                        ffmpegManualOpen = false
                        container.downloadEngine.acceptSetup()
                    },
                    onDecline = {
                        ffmpegManualOpen = false
                        container.downloadEngine.declineSetup()
                    },
                    onDismiss = { ffmpegManualOpen = false },
                )
            }
        }
    }
}

/** Right-hand slide-in queue — web `QueueDrawer` panel. */
@Composable
private fun QueueDrawerPanel(
    state: PlayerSnapshot,
    engine: local.themashup.music.core.player.PlaybackEngine,
    library: local.themashup.music.core.data.LibraryRepository,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val count = state.queue.size

    Box(
        modifier = modifier
            .fillMaxHeight()
            .fillMaxWidth(0.88f)
            .widthIn(max = 330.dp)
            .background(tokens.bgSoft.copy(alpha = 0.97f))
            .border(1.dp, tokens.border),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, tokens.border)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Queue",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = scheme.onBackground,
                    )
                    Text(
                        text = "$count track${if (count == 1) "" else "s"}",
                        color = tokens.textFaint,
                        fontSize = 11.sp,
                    )
                }
                if (count > 0) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = "Clear queue",
                        tint = tokens.textDim,
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { engine.clearQueue() }
                            .padding(7.dp),
                    )
                }
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Close queue",
                    tint = tokens.textDim,
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClick = onClose)
                        .padding(7.dp),
                )
            }
            QueueList(
                state = state,
                engine = engine,
                library = library,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )
        }
    }
}

/** Web AppShell header: brand chip + title/blurb + 5-swatch switcher. */
@Composable
private fun AppTopBar(
    page: String,
    themeKey: String,
    onSelectTheme: (local.themashup.music.ui.logic.ThemeId) -> Unit,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val (title, blurb) = PAGE_TITLES[page] ?: ("Home" to "")
    val current = themeFromKey(themeKey)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top))
            .background(scheme.background)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Brand chip — web Disc3 logo (accent-filled rounded square).
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(tokens.accent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.MusicNote,
                contentDescription = null,
                tint = tokens.accentContrast,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = scheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = blurb,
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textFaint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ThemeSwatchPicker(current = current, onSelect = onSelectTheme)
        // Local profile chip — web AuthArea avatar.
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(tokens.accent.copy(alpha = 0.18f))
                .border(BorderStroke(1.dp, tokens.border), RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "M",
                color = tokens.accent,
                fontSize = 13.sp,
            )
        }
    }
}
