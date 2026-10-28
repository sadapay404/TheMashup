package local.themashup.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Quote
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
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun SearchScreen(
    query: String,
    onQueryChange: (String) -> Unit,
    extraction: ExtractionService,
    engine: PlaybackEngine,
    library: LibraryRepository,
    playerState: PlayerSnapshot,
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

    // Debounced parallel fan-out — web useHybridSearch (170ms, allSettled,
    // error only when BOTH catalog and lyric sources fail).
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) {
            loading = false
            tracks = emptyList()
            matches = emptyList()
            suggestions = emptyList()
            error = null
            return@LaunchedEffect
        }
        delay(170)
        loading = true
        error = null
        val (searchRes, lyricRes, suggestRes) = withContext(Dispatchers.IO) {
            coroutineScope {
                val searchJob = async { runCatching { extraction.search(q) } }
                val lyricJob = async { runCatching { extraction.lyricMatch(q) } }
                val suggestJob = async { runCatching { extraction.suggest(q) } }
                Triple(searchJob.await(), lyricJob.await(), suggestJob.await())
            }
        }
        // Structured concurrency cancels superseded queries; also guard the
        // window between await and apply.
        coroutineContext.ensureActive()
        val foundTracks = searchRes.getOrNull()?.tracks ?: emptyList()
        val foundMatches = lyricRes.getOrNull()?.matches ?: emptyList()
        val foundSuggestions = suggestRes.getOrNull()?.take(6) ?: emptyList()
        error = if (searchRes.isFailure && lyricRes.isFailure) {
            (searchRes.exceptionOrNull() ?: lyricRes.exceptionOrNull())?.message ?: "Search failed"
        } else {
            null
        }
        tracks = foundTracks
        matches = foundMatches
        suggestions = foundSuggestions
        loading = false
    }

    val libState by library.state.collectAsState()
    val rows = remember(tracks, matches, query) { mergeHybrid(tracks, matches, query) }
    val artists = remember(tracks) {
        tracks.flatMap { it.artists }
            .distinctBy { it.channelId ?: it.name }
            .take(12)
    }
    val visibleRows = rows.filter {
        when (filter) {
            "songs" -> it is HybridRow.TrackRow
            "lyrics" -> it is HybridRow.LyricRow
            else -> true
        }
    }
    val showArtists = filter == "all" || filter == "artists"

    fun playTrack(track: Track, queue: List<Track>, context: String = "search") {
        val index = queue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        engine.playQueue(queue, startIndex = index, context = context)
        scope.launch { library.recordPlay(track, context = context) }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        // ── input ────────────────────────────────────────────────────────
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            placeholder = {
                Text("Songs, artists or a lyric line…", color = tokens.textFaint)
            },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = tokens.textDim) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    Icon(
                        Icons.Filled.Clear,
                        contentDescription = "Clear",
                        tint = tokens.textDim,
                        modifier = Modifier.clickable { onQueryChange("") },
                    )
                }
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

        if (query.trim().length < 2) {
            EmptySearchPrompt()
            return@Column
        }

        // ── filter chips ─────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val counts = mapOf(
                "all" to rows.size,
                "songs" to rows.count { it is HybridRow.TrackRow },
                "lyrics" to matches.size,
                "artists" to artists.size,
            )
            listOf("all" to "Everything", "songs" to "Songs", "lyrics" to "Lyrics", "artists" to "Artists")
                .filter { (id, _) -> id == "all" || (counts[id] ?: 0) > 0 }
                .forEach { (id, label) ->
                    val selected = filter == id
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (selected) tokens.accent else scheme.surface)
                            .border(
                                width = 1.dp,
                                color = if (selected) tokens.accent else tokens.border,
                                shape = RoundedCornerShape(999.dp),
                            )
                            .clickable { filter = id }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = label,
                            color = if (selected) tokens.accentContrast else tokens.textDim,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = (counts[id] ?: 0).toString(),
                            color = if (selected) tokens.accentContrast else tokens.textFaint,
                            fontSize = 11.sp,
                        )
                    }
                }
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = tokens.accent,
                )
                Text("searching…", color = tokens.textFaint, fontSize = 12.sp)
            }
        }

        // ── artists ──────────────────────────────────────────────────────
        if (showArtists && artists.isNotEmpty()) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = "Artists",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = scheme.onBackground,
                    modifier = Modifier.padding(bottom = 10.dp),
                )
                androidx.compose.foundation.layout.FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    artists.forEach { artist ->
                        // Web ArtistChip: tap = follow (accent when following).
                        val following = libState.follows.contains(artist.name)
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(
                                    if (following) tokens.accent.copy(alpha = 0.15f) else scheme.surface,
                                )
                                .border(
                                    1.dp,
                                    if (following) tokens.accent.copy(alpha = 0.6f) else tokens.border,
                                    RoundedCornerShape(999.dp),
                                )
                                .clickable {
                                    scope.launch { library.toggleFollow(artist.name) }
                                }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            Artwork(
                                src = artist.image,
                                label = artist.name,
                                corner = 999.dp,
                                modifier = Modifier.size(20.dp),
                            )
                            Text(
                                text = artist.name,
                                color = if (following) tokens.accent else tokens.textDim,
                                fontSize = 12.sp,
                                maxLines = 1,
                                modifier = Modifier.widthIn(max = 140.dp),
                            )
                            if (following) {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = "Following",
                                    tint = tokens.accent,
                                    modifier = Modifier.size(13.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        // ── results ──────────────────────────────────────────────────────
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            if (loading && visibleRows.isEmpty() && !(showArtists && artists.isNotEmpty())) {
                repeat(6) { i ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(tokens.surface2),
                        )
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Box(
                                Modifier
                                    .fillMaxWidth((58 + ((i * 7) % 30)) / 100f)
                                    .height(12.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(tokens.surface2),
                            )
                            Box(
                                Modifier
                                    .padding(top = 6.dp)
                                    .fillMaxWidth(0.33f)
                                    .height(10.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(tokens.surface2),
                            )
                        }
                        Box(
                            Modifier
                                .width(40.dp)
                                .height(10.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(tokens.surface2),
                        )
                    }
                }
            }

            visibleRows.forEachIndexed { rowIndex, row ->
                // Web result stagger: min(rowIndex * 30, 300) ms, y 8 → 0.
                val delay = minOf(rowIndex * 30, 300)
                when (row) {
                    is HybridRow.TrackRow -> {
                        val track = row.track.track
                        FadeSlideIn(delayMillis = delay, offsetYDp = 8.dp) {
                            TrackRow(
                                track = track,
                                isCurrent = playerState.current?.id == track.id,
                                onClick = { playTrack(track, tracks) },
                                modifier = Modifier.padding(vertical = 3.dp),
                                onDownload = onDownload,
                            )
                        }
                    }
                    is HybridRow.LyricRow -> {
                        FadeSlideIn(delayMillis = delay, offsetYDp = 8.dp) {
                            LyricRowCard(
                                match = row.match,
                                extraction = extraction,
                                onResolve = { resolved, queue -> playTrack(resolved, queue) },
                            )
                        }
                    }
                }
            }

            if (!loading && visibleRows.isEmpty() && !(showArtists && artists.isNotEmpty()) && error == null) {
                FadeSlideIn {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 24.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(scheme.surface.copy(alpha = 0.5f))
                            .border(1.dp, tokens.border, RoundedCornerShape(16.dp))
                            .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.MusicNote, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(30.dp))
                        Text(
                            text = "Nothing matched “$query”",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = tokens.textDim,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                        Text(
                            text = "Check spelling, or try fewer lyric words.",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.textFaint,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    }
                }
            }

            if (error != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0x33B91C1C))
                        .border(1.dp, Color(0x66EF4444), RoundedCornerShape(12.dp))
                        .padding(14.dp),
                ) {
                    Text(error.orEmpty(), color = Color(0xFFFECACA), fontSize = 13.sp)
                }
            }

            // Typeahead suggestions (web SearchBar: chips when no rows yet).
            if (!loading && rows.isEmpty() && matches.isEmpty() && suggestions.isNotEmpty()) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    suggestions.forEach { s ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onQueryChange(s) }
                                .padding(horizontal = 8.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Search, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(16.dp))
                            Text(
                                text = s,
                                color = tokens.textDim,
                                fontSize = 14.sp,
                                modifier = Modifier.padding(start = 10.dp),
                            )
                        }
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
    onResolve: (Track, List<Track>) -> Unit,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(tokens.surface2.copy(alpha = 0.5f))
            .clickable {
                // Web: resolve "title artist" → play the top hit.
                scope.launch {
                    val outcome = withContext(Dispatchers.IO) {
                        runCatching {
                            extraction.search(
                                "${match.trackName} ${match.artistName}".trim(),
                                limit = 5,
                            )
                        }
                    }
                    val top = outcome.getOrNull()?.tracks?.firstOrNull() ?: return@launch
                    val queue = outcome.getOrNull()?.tracks ?: listOf(top)
                    onResolve(top, queue)
                }
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Quote,
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
        }
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(tokens.accent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = "Play lyric match",
                tint = tokens.accentContrast,
                modifier = Modifier.size(20.dp),
            )
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
