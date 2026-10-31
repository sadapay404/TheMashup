package local.themashup.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.HybridRow
import local.themashup.music.core.domain.LyricMatchRow
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.mergeHybrid
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.components.FadeSlideIn
import local.themashup.music.ui.components.TrackRow
import local.themashup.music.ui.theme.LocalMashupTokens
import kotlin.math.roundToInt

/**
 * Search — web `SearchPage.tsx` + `SearchBar.tsx` typeahead, merged for the
 * mobile two-mode surface: the dual-mode engine (metadata search + lyric
 * index + autocomplete in parallel, 170ms debounce) runs on every keystroke,
 * so pasting a half-remembered lyric line switches the results to lyric hits
 * automatically. Filter chips: Everything / Songs / Lyrics / Artists.
 */
@OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)
@Composable
fun SearchScreen(
    query: String,
    onQueryChange: (String) -> Unit,
    extraction: ExtractionService,
    engine: PlaybackEngine,
    library: LibraryRepository,
    currentTrackId: String?,
    onDownload: (Track) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(false) }
    var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
    var matches by remember { mutableStateOf<List<LyricMatchRow>>(emptyList()) }
    var suggestions by remember { mutableStateOf<List<String>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("all") }

    // Publish each source as soon as it returns. A slow lyric provider must
    // not hold up otherwise-ready song search results.
    LaunchedEffect(query) {
        val q = query.trim()
        tracks = emptyList()
        matches = emptyList()
        suggestions = emptyList()
        error = null
        if (q.length < 2) {
            loading = false
            return@LaunchedEffect
        }
        loading = true
        delay(250)
        var catalogDone = false
        var lyricDone = false
        var catalogError: Throwable? = null
        var lyricError: Throwable? = null
        fun finishIfReady() {
            if (catalogDone && lyricDone) {
                loading = false
                error = if (catalogError != null && lyricError != null) {
                    catalogError?.message ?: lyricError?.message ?: "Search failed"
                } else null
            }
        }
        coroutineScope {
            launch {
                val result = withContext(Dispatchers.IO) { runCatching { extraction.search(q) } }
                coroutineContext.ensureActive()
                tracks = result.getOrNull()?.tracks.orEmpty()
                catalogError = result.exceptionOrNull()
                catalogDone = true
                finishIfReady()
            }
            launch {
                val result = withContext(Dispatchers.IO) { runCatching { extraction.lyricMatch(q) } }
                coroutineContext.ensureActive()
                matches = result.getOrNull()?.matches.orEmpty()
                lyricError = result.exceptionOrNull()
                lyricDone = true
                finishIfReady()
            }
            launch {
                val result = withContext(Dispatchers.IO) { runCatching { extraction.suggest(q) } }
                coroutineContext.ensureActive()
                suggestions = result.getOrNull()?.take(6).orEmpty()
            }
        }
    }

    val libState by library.state.collectAsState()
    val rows = remember(tracks, matches, query) { mergeHybrid(tracks, matches, query) }
    val artists = remember(tracks) {
        tracks.flatMap { it.artists }.distinctBy { it.channelId ?: it.name }.take(12)
    }
    val visibleRows = remember(rows, filter) {
        rows.filter {
            when (filter) {
                "songs" -> it is HybridRow.TrackRow
                "lyrics" -> it is HybridRow.LyricRow
                "artists" -> false
                else -> true
            }
        }
    }
    val showArtists = filter == "all" || filter == "artists"
    val counts = remember(rows, matches, artists) {
        mapOf(
            "all" to rows.size,
            "songs" to rows.count { it is HybridRow.TrackRow },
            "lyrics" to rows.count { it is HybridRow.LyricRow },
            "artists" to artists.size,
        )
    }

    // A previously selected filter can disappear when a new query has no
    // matches of that kind. Return to Everything instead of hiding valid rows.
    LaunchedEffect(filter, counts, loading) {
        if (!loading && filter != "all" && (counts[filter] ?: 0) == 0) filter = "all"
    }

    fun playTrack(track: Track) = engine.playNow(track, context = "search")

    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                placeholder = { Text("Songs, artists or a lyric line…", color = tokens.textFaint) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = tokens.textDim) },
                trailingIcon = {
                    if (query.isNotEmpty()) Icon(
                        Icons.Filled.Clear,
                        contentDescription = "Clear",
                        tint = tokens.textDim,
                        modifier = Modifier.clickable { onQueryChange("") },
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(999.dp),
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = tokens.accent,
                    unfocusedBorderColor = tokens.border,
                    focusedContainerColor = scheme.surface,
                    unfocusedContainerColor = scheme.surface,
                    focusedTextColor = scheme.onBackground,
                    unfocusedTextColor = scheme.onBackground,
                    cursorColor = tokens.accent,
                ),
            )
        }
        if (query.trim().length < 2) {
            item { EmptySearchPrompt() }
        } else {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    listOf("all" to "Everything", "songs" to "Songs", "lyrics" to "Lyrics", "artists" to "Artists")
                        .filter { (id, _) -> id == "all" || (counts[id] ?: 0) > 0 }
                        .forEach { (id, label) ->
                            val selected = filter == id
                            Row(
                                modifier = Modifier.clip(RoundedCornerShape(999.dp))
                                    .background(if (selected) tokens.accent else scheme.surface)
                                    .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(999.dp))
                                    .clickable { filter = id }
                                    .padding(horizontal = 14.dp, vertical = 7.dp),
                                horizontalArrangement = Arrangement.spacedBy(5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(label, color = if (selected) tokens.accentContrast else tokens.textDim,
                                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Text((counts[id] ?: 0).toString(),
                                    color = if (selected) tokens.accentContrast else tokens.textFaint, fontSize = 11.sp)
                            }
                        }
                    if (loading) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = tokens.accent)
                        Text("searching…", color = tokens.textFaint, fontSize = 12.sp)
                    }
                }
            }
            if (showArtists && artists.isNotEmpty()) {
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text("Artists", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                            color = scheme.onBackground, modifier = Modifier.padding(bottom = 10.dp))
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            artists.forEach { artist ->
                                val following = libState.follows.contains(artist.name)
                                Row(
                                    modifier = Modifier.clip(RoundedCornerShape(999.dp))
                                        .background(if (following) tokens.accent.copy(alpha = 0.15f) else scheme.surface)
                                        .border(1.dp, if (following) tokens.accent.copy(alpha = 0.6f) else tokens.border, RoundedCornerShape(999.dp))
                                        .clickable { scope.launch { library.toggleFollow(artist.name) } }
                                        .padding(horizontal = 12.dp, vertical = 7.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                                ) {
                                    Artwork(src = artist.image, label = artist.name, corner = 999.dp, modifier = Modifier.size(20.dp))
                                    Text(artist.name, color = if (following) tokens.accent else tokens.textDim,
                                        fontSize = 12.sp, maxLines = 1, modifier = Modifier.widthIn(max = 140.dp))
                                    if (following) Icon(Icons.Filled.Check, contentDescription = "Following",
                                        tint = tokens.accent, modifier = Modifier.size(13.dp))
                                }
                            }
                        }
                    }
                }
            }
            if (loading && visibleRows.isEmpty() && !(showArtists && artists.isNotEmpty())) {
                item { Text("Searching…", color = tokens.textDim, modifier = Modifier.padding(24.dp)) }
            }
            // Only visible rows are composed; long result sets no longer create
            // every artwork and every entrance animation at once.
            itemsIndexed(visibleRows) { _, row ->
                Box(Modifier.padding(horizontal = 16.dp, vertical = 3.dp)) {
                    when (row) {
                        is HybridRow.TrackRow -> {
                            val track = row.track.track
                            TrackRow(
                                track = track,
                                isCurrent = currentTrackId == track.id,
                                onClick = { playTrack(track) },
                                onDownload = onDownload,
                                onQueue = { engine.addToEnd(track) },
                            )
                        }
                        is HybridRow.LyricRow -> LyricRowCard(
                            match = row.match,
                            extraction = extraction,
                            onResolve = { playTrack(it) },
                            onQueue = { engine.addToEnd(it) },
                            onDownload = onDownload,
                        )
                    }
                }
            }
            if (!loading && visibleRows.isEmpty() && !(showArtists && artists.isNotEmpty()) && error == null) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp)
                            .clip(RoundedCornerShape(16.dp)).background(scheme.surface.copy(alpha = 0.5f))
                            .border(1.dp, tokens.border, RoundedCornerShape(16.dp)).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Outlined.MusicNote, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(30.dp))
                        Text("Nothing matched “$query”", style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium, color = tokens.textDim, modifier = Modifier.padding(top = 12.dp))
                        Text("Check spelling, or try fewer lyric words.", style = MaterialTheme.typography.bodySmall,
                            color = tokens.textFaint, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
            if (error != null) {
                item {
                    Text(error.orEmpty(), color = Color(0xFFFECACA), fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth().padding(16.dp).clip(RoundedCornerShape(12.dp))
                            .background(Color(0x33B91C1C)).border(1.dp, Color(0x66EF4444), RoundedCornerShape(12.dp))
                            .padding(14.dp))
                }
            }
            if (!loading && rows.isEmpty() && matches.isEmpty() && suggestions.isNotEmpty()) {
                items(suggestions) { suggestion ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(10.dp))
                            .clickable { onQueryChange(suggestion) }.padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Search, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(16.dp))
                        Text(suggestion, color = tokens.textDim, fontSize = 14.sp, modifier = Modifier.padding(start = 10.dp))
                    }
                }
            }
        }
    }
}

