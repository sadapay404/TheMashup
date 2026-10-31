package local.themashup.music.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.AlertDialog
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
    currentTrackId: String?,
    onDownload: (Track) -> Unit,
    onDownloadPlaylist: ((List<Track>) -> Unit)? = null,
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
    var confirmDelete by remember { mutableStateOf(false) }
    val activePl = activePlaylistId?.let { id -> libState.playlists.find { it.id == id } }

    if (confirmDelete && activePl != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete playlist?") },
            text = { Text("Delete “${activePl.name}”? This does not delete downloaded files.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        library.deletePlaylist(activePl.id)
                        activePlaylistId = null
                        confirmDelete = false
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        if (activePl != null) {
            val tracks = libState.playlistTracks[activePl.id].orEmpty()
            item {
                Column {
                    Row(
                        modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(999.dp))
                            .background(scheme.surface).border(1.dp, tokens.border, RoundedCornerShape(999.dp))
                            .clickable { activePlaylistId = null }.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) { Text("‹ All playlists", color = tokens.textDim, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
                    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Artwork(src = tracks.firstOrNull()?.artworkBest ?: tracks.firstOrNull()?.artwork,
                            label = activePl.name, corner = 16.dp, modifier = Modifier.size(120.dp))
                        Column(Modifier.weight(1f).padding(start = 16.dp)) {
                            Text("PLAYLIST", color = tokens.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                            Text(activePl.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold,
                                color = scheme.onBackground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text("${tracks.size} track${if (tracks.size == 1) "" else "s"}", color = tokens.textDim, fontSize = 13.sp)
                        }
                        Spacer(modifier = Modifier.weight(1f))
                        if (tracks.isNotEmpty()) {
                            TextButton(onClick = { onDownloadPlaylist?.invoke(tracks) }) {
                                Text("Download")
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { tracks.firstOrNull()?.let { engine.playNow(it, context = "playlist") } },
                            enabled = tracks.isNotEmpty(), shape = RoundedCornerShape(999.dp)) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(14.dp))
                            Text("  Play first", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(onClick = { confirmDelete = true }, shape = RoundedCornerShape(999.dp)) {
                            Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(14.dp), tint = tokens.accent)
                            Text("  Delete", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tokens.accent)
                        }
                    }
                }
            }
            if (tracks.isEmpty()) {
                item { EmptyState(icon = { Icon(Icons.Outlined.PlaylistPlay, contentDescription = null) },
                    title = "Empty playlist", body = "Use “Add to playlist” on any search result or row.") }
            } else {
                itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
                    ReorderableTrackRow(
                        playlistId = activePl.id, tracks = tracks, index = index, track = track,
                        currentTrackId = currentTrackId, library = library,
                        onPlay = { engine.playNow(it, context = "playlist") }, onDownload = onDownload,
                    )
                }
                if (tracks.size > 1) item {
                    Text("Long-press a row to reorder it", color = tokens.textFaint, fontSize = 11.sp,
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp))
                }
            }
        } else {
            val tabs = listOf(
                Triple("liked", "Liked", libState.likes.size),
                Triple("playlists", "Playlists", libState.playlists.size),
                Triple("history", "Recently played", libState.history.size),
            )
            item {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tabs.forEach { (id, label, count) ->
                        val selected = tab == id
                        Row(
                            modifier = Modifier.clip(RoundedCornerShape(999.dp))
                                .background(if (selected) tokens.accent else scheme.surface)
                                .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(999.dp))
                                .clickable { tab = id }.padding(horizontal = 14.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TabIcon(id, selected)
                            Text(" $label ", color = if (selected) tokens.accentContrast else tokens.textDim,
                                fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(count.toString(), color = if (selected) tokens.accentContrast else tokens.textFaint, fontSize = 11.sp)
                        }
                    }
                }
            }
            when (tab) {
                "liked" -> {
                    if (libState.likes.isEmpty()) item {
                        EmptyState(icon = { Icon(Icons.Outlined.FavoriteBorder, contentDescription = null) },
                            title = "No liked songs yet", body = "Tap the heart on any track to keep it here.")
                    }
                    items(libState.likes, key = { it.id }) { track ->
                        TrackRow(track = track, isCurrent = currentTrackId == track.id,
                            onClick = { engine.playNow(track, context = "library") },
                            modifier = Modifier.padding(vertical = 2.dp), onDownload = onDownload,
                            onQueue = { engine.addToEnd(track) },
                            trailing = { AddToPlaylistButton(track = track, library = library) })
                    }
                }
                "playlists" -> {
                    item {
                        if (!creating) {
                            TextButton(onClick = { creating = true }) {
                                Icon(Icons.Filled.Add, contentDescription = null, tint = tokens.accent, modifier = Modifier.size(14.dp))
                                Text(" New playlist", color = tokens.accent, fontWeight = FontWeight.Bold)
                            }
                        } else {
                            Column(Modifier.fillMaxWidth()) {
                                OutlinedTextField(value = newName, onValueChange = { newName = it.take(120) },
                                    placeholder = { Text("Playlist name…", color = tokens.textFaint) },
                                    singleLine = true, modifier = Modifier.fillMaxWidth())
                                Row {
                                    TextButton(onClick = {
                                        val title = newName.trim()
                                        if (title.isNotEmpty()) scope.launch {
                                            val playlist = library.createPlaylist(title)
                                            newName = ""
                                            creating = false
                                            activePlaylistId = playlist.id
                                        }
                                    }, enabled = newName.trim().isNotEmpty()) { Text("Create") }
                                    TextButton(onClick = { creating = false; newName = "" }) { Text("Cancel") }
                                }
                            }
                        }
                    }
                    if (libState.playlists.isEmpty()) item {
                        EmptyState(icon = { Icon(Icons.Outlined.PlaylistPlay, contentDescription = null) },
                            title = "No playlists yet", body = "Create one, then add tracks from search results.")
                    }
                    items(libState.playlists.chunked(2)) { rowItems ->
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            rowItems.forEach { playlist ->
                                val cover = libState.playlistTracks[playlist.id]?.firstOrNull()
                                PlaylistCard(title = playlist.name, count = libState.playlistTracks[playlist.id]?.size ?: 0,
                                    coverUrl = cover?.artworkBest ?: cover?.artwork,
                                    onClick = { activePlaylistId = playlist.id }, modifier = Modifier.weight(1f))
                            }
                            if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
                else -> {
                    if (libState.history.isEmpty()) item {
                        EmptyState(icon = { Icon(Icons.Outlined.History, contentDescription = null) },
                            title = "Nothing played yet", body = "Start a track and it shows up here.")
                    }
                    items(libState.history, key = { it.track.id }) { entry ->
                        val track = entry.track
                        TrackRow(track = track, isCurrent = currentTrackId == track.id,
                            onClick = { engine.playNow(track, context = "history") },
                            modifier = Modifier.padding(vertical = 2.dp), onDownload = onDownload,
                            onQueue = { engine.addToEnd(track) },
                            trailing = {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(relativeTime(entry.at, System.currentTimeMillis()), color = tokens.textFaint, fontSize = 10.sp)
                                    AddToPlaylistButton(track = track, library = library)
                                }
                            })
                    }
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
private fun ReorderableTrackRow(
    playlistId: String,
    tracks: List<Track>,
    index: Int,
    track: Track,
    currentTrackId: String?,
    library: LibraryRepository,
    onPlay: (Track) -> Unit,
    onDownload: ((Track) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val rowPx = with(density) { 60.dp.toPx() }

    run {
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
                    .pointerInput(track.id, playlistId, index, tracks.size) {
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
                    isCurrent = currentTrackId == track.id,
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

@Composable
private fun tokensFaint(): androidx.compose.ui.graphics.Color =
    LocalMashupTokens.current.textFaint
