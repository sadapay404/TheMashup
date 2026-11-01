package com.themashup.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.themashup.app.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val screenPad = PaddingValues(horizontal = 16.dp, vertical = 8.dp)

/* ============================== HOME ============================== */
@Composable
fun Shelf(ui: UiState, tracks: List<Track>) {
    val p = LocalPalette.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        itemsIndexed(tracks) { i, t ->
            Column(Modifier.width(140.dp).clickable { Graph.player.playQueue(tracks, i) }) {
                Artwork(t.artwork, modifier = Modifier.fillMaxWidth().aspectRatio(1f), radius = 14.dp)
                Text(t.title, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                Text(t.artist, color = p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
fun HomeScreen(ui: UiState) {
    val p = LocalPalette.current
    val settings by Graph.prefs.settings.collectAsState(initial = Settings())
    val lib by Graph.library.data.collectAsState()
    var trending by remember { mutableStateOf<List<Track>?>(null) }
    var made by remember { mutableStateOf<List<Pair<String, List<Track>>>>(emptyList()) }
    val signedIn = settings.cookie.isNotEmpty()
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { trending = Sources.trending() }
    LaunchedEffect(signedIn, lib.history.firstOrNull()?.id, lib.liked.firstOrNull()?.id) {
        if (!signedIn) { made = emptyList(); return@LaunchedEffect }
        val seeds = listOfNotNull(lib.history.firstOrNull(), lib.liked.firstOrNull()).distinctBy { it.artist }
        made = seeds.map { "More like ${it.artist}" to Sources.related(it) }.filter { it.second.isNotEmpty() }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = screenPad) {
        item {
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(p.surface.copy(alpha = 0.75f))
                    .border(1.dp, p.outline, RoundedCornerShape(26.dp)).padding(22.dp),
            ) {
                Column {
                    LogoMark(44.dp)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        if (signedIn) "Welcome back${if (settings.accountName.isNotEmpty()) ", ${settings.accountName}" else ""}." else "Welcome to your sound.",
                        color = p.text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 32.sp,
                    )
                    Text("Search any song or lyric line, build playlists, download for offline.", color = p.muted, modifier = Modifier.padding(top = 6.dp))
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlineButton("Search") { ui.tab = Tab.Search }
                        OutlineButton("Library") { ui.tab = Tab.Library }
                    }
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton("Theme: ${paletteFor(settings.theme).name}") {
                        val i = Palettes.indexOfFirst { it.id == settings.theme }
                        scope.launch { Graph.prefs.setTheme(Palettes[(i + 1) % Palettes.size].id) }
                    }
                }
            }
        }
        if (!signedIn) item {
            Text(
                "Sign in to YouTube Music in Settings to unlock recommendation shelves.", color = p.muted, fontSize = 13.sp,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp).border(1.dp, p.outline, RoundedCornerShape(16.dp)).clickable { ui.tab = Tab.Settings }.padding(14.dp),
            )
        }
        made.forEach { (title, tracks) ->
            item { SectionTitle(title) }
            item { Shelf(ui, tracks) }
        }
        val recent = lib.history.distinctBy { it.id }.take(12)
        if (recent.isNotEmpty()) {
            item { SectionTitle("Recently played") }
            item { Shelf(ui, recent) }
        }
        item { SectionTitle("Trending charts") }
        item {
            val t = trending
            when {
                t == null -> Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = p.accent) }
                t.isEmpty() -> EmptyState(Icons.Filled.MusicNote, "Charts are unavailable right now", "Check your connection. Search still works.")
                else -> Shelf(ui, t)
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

/* ============================== SEARCH ============================== */
private enum class SearchFilter(val label: String) { All("Everything"), Songs("Songs"), Lyrics("Lyrics"), Artists("Artists") }

@Composable
fun SearchScreen(ui: UiState) {
    val p = LocalPalette.current
    var query by remember { mutableStateOf(ui.searchSeed) }
    var submitted by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(SearchFilter.All) }
    var suggestions by remember { mutableStateOf<List<String>>(emptyList()) }
    var result by remember { mutableStateOf<SearchResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var job by remember { mutableStateOf<Job?>(null) }

    fun run(q: String) {
        val t = q.trim()
        if (t.isEmpty()) return
        submitted = t
        suggestions = emptyList()
        loading = true
        job?.cancel()
        job = scope.launch {
            result = try { Sources.search(t) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { SearchResult(error = e.message ?: "Search failed") }
            loading = false
        }
    }

    LaunchedEffect(ui.searchSeed) {
        if (ui.searchSeed.isNotEmpty()) { query = ui.searchSeed; run(ui.searchSeed) }
    }
    // typeahead, debounced 300ms
    LaunchedEffect(query) {
        if (query.trim().length < 2 || query.trim() == submitted) { suggestions = emptyList(); return@LaunchedEffect }
        delay(300)
        suggestions = runCatching { Sources.suggest(query.trim()) }.getOrDefault(emptyList())
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = screenPad) {
        item {
            ScreenTitle("Search")
            Spacer(Modifier.height(12.dp))
            MashupTextField(query, { query = it }, "Songs, artists, albums, lyric lines…", Modifier.fillMaxWidth(), Icons.Filled.Search, onSearch = { run(query) })
            if (suggestions.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(16.dp)).background(p.raised)) {
                    suggestions.forEach { s ->
                        Text(s, color = p.text, modifier = Modifier.fillMaxWidth().clickable { query = s; run(s) }.padding(14.dp))
                    }
                }
            }
            LazyRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(SearchFilter.entries.toList()) { f -> MChip(f.label, filter == f) { filter = f } }
            }
            Spacer(Modifier.height(8.dp))
        }
        val r = result
        when {
            loading -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = p.accent) } }
            r == null -> item { EmptyState(Icons.Filled.Search, "Find your next favourite", "Search the catalog and the lyric index at once. Try a line from a song.") }
            r.error != null && r.songs.isEmpty() -> item { EmptyState(Icons.Filled.Search, "Search is unavailable", r.error) }
            r.songs.isEmpty() && r.lyrics.isEmpty() && r.artists.isEmpty() -> item { EmptyState(Icons.Filled.Search, "No results for “$submitted”", "Try different keywords.") }
            else -> {
                if (r.via.isNotEmpty()) item { Text("Source: ${r.via.joinToString()}", color = p.subtle, fontSize = 12.sp) }
                if ((filter == SearchFilter.All || filter == SearchFilter.Artists) && r.artists.isNotEmpty()) {
                    item { SectionTitle("Artists") }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(r.artists) { a -> MChip(a.name, false) { ui.search(a.name) } }
                        }
                    }
                }
                if ((filter == SearchFilter.All || filter == SearchFilter.Artists) && r.albums.isNotEmpty()) {
                    item { SectionTitle("Albums") }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(r.albums) { a ->
                                Column(Modifier.width(120.dp).clickable { ui.search("${a.artist} ${a.title}") }) {
                                    Artwork(a.artwork, modifier = Modifier.fillMaxWidth().aspectRatio(1f), radius = 12.dp)
                                    Text(a.title, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(a.artist, color = p.muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
                if ((filter == SearchFilter.All || filter == SearchFilter.Songs) && r.songs.isNotEmpty()) {
                    item { SectionTitle("Songs") }
                    itemsIndexed(r.songs) { i, t -> TrackRow(ui, t, r.songs, i) }
                }
                if ((filter == SearchFilter.All || filter == SearchFilter.Lyrics) && r.lyrics.isNotEmpty()) {
                    item { SectionTitle("Matched in lyrics") }
                    itemsIndexed(r.lyrics) { i, t -> TrackRow(ui, t, r.lyrics, i, showLyric = true) }
                }
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

/* ============================== LIBRARY ============================== */
private enum class LibTab(val label: String) { Playlists("Playlists"), Liked("Liked songs"), Queue("Queue"), History("History"), Recent("Recently added") }

@Composable
fun LibraryScreen(ui: UiState) {
    val p = LocalPalette.current
    val lib by Graph.library.data.collectAsState()
    val queue by Graph.player.queue.collectAsState()
    val idx by Graph.player.index.collectAsState()
    var tab by remember { mutableStateOf(LibTab.Playlists) }
    var openId by remember { mutableStateOf<Long?>(null) }
    var newName by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    val open = lib.playlists.firstOrNull { it.id == openId }

    if (open != null) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = screenPad) {
            item {
                Row(Modifier.clickable { openId = null; renaming = false }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.KeyboardArrowDown, null, tint = p.muted, modifier = Modifier.size(20.dp))
                    Text("Library", color = p.muted)
                }
                if (renaming) {
                    MashupTextField(renameText, { renameText = it }, "Playlist name", Modifier.fillMaxWidth(), onSearch = {
                        if (renameText.isNotBlank()) Graph.library.renamePlaylist(open.id, renameText)
                        renaming = false
                    })
                } else ScreenTitle(open.name)
                Text("${open.tracks.size} songs", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    PrimaryButton("Play", Icons.Filled.PlayArrow, open.tracks.isNotEmpty()) { Graph.player.playQueue(open.tracks, 0) }
                    OutlineButton(if (renaming) "Save" else "Rename") {
                        if (renaming) { if (renameText.isNotBlank()) Graph.library.renamePlaylist(open.id, renameText); renaming = false }
                        else { renameText = open.name; renaming = true }
                    }
                    OutlineButton("Delete") { confirmDelete = true }
                }
                Spacer(Modifier.height(10.dp))
                if (open.tracks.isEmpty()) EmptyState(Icons.AutoMirrored.Filled.QueueMusic, "This playlist is empty", "Use ⋮ on any song → Add to playlist.")
            }
            itemsIndexed(open.tracks) { i, t ->
                TrackRow(ui, t, open.tracks, i, removeLabel = "Remove from playlist", onRemove = { Graph.library.removeFromPlaylist(open.id, t.id) })
            }
        }
        if (confirmDelete) AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = p.raised,
            title = { Text("Delete “${open.name}”?", color = p.text) },
            confirmButton = { TextButton(onClick = { Graph.library.deletePlaylist(open.id); confirmDelete = false; openId = null }) { Text("Delete", color = p.accent) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = p.muted) } },
        )
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = screenPad) {
        item {
            ScreenTitle("Library")
            LazyRow(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(LibTab.entries.toList()) { t -> MChip(t.label, tab == t) { tab = t } }
            }
        }
        when (tab) {
            LibTab.Playlists -> {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        MashupTextField(newName, { newName = it }, "New playlist name", Modifier.weight(1f), onSearch = {
                            if (newName.isNotBlank()) { Graph.library.createPlaylist(newName); newName = "" }
                        })
                        PrimaryButton("Create", Icons.Filled.Add, newName.isNotBlank()) { Graph.library.createPlaylist(newName); newName = "" }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.accentBrush).clickable { tab = LibTab.Liked }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Favorite, null, tint = p.accentText)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text("Liked songs", color = p.accentText, fontWeight = FontWeight.Bold)
                            Text("${lib.liked.size} songs", color = p.accentText.copy(alpha = 0.7f), fontSize = 12.sp)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                items(lib.playlists) { pl ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(16.dp)).background(p.surface)
                            .border(1.dp, p.outline, RoundedCornerShape(16.dp)).clickable { openId = pl.id }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.QueueMusic, null, tint = p.accent)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(pl.name, color = p.text, fontWeight = FontWeight.Bold)
                            Text("${pl.tracks.size} songs", color = p.muted, fontSize = 12.sp)
                        }
                    }
                }
                if (lib.playlists.isEmpty()) item { Text("No playlists yet — create your first one above.", color = p.muted, fontSize = 13.sp) }
            }
            LibTab.Liked -> {
                if (lib.liked.isEmpty()) item { EmptyState(Icons.Filled.Favorite, "No liked songs yet", "Tap the heart on any track.") }
                else {
                    item { PrimaryButton("Play all", Icons.Filled.PlayArrow) { Graph.player.playQueue(lib.liked, 0) } }
                    itemsIndexed(lib.liked) { i, t -> TrackRow(ui, t, lib.liked, i) }
                }
            }
            LibTab.Queue -> {
                if (queue.isEmpty()) item { EmptyState(Icons.AutoMirrored.Filled.QueueMusic, "Queue is empty", "Play something or add songs from ⋮.") }
                else {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("${queue.size} in queue", color = p.muted, fontSize = 13.sp)
                            TextButton(onClick = { Graph.player.clearQueue() }) { Text("Clear queue", color = p.accent) }
                        }
                    }
                    itemsIndexed(queue) { i, t ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (i == idx) p.raised else androidx.compose.ui.graphics.Color.Transparent).clickable { Graph.player.jumpTo(i) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(t.title, color = if (i == idx) p.accent else p.text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(t.artist, color = p.muted, fontSize = 12.sp, maxLines = 1)
                            }
                            IconButton(onClick = { Graph.player.removeFromQueue(i) }) { Icon(Icons.Filled.Delete, "Remove", tint = p.muted) }
                        }
                    }
                }
            }
            LibTab.History -> {
                if (lib.history.isEmpty()) item { EmptyState(Icons.Filled.MusicNote, "Nothing played yet") }
                else {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("Last ${lib.history.size} plays", color = p.muted, fontSize = 13.sp)
                            TextButton(onClick = { Graph.library.clearHistory() }) { Text("Clear", color = p.accent) }
                        }
                    }
                    itemsIndexed(lib.history) { i, t -> TrackRow(ui, t, lib.history, i) }
                }
            }
            LibTab.Recent -> {
                val recent = (lib.downloads.map { it.track } + lib.liked + lib.history).distinctBy { it.id }.take(20)
                if (recent.isEmpty()) item { EmptyState(Icons.Filled.MusicNote, "Nothing here yet", "Songs you like, download or play appear here.") }
                else itemsIndexed(recent) { i, t -> TrackRow(ui, t, recent, i) }
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

/* ============================== DOWNLOADS ============================== */
@Composable
fun DownloadsScreen(ui: UiState) {
    val p = LocalPalette.current
    val jobs by Graph.downloads.jobs.collectAsState()
    val lib by Graph.library.data.collectAsState()
    val active = jobs.filter { it.status != JobStatus.DONE }
    val label = { q: String -> Qualities.firstOrNull { it.first == q }?.second ?: q }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = screenPad) {
        item {
            ScreenTitle("Downloads")
            Text("Saved tracks play without a connection. MP3 conversion uses the bundled ffmpeg binary when present.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Queue")
                if (jobs.any { it.status in listOf(JobStatus.DONE, JobStatus.ERROR, JobStatus.CANCELLED) }) {
                    TextButton(onClick = { Graph.downloads.clearFinished() }) { Text("Clear finished", color = p.accent) }
                }
            }
        }
        if (active.isEmpty()) item { EmptyState(Icons.Filled.Download, "No active downloads", "Use ⋮ → Download… on any track.") }
        items(active) { j ->
            GlassCard(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Artwork(j.track.artwork, 44.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(j.track.title, color = p.text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                "${j.track.artist} · ${label(j.quality)} · ${if (j.status == JobStatus.ERROR) j.error else j.status.name.lowercase()}",
                                color = if (j.status == JobStatus.ERROR) androidx.compose.ui.graphics.Color(0xFFFF7B7B) else p.muted, fontSize = 12.sp, maxLines = 2,
                            )
                        }
                        when (j.status) {
                            JobStatus.DOWNLOADING -> TextButton(onClick = { Graph.downloads.pause(j.id) }) { Text("Pause", color = p.accent) }
                            JobStatus.PAUSED, JobStatus.ERROR -> TextButton(onClick = { Graph.downloads.resume(j.id) }) { Text(if (j.status == JobStatus.ERROR) "Retry" else "Resume", color = p.accent) }
                            else -> {}
                        }
                        if (j.status != JobStatus.CANCELLED) IconButton(onClick = { Graph.downloads.cancel(j.id) }) { Icon(Icons.Filled.Close, "Cancel", tint = p.muted) }
                    }
                    if (j.status == JobStatus.DOWNLOADING || j.status == JobStatus.PAUSED) {
                        Spacer(Modifier.height(8.dp))
                        if (j.total > 0) LinearProgressIndicator(progress = { (j.received.toFloat() / j.total).coerceIn(0f, 1f) }, Modifier.fillMaxWidth(), color = p.accent, trackColor = p.raised)
                        else LinearProgressIndicator(Modifier.fillMaxWidth(), color = p.accent, trackColor = p.raised)
                        Text(fmtBytes(j.received) + if (j.total > 0) " / ${fmtBytes(j.total)}" else "", color = p.subtle, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                    if (j.status == JobStatus.CONVERTING) {
                        Spacer(Modifier.height(8.dp)); LinearProgressIndicator(Modifier.fillMaxWidth(), color = p.accent2, trackColor = p.raised)
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("On this device")
                if (lib.downloads.isNotEmpty()) TextButton(onClick = { Graph.player.playQueue(lib.downloads.map { it.track }, 0) }) { Text("Play all", color = p.accent) }
            }
        }
        if (lib.downloads.isEmpty()) item { EmptyState(Icons.Filled.MusicNote, "No offline tracks yet") }
        itemsIndexed(lib.downloads) { i, d ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { Graph.player.playQueue(lib.downloads.map { it.track }, i) }.padding(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(d.track.artwork, 48.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.track.title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${d.track.artist} · ${label(d.quality)} · ${fmtBytes(d.size)}", color = p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { Graph.library.removeDownload(d) }) { Icon(Icons.Filled.Delete, "Delete", tint = p.muted) }
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}