/** Web `SearchRows.LyricMatchRow` — quote snippet + meta + resolve-play. */
@Composable
private fun LyricRowCard(
    match: LyricMatchRow,
    extraction: ExtractionService,
    onResolve: (Track) -> Unit,
    onQueue: (Track) -> Unit,
    onDownload: (Track) -> Unit,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var resolving by remember(match) { mutableStateOf(false) }
    var resolveError by remember(match) { mutableStateOf<String?>(null) }
    fun resolve(onResult: (Track) -> Unit) {
        if (resolving) return
        resolving = true
        resolveError = null
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                runCatching { extraction.search("${match.trackName} ${match.artistName}".trim(), limit = 5) }
            }
            val track = outcome.getOrNull()?.tracks?.firstOrNull()
            if (track != null) onResult(track)
            else resolveError = "Could not find a playable match. Try searching for the song."
            resolving = false
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(tokens.surface2.copy(alpha = 0.5f))
            .clickable(enabled = !resolving) { resolve(onResolve) }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.FormatQuote,
            contentDescription = null,
            tint = tokens.accent,
            modifier = Modifier.size(18.dp),
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(
                text = "“${match.snippet ?: match.trackName}”",
                style = MaterialTheme.typography.bodyMedium,
                fontStyle = FontStyle.Italic,
                color = scheme.onBackground,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 4.dp),
            ) {
                Text(
                    text = "${match.trackName} — ${match.artistName}",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.textDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(tokens.accent.copy(alpha = 0.16f))
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = "${(match.similarity * 100).roundToInt()}%",
                        color = tokens.accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            if (resolveError != null) {
                Text(resolveError.orEmpty(), color = scheme.error, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(top = 4.dp))
            }
        }
        androidx.compose.material3.IconButton(onClick = { resolve(onQueue) }, enabled = !resolving, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Filled.PlaylistAdd, contentDescription = "Add lyric match to queue", tint = tokens.textDim)
        }
        androidx.compose.material3.IconButton(onClick = { resolve(onDownload) }, enabled = !resolving, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Outlined.Download, contentDescription = "Download lyric match", tint = tokens.textDim)
        }
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(tokens.accent),
            contentAlignment = Alignment.Center,
        ) {
            if (resolving) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = tokens.accentContrast)
            } else {
                Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Play lyric match",
                    tint = tokens.accentContrast,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

/** Web SearchPage empty-query card with example chips. */
@Composable
private fun EmptySearchPrompt() {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 24.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, tokens.border, RoundedCornerShape(16.dp))
            .padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(34.dp))
            Text(
                text = "Search anything",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = scheme.onBackground,
                modifier = Modifier.padding(top = 14.dp),
            )
            Text(
                text = "Type a song, an artist — or a lyric line you half-remember. " +
                    "The dual-mode engine queries the catalog and the lyric index in " +
                    "parallel and merges the hits.",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textDim,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(
                modifier = Modifier.padding(top = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("“blinding lights”", "“city hums in ultraviolet”").forEach { hint ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .border(1.dp, tokens.border, RoundedCornerShape(999.dp))
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(hint, color = tokens.textFaint, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
