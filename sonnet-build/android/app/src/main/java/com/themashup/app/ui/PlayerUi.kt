package com.themashup.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.themashup.app.*
import kotlinx.coroutines.launch

@Composable
private fun PlayPauseButton(size: Int, iconSize: Int) {
    val p = LocalPalette.current
    val state by Graph.player.state.collectAsState()
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(p.accent).clickable { Graph.player.toggle() },
        contentAlignment = Alignment.Center,
    ) {
        if (state == PState.LOADING) CircularProgressIndicator(Modifier.size((iconSize - 4).dp), color = p.accentText, strokeWidth = 2.5.dp)
        else Icon(if (state == PState.PLAYING) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (state == PState.PLAYING) "Pause" else "Play", tint = p.accentText, modifier = Modifier.size(iconSize.dp))
    }
}

@Composable
fun MiniPlayer(ui: UiState) {
    val p = LocalPalette.current
    val queue by Graph.player.queue.collectAsState()
    val idx by Graph.player.index.collectAsState()
    val state by Graph.player.state.collectAsState()
    val error by Graph.player.error.collectAsState()
    val pos by Graph.player.position.collectAsState()
    val dur by Graph.player.duration.collectAsState()
    val t = queue.getOrNull(idx) ?: return
    val shape = RoundedCornerShape(18.dp)
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        Column(Modifier.fillMaxWidth().clip(shape).background(p.raised.copy(alpha = 0.92f)).border(1.dp, p.outline, shape)) {
            LinearProgressIndicator(progress = { if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f }, Modifier.fillMaxWidth().height(2.dp), color = p.accent, trackColor = p.outline)
            Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clickable { ui.expanded = true }, verticalAlignment = Alignment.CenterVertically) {
                    Artwork(t.artwork, 44.dp)
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(t.title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            when { state == PState.ERROR && error != null -> error!!; state == PState.LOADING -> "Loading…"; else -> t.artist },
                            color = if (state == PState.ERROR) Color(0xFFFF7B7B) else p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                IconButton(onClick = { ui.queueOpen = true }) { Icon(Icons.AutoMirrored.Filled.QueueMusic, "Queue", tint = p.muted) }
                PlayPauseButton(42, 24)
                IconButton(onClick = { Graph.player.next() }) { Icon(Icons.Filled.SkipNext, "Next", tint = p.text) }
            }
        }
    }
}

@Composable
private fun SeekBar() {
    val p = LocalPalette.current
    val pos by Graph.player.position.collectAsState()
    val dur by Graph.player.duration.collectAsState()
    var drag by remember { mutableStateOf<Float?>(null) }
    val value = drag ?: pos.toFloat()
    Column {
        Slider(
            value = value.coerceIn(0f, dur.coerceAtLeast(1L).toFloat()),
            onValueChange = { drag = it },
            onValueChangeFinished = { drag?.let { Graph.player.seekTo(it.toLong()) }; drag = null },
            valueRange = 0f..dur.coerceAtLeast(1L).toFloat(),
            enabled = dur > 0, colors = mSliderColors(),
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(fmtTime(value.toLong()), color = p.muted, fontSize = 12.sp)
            Text(fmtTime(dur), color = p.muted, fontSize = 12.sp)
        }
    }
}

@Composable
fun Transport() {
    val p = LocalPalette.current
    val s by Graph.prefs.settings.collectAsState(initial = Settings())
    val scope = rememberCoroutineScope()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { scope.launch { Graph.prefs.setShuffle(!s.shuffle) } }) {
            Icon(Icons.Filled.Shuffle, "Shuffle", tint = if (s.shuffle) p.accent else p.muted)
        }
        IconButton(onClick = { Graph.player.prev() }, modifier = Modifier.size(52.dp)) { Icon(Icons.Filled.SkipPrevious, "Previous", tint = p.text, modifier = Modifier.size(34.dp)) }
        PlayPauseButton(68, 38)
        IconButton(onClick = { Graph.player.next() }, modifier = Modifier.size(52.dp)) { Icon(Icons.Filled.SkipNext, "Next", tint = p.text, modifier = Modifier.size(34.dp)) }
        IconButton(onClick = {
            scope.launch { Graph.prefs.setRepeat(when (s.repeat) { Repeat.OFF -> Repeat.ALL; Repeat.ALL -> Repeat.ONE; Repeat.ONE -> Repeat.OFF }) }
        }) {
            Icon(if (s.repeat == Repeat.ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat, "Repeat", tint = if (s.repeat != Repeat.OFF) p.accent else p.muted)
        }
    }
}

