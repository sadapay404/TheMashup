package local.themashup.music.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DragIndicator
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.PlaylistPlay
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.roundToInt
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.Playlist
import local.themashup.music.core.domain.Track
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.AddToPlaylistButton
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.components.TrackRow
import local.themashup.music.ui.logic.relativeTime
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Library — web `library/LibraryPage`: Liked / Playlists / Recently played
 * tabs with counts, inline playlist creation, playlist detail with
 * long-press drag-reorder (native port of framer `Reorder.Group`) + remove,
 * history rows with relative time. Local profile is always identified
 * (SignInGate not needed on device).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LibraryScreen(
    engine: PlaybackEngine,
    library: LibraryRepository,
    playerState: PlayerSnapshot,
    onDownload: (Track) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val libState by library.state.collectAsState()

    var tab by rememberSaveable { mutableStateOf("liked") }
    var activePlaylistId by rememberSaveable { mutableStateOf<String?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var newName by rememberSaveable { mutableStateOf("") }

    fun playContext(track: Track, queue: List<Track>, context: String) {
        val index = queue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        engine.playQueue(queue, startIndex = index, context = context)
        scope.launch { library.recordPlay(track, context = context) }
    }

    /* ── playlist detail ── */
    val activePl: Playlist? = activePlaylistId?.let { id -> libState.playlists.find { it.id == id } }
    if (activePl != null) {
        val tracks = libState.playlistTracks[activePl.id].orEmpty()
        Column(
            modifier = modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Row(
                modifier = Modifier
                    .padding(top = 4.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(scheme.surface)
                    .border(1.dp, tokens.border, RoundedCornerShape(999.dp))
                    .clickable { activePlaylistId = null }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("‹ All playlists", color = tokens.textDim, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(
                    src = tracks.firstOrNull()?.artworkBest ?: tracks.firstOrNull()?.artwork,
                    label = activePl.name,
                    corner = 16.dp,
                    modifier = Modifier.size(120.dp),
                )
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 16.dp),
                ) {
                    Text(
                        text = "PLAYLIST",
                        color = tokens.accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp,
                    )
                    Text(
                        text = activePl.name,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = scheme.onBackground,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                    Text(
                        text = "${tracks.size} track${if (tracks.size == 1) "" else "s"}",
                        color = tokens.textDim,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    Row(modifier = Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                tracks.firstOrNull()?.let { playContext(it, tracks, "playlist") }
                            },
                            enabled = tracks.isNotEmpty(),
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(14.dp))
                            Text("  Play all", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    library.deletePlaylist(activePl.id)
                                    activePlaylistId = null
                                }
                            },
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(14.dp), tint = tokens.accent)
                            Text("  Delete", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tokens.accent)
                        }
                    }
                }
            }

            if (tracks.isEmpty()) {
                EmptyState(
                    icon = { Icon(Icons.Outlined.PlaylistPlay, contentDescription = null) },
                    title = "Empty playlist",
                    body = "Use “Add to playlist” on any search result or row.",
                )
            } else {
                ReorderableTrackList(
                    playlistId = activePl.id,
                    tracks = tracks,
                    playerState = playerState,
                    library = library,
                    onPlay = { t -> playContext(t, tracks, "playlist") },
                    onDownload = onDownload,
                )
                if (tracks.size > 1) {
                    Text(
                        text = "long-press a row to drag — order syncs to your library",
                        color = tokens.textFaint,
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp, bottom = 6.dp),
                    )
                }
            }
        }
        return
    }

    /* ── tabs ── */
    val tabs = listOf(
        Triple("liked", "Liked", libState.likes.size),
        Triple("playlists", "Playlists", libState.playlists.size),
        Triple("history", "Recently played", libState.history.size),
    )
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            tabs.forEach { (id, label, count) ->
                val selected = tab == id
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (selected) tokens.accent else scheme.surface)
                        .border(
                            1.dp,
                            if (selected) tokens.accent else tokens.border,
                            RoundedCornerShape(999.dp),
                        )
                        .clickable { tab = id }
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TabIcon(id = id, selected = selected)
                    Text(
                        text = " $label ",
                        color = if (selected) tokens.accentContrast else tokens.textDim,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = count.toString(),
                        color = if (selected) tokens.accentContrast else tokens.textFaint,
                        fontSize = 11.sp,
                    )
                }
            }
        }

        when (tab) {
            "liked" -> {
                if (libState.likes.isEmpty()) {
                    EmptyState(
                        icon = { Icon(Icons.Outlined.FavoriteBorder, contentDescription = null) },
                        title = "No liked songs yet",
                        body = "Tap the heart on any track to keep it here.",
                    )
                }
                libState.likes.forEach { t ->
                    TrackRow(
                        track = t,
                        isCurrent = playerState.current?.id == t.id,
                        onClick = { playContext(t, libState.likes, "library") },
                        modifier = Modifier.padding(vertical = 2.dp),
                        onDownload = onDownload,
                        trailing = { AddToPlaylistButton(track = t, library = library) },
                    )
                }
            }

            "playlists" -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (!creating) {
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(tokens.accent.copy(alpha = 0.10f))
                                .border(1.dp, tokens.accent.copy(alpha = 0.6f), RoundedCornerShape(999.dp))
                                .clickable { creating = true }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null, tint = tokens.accent, modifier = Modifier.size(14.dp))
                            Text(
                                text = " New playlist",
                                color = tokens.accent,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    } else {
                        OutlinedTextField(
                            value = newName,
                            onValueChange = { newName = it.take(120) },
                            placeholder = { Text("Playlist name…", color = tokens.textFaint) },
                            singleLine = true,
                            shape = RoundedCornerShape(999.dp),
                            modifier = Modifier.width(170.dp),
                            colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = tokens.accent,
                                unfocusedBorderColor = tokens.accent.copy(alpha = 0.6f),
                                focusedContainerColor = scheme.surface,
                                unfocusedContainerColor = scheme.surface,
                                focusedTextColor = scheme.onBackground,
                                unfocusedTextColor = scheme.onBackground,
                                cursorColor = tokens.accent,
                            ),
                        )
                        TextButton(
                            onClick = {
                                val title = newName.trim()
                                if (title.isNotEmpty()) {
                                    scope.launch {
                                        val pl = library.createPlaylist(title)
                                        newName = ""
                                        creating = false
                                        activePlaylistId = pl.id
                                    }
                                }
                            },
                            enabled = newName.trim().isNotEmpty(),
                        ) {
                            Text("Create", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = tokens.accent)
                        }
                        TextButton(onClick = { creating = false; newName = "" }) {
                            Text("Cancel", fontSize = 12.sp, color = tokens.textFaint)
                        }
                    }
                }

                if (libState.playlists.isEmpty()) {
                    EmptyState(
                        icon = { Icon(Icons.Outlined.PlaylistPlay, contentDescription = null) },
                        title = "No playlists yet",
                        body = "Create one, then add tracks from search results.",
                    )
                } else {
                    libState.playlists.chunked(2).forEach { rowItems ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            rowItems.forEach { pl ->
                                val cover = libState.playlistTracks[pl.id]?.firstOrNull()
                                PlaylistCard(
                                    title = pl.name,
                                    count = libState.playlistTracks[pl.id]?.size ?: 0,
                                    coverUrl = cover?.artworkBest ?: cover?.artwork,
                                    onClick = { activePlaylistId = pl.id },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }

            else -> {
                if (libState.history.isEmpty()) {
                    EmptyState(
                        icon = { Icon(Icons.Outlined.History, contentDescription = null) },
                        title = "Nothing played yet",
                        body = "Start a track and it shows up here instantly.",
                    )
                }
                val histTracks = libState.history.map { it.track }
                libState.history.forEach { h ->
                    TrackRow(
                        track = h.track,
                        isCurrent = playerState.current?.id == h.track.id,
                        onClick = { playContext(h.track, histTracks, "history") },
                        modifier = Modifier.padding(vertical = 2.dp),
                        onDownload = onDownload,
                        trailing = {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = relativeTime(h.at, System.currentTimeMillis()),
                                    color = tokens.textFaint,
                                    fontSize = 10.sp,
                                )
                                AddToPlaylistButton(track = h.track, library = library)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun TabIcon(id: String, selected: Boolean) {
    val tokens = LocalMashupTokens.current
    val tint = if (selected) tokens.accentContrast else tokens.textDim
    when (id) {
        "liked" -> Icon(Icons.Outlined.FavoriteBorder, contentDescription = null, tint = tint, modifier = Modifier.size(13.dp))
        "playlists" -> Icon(Icons.Outlined.PlaylistPlay, contentDescription = null, tint = tint, modifier = Modifier.size(13.dp))
        else -> Icon(Icons.Outlined.History, contentDescription = null, tint = tint, modifier = Modifier.size(13.dp))
    }
}

@Composable
private fun PlaylistCard(
    title: String,
    count: Int,
    coverUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(scheme.surface.copy(alpha = 0.6f))
            .border(1.dp, tokens.border, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(10.dp),
    ) {
        Artwork(
            src = coverUrl,
            label = title,
            corner = 12.dp,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f),
        )
        Text(
            text = title,
            color = scheme.onBackground,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            text = "$count track${if (count == 1) "" else "s"}",
            color = tokens.textFaint,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun EmptyState(icon: @Composable () -> Unit, title: String, body: String) {
    val tokens = LocalMashupTokens.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 24.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, tokens.border, RoundedCornerShape(16.dp))
            .padding(vertical = 28.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        icon()
        Text(
            text = title,
            color = tokens.textDim,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            text = body,
            color = tokens.textFaint,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/**
 * Long-press drag-to-reorder list — native stand-in for framer
 * `Reorder.Group` (web rows drag anywhere; Android uses the long-press
 * gesture per the docs). One swap is committed per crossing while dragging;
 * the row follows the finger, then the library persists the order.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ReorderableTrackList(
    playlistId: String,
    tracks: List<Track>,
    playerState: PlayerSnapshot,
    library: LibraryRepository,
    onPlay: (Track) -> Unit,
    onDownload: ((Track) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val rowPx = with(density) { 60.dp.toPx() }

    Column(modifier = Modifier.fillMaxWidth()) {
        tracks.forEachIndexed { index, track ->
            var dragOffsetY by remember(track.id, playlistId) { mutableFloatStateOf(0f) }
            var dragging by remember(track.id, playlistId) { mutableStateOf(false) }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .graphicsLayer {
                        translationY = dragOffsetY
                        scaleX = if (dragging) 1.01f else 1f
                        scaleY = scaleX
                        if (dragging) shadowElevation = 12f
                    }
                    .pointerInput(track.id, playlistId) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { dragging = true },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                dragOffsetY += dragAmount.y
                            },
                            onDragEnd = {
                                // One commit per gesture: rows stay put while
                                // the dragged row floats (framer Reorder shows
                                // live shuffling; see phase report), then the
                                // final target persists to the library.
                                val steps = (dragOffsetY / rowPx).roundToInt()
                                val target = (index + steps).coerceIn(0, tracks.lastIndex)
                                if (target != index) {
                                    scope.launch { library.reorderPlaylist(playlistId, index, target) }
                                }
                                dragOffsetY = 0f
                                dragging = false
                            },
                            onDragCancel = { dragOffsetY = 0f; dragging = false },
                        )
                    },
            ) {
                TrackRow(
                    track = track,
                    isCurrent = playerState.current?.id == track.id,
                    onClick = { onPlay(track) },
                    modifier = Modifier.padding(vertical = 2.dp),
                    onDownload = onDownload,
                    trailing = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(
                                Icons.Outlined.DragIndicator,
                                contentDescription = "Drag to reorder",
                                tint = tokensFaint(),
                                modifier = Modifier.size(18.dp),
                            )
                            Icon(
                                Icons.Outlined.Delete,
                                contentDescription = "Remove from playlist",
                                tint = tokensFaint(),
                                modifier = Modifier
                                    .size(18.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable {
                                        scope.launch {
                                            library.removeTrackFromPlaylist(playlistId, track.id)
                                        }
                                    },
                            )
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun tokensFaint(): androidx.compose.ui.graphics.Color =
    LocalMashupTokens.current.textFaint