@Composable
private fun LyricsPanel(track: Track, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val pos by Graph.player.position.collectAsState()
    var lyrics by remember(track.id) { mutableStateOf<Lyrics?>(null) }
    LaunchedEffect(track.id) { lyrics = Sources.lyrics(track) }
    val l = lyrics
    Box(modifier.clip(RoundedCornerShape(22.dp)).background(p.surface.copy(alpha = 0.6f)).border(1.dp, p.outline, RoundedCornerShape(22.dp)).padding(12.dp)) {
        when {
            l == null -> Text("Looking for lyrics…", color = p.muted, modifier = Modifier.align(Alignment.Center))
            l.synced.isNotEmpty() -> {
                val cur = l.synced.indexOfLast { it.t * 1000 <= pos + 250 }
                val state = rememberLazyListState()
                LaunchedEffect(cur) { if (cur >= 0) state.animateScrollToItem((cur - 2).coerceAtLeast(0)) }
                LazyColumn(state = state, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    itemsIndexed(l.synced) { i, line ->
                        Text(
                            line.text.ifEmpty { "♪" }, textAlign = TextAlign.Center, fontWeight = FontWeight.Bold,
                            fontSize = if (i == cur) 22.sp else 18.sp,
                            color = when { i == cur -> p.accent; i < cur -> p.subtle; else -> p.muted },
                            modifier = Modifier.fillMaxWidth().clickable { Graph.player.seekTo((line.t * 1000).toLong()) },
                        )
                    }
                }
            }
            l.plain.isNotEmpty() -> Text(l.plain, color = p.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
            else -> Text("No lyrics found for this track.", color = p.muted, modifier = Modifier.align(Alignment.Center))
        }
    }
}

@Composable
fun ExpandedPlayer(ui: UiState) {
    val p = LocalPalette.current
    val queue by Graph.player.queue.collectAsState()
    val idx by Graph.player.index.collectAsState()
    val state by Graph.player.state.collectAsState()
    val error by Graph.player.error.collectAsState()
    val note by Graph.player.note.collectAsState()
    val lib by Graph.library.data.collectAsState()
    val s by Graph.prefs.settings.collectAsState(initial = Settings())
    val scope = rememberCoroutineScope()
    val t = queue.getOrNull(idx)
    var showLyrics by remember { mutableStateOf(false) }
    if (t == null) { ui.expanded = false; return }
    val liked = lib.liked.any { it.id == t.id }

    Column(Modifier.fillMaxSize().background(p.bg).background(p.backdrop).statusBarsPadding().navigationBarsPadding().padding(horizontal = 22.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = { ui.expanded = false }) { Icon(Icons.Filled.KeyboardArrowDown, "Collapse", tint = p.text, modifier = Modifier.size(32.dp)) }
            Row(Modifier.clip(CircleShape).background(p.surface).border(1.dp, p.outline, CircleShape).padding(3.dp)) {
                listOf("Now playing" to false, "Lyrics" to true).forEach { (label, v) ->
                    Box(Modifier.clip(CircleShape).background(if (showLyrics == v) p.accent else Color.Transparent).clickable { showLyrics = v }.padding(horizontal = 16.dp, vertical = 6.dp)) {
                        Text(label, color = if (showLyrics == v) p.accentText else p.muted, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                }
            }
            IconButton(onClick = { ui.queueOpen = true }) { Icon(Icons.AutoMirrored.Filled.QueueMusic, "Queue", tint = p.text) }
        }

        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (showLyrics) LyricsPanel(t, Modifier.fillMaxSize().padding(vertical = 8.dp))
            else Artwork(t.artwork, modifier = Modifier.fillMaxWidth().aspectRatio(1f).padding(8.dp), radius = 28.dp)
        }

        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(t.title, color = p.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(t.artist, t.album).joinToString(" · "), color = p.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = { ui.playlistTarget = t }) { Icon(Icons.Filled.Add, "Add to playlist", tint = p.muted) }
            IconButton(onClick = { Graph.library.toggleLike(t) }) { Icon(if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "Like", tint = if (liked) p.accent else p.muted) }
        }
        val msg = if (state == PState.ERROR) error else note
        if (msg != null) Text(msg, color = if (state == PState.ERROR) Color(0xFFFF9B9B) else p.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        SeekBar()
        Transport()
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.VolumeUp, null, tint = p.muted)
            Slider(s.volume, { v -> scope.launch { Graph.prefs.setVolume(v) } }, Modifier.weight(1f).padding(horizontal = 8.dp), colors = mSliderColors())
        }
    }
}

@Composable
fun QueueDrawer(ui: UiState) {
    val p = LocalPalette.current
    val queue by Graph.player.queue.collectAsState()
    val idx by Graph.player.index.collectAsState()
    var related by remember { mutableStateOf<List<Track>>(emptyList()) }
    val cur = queue.getOrNull(idx)
    LaunchedEffect(cur?.id) { related = cur?.let { runCatching { Sources.related(it) }.getOrDefault(emptyList()) } ?: emptyList() }

    Column(Modifier.fillMaxHeight().width(330.dp).background(p.surface).border(1.dp, p.outline).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Queue (${queue.size})", color = p.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (queue.isNotEmpty()) TextButton(onClick = { Graph.player.clearQueue() }) { Text("Clear", color = p.accent) }
            IconButton(onClick = { ui.queueOpen = false }) { Icon(Icons.Filled.Close, "Close", tint = p.muted) }
        }
        LazyColumn(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            if (queue.isEmpty()) item { Text("Your queue is empty.", color = p.muted, modifier = Modifier.padding(24.dp)) }
            itemsIndexed(queue) { i, t ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (i == idx) p.raised else Color.Transparent).clickable { Graph.player.jumpTo(i) }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Artwork(t.artwork, 40.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text((if (i == idx) "▶ " else "") + t.title, color = if (i == idx) p.accent else p.text, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.artist, color = p.muted, fontSize = 11.sp, maxLines = 1)
                    }
                    Column {
                        Icon(Icons.Filled.KeyboardArrowUp, "Move up", tint = if (i > 0) p.muted else p.outline, modifier = Modifier.size(22.dp).clickable(enabled = i > 0) { Graph.player.move(i, i - 1) })
                        Icon(Icons.Filled.KeyboardArrowDown, "Move down", tint = if (i < queue.size - 1) p.muted else p.outline, modifier = Modifier.size(22.dp).clickable(enabled = i < queue.size - 1) { Graph.player.move(i, i + 1) })
                    }
                    IconButton(onClick = { Graph.player.removeFromQueue(i) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Filled.Close, "Remove", tint = p.muted, modifier = Modifier.size(18.dp)) }
                }
            }
            if (related.isNotEmpty()) {
                item { Text("UP NEXT SUGGESTIONS", color = p.subtle, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp, top = 20.dp, bottom = 6.dp)) }
                itemsIndexed(related.take(8)) { _, t ->
                    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Artwork(t.artwork, 36.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(t.title, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(t.artist, color = p.muted, fontSize = 11.sp, maxLines = 1)
                        }
                        IconButton(onClick = { Graph.player.addToQueue(t); ui.toast = "Added to queue" }, modifier = Modifier.size(36.dp)) { Icon(Icons.Filled.Add, "Add", tint = p.muted, modifier = Modifier.size(18.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
fun PlaylistPicker(ui: UiState) {
    val p = LocalPalette.current
    val lib by Graph.library.data.collectAsState()
    val target = ui.playlistTarget ?: return
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { ui.playlistTarget = null },
        containerColor = p.surface,
        title = { Text("Add to playlist", color = p.text) },
        text = {
            Column {
                Text(target.title, color = p.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 8.dp))
                lib.playlists.forEach { pl ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable {
                            Graph.library.addToPlaylist(pl.id, target); ui.toast = "Added to ${pl.name}"; ui.playlistTarget = null
                        }.padding(12.dp),
                    ) {
                        Text(pl.name, color = p.text, modifier = Modifier.weight(1f))
                        Text("${pl.tracks.size}", color = p.muted)
                    }
                }
                if (lib.playlists.isEmpty()) Text("No playlists yet.", color = p.muted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                MashupTextField(name, { name = it }, "New playlist", Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (name.isNotBlank()) {
                    val id = Graph.library.createPlaylist(name)
                    Graph.library.addToPlaylist(id, target)
                    ui.toast = "Added to $name"
                    ui.playlistTarget = null
                }
            }) { Text("Create & add", color = p.accent) }
        },
        dismissButton = { TextButton(onClick = { ui.playlistTarget = null }) { Text("Close", color = p.muted) } },
    )
}
