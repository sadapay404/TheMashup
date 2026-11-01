package com.themashup.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.themashup.app.*

@Composable
fun LogoMark(size: Dp = 36.dp, withName: Boolean = true) {
    val p = LocalPalette.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(p.accentBrush),
            contentAlignment = Alignment.Center,
        ) { Text("m.", color = p.accentText, fontWeight = FontWeight.Black, fontSize = (size.value * 0.55f).sp) }
        if (withName) {
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    append("The")
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = p.accent))
                    append("Mashup")
                    pop()
                },
                color = p.text, fontWeight = FontWeight.Bold, fontSize = 19.sp,
            )
        }
    }
}

@Composable
fun Artwork(url: String?, size: Dp? = null, modifier: Modifier = Modifier, radius: Dp = 10.dp) {
    val p = LocalPalette.current
    val m = (if (size != null) modifier.size(size) else modifier).clip(RoundedCornerShape(radius))
    if (url.isNullOrEmpty()) {
        Box(m.background(Brush.linearGradient(listOf(p.raised, p.surface))), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.MusicNote, null, tint = p.subtle)
        }
    } else {
        AsyncImage(model = url, contentDescription = null, modifier = m.background(p.raised), contentScale = ContentScale.Crop)
    }
}

@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier.clip(shape).background(p.surface.copy(alpha = 0.78f)).border(1.dp, p.outline, shape),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, color = LocalPalette.current.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = modifier.padding(top = 22.dp, bottom = 10.dp))
}

@Composable
fun ScreenTitle(text: String) {
    Text(text, color = LocalPalette.current.text, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 12.dp))
}

@Composable
fun MChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.clip(CircleShape)
            .background(if (selected) p.accent else p.surface)
            .border(1.dp, if (selected) p.accent else p.outline, CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
    ) { Text(label, color = if (selected) p.accentText else p.muted, fontSize = 14.sp, fontWeight = FontWeight.Medium) }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, hint: String? = null) {
    val p = LocalPalette.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp).border(1.dp, p.outline, RoundedCornerShape(20.dp)).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = p.subtle, modifier = Modifier.size(36.dp))
        Spacer(Modifier.height(10.dp))
        Text(title, color = p.text, fontWeight = FontWeight.SemiBold)
        if (hint != null) Text(hint, color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
fun PrimaryButton(label: String, icon: ImageVector? = null, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Button(
        onClick = onClick, enabled = enabled, shape = CircleShape,
        colors = ButtonDefaults.buttonColors(containerColor = p.accent, contentColor = p.accentText, disabledContainerColor = p.raised, disabledContentColor = p.subtle),
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun OutlineButton(label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    OutlinedButton(onClick = onClick, shape = CircleShape, border = BorderStroke(1.dp, p.outline), colors = ButtonDefaults.outlinedButtonColors(contentColor = p.text)) {
        Text(label, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

/** Text field that stays readable on every theme (explicit text, cursor and placeholder colors). */
@Composable
fun MashupTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    leading: ImageVector? = null,
    onSearch: (() -> Unit)? = null,
    singleLine: Boolean = true,
) {
    val p = LocalPalette.current
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier.clip(shape).background(p.surface).border(1.dp, p.outline, shape).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { Icon(leading, null, tint = p.muted); Spacer(Modifier.width(10.dp)) }
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = p.subtle, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(
                value = value, onValueChange = onValueChange, singleLine = singleLine,
                textStyle = TextStyle(color = p.text, fontSize = 16.sp),
                cursorBrush = SolidColor(p.accent),
                keyboardOptions = KeyboardOptions(imeAction = if (onSearch != null) ImeAction.Search else ImeAction.Done),
                keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }, onDone = { onSearch?.invoke() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Icon(Icons.Filled.Close, "Clear", tint = p.muted, modifier = Modifier.size(20.dp).clickable { onValueChange("") })
        }
    }
}

@Composable
fun mSliderColors(): SliderColors {
    val p = LocalPalette.current
    return SliderDefaults.colors(thumbColor = p.accent, activeTrackColor = p.accent, inactiveTrackColor = p.outline)
}

fun fmtTime(ms: Long): String {
    if (ms <= 0) return "0:00"
    val s = ms / 1000
    return "%d:%02d".format(s / 60, s % 60)
}

fun fmtBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${n / 1024} KB"
    else -> "%.1f MB".format(n / 1024.0 / 1024.0)
}

@Composable
fun TrackRow(
    ui: UiState,
    track: Track,
    list: List<Track>,
    index: Int,
    showLyric: Boolean = false,
    removeLabel: String? = null,
    onRemove: (() -> Unit)? = null,
) {
    val p = LocalPalette.current
    val queue by Graph.player.queue.collectAsState()
    val idx by Graph.player.index.collectAsState()
    val lib by Graph.library.data.collectAsState()
    val isCur = queue.getOrNull(idx)?.id == track.id
    val liked = lib.liked.any { it.id == track.id }
    val offline = lib.downloads.any { it.track.id == track.id }
    var menu by remember { mutableStateOf(false) }
    var dlMenu by remember { mutableStateOf(false) }

    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(if (isCur) p.raised.copy(alpha = 0.6f) else Color.Transparent)
            .clickable { Graph.player.playQueue(list, index) }.padding(horizontal = 6.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(track.artwork, 48.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(track.title, color = if (isCur) p.accent else p.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(track.artist, track.album).joinToString(" · "), color = p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (showLyric && track.lyricLine != null) {
                Text("“${track.lyricLine}”", color = p.accent2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
            }
        }
        if (offline) Icon(Icons.Filled.Download, "Offline", tint = p.accent, modifier = Modifier.size(16.dp))
        IconButton(onClick = { Graph.library.toggleLike(track) }) {
            Icon(if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "Like", tint = if (liked) p.accent else p.muted, modifier = Modifier.size(20.dp))
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More", tint = p.muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false; dlMenu = false }, containerColor = p.raised) {
                if (!dlMenu) {
                    @Composable fun item(label: String, icon: ImageVector, action: () -> Unit) = DropdownMenuItem(
                        text = { Text(label, color = p.text) },
                        leadingIcon = { Icon(icon, null, tint = p.muted) },
                        onClick = { menu = false; action() },
                    )
                    item("Play next", Icons.Filled.PlayArrow) { Graph.player.playNext(track); ui.toast = "Playing next" }
                    item("Add to queue", Icons.AutoMirrored.Filled.QueueMusic) { Graph.player.addToQueue(track); ui.toast = "Added to queue" }
                    item("Add to playlist", Icons.Filled.Add) { ui.playlistTarget = track }
                    DropdownMenuItem(
                        text = { Text("Download…", color = p.text) },
                        leadingIcon = { Icon(Icons.Filled.Download, null, tint = p.muted) },
                        onClick = { dlMenu = true },
                    )
                    if (onRemove != null) item(removeLabel ?: "Remove", Icons.Filled.Delete) { onRemove() }
                } else {
                    Qualities.forEach { (q, label) ->
                        DropdownMenuItem(
                            text = { Text(label, color = p.text) },
                            leadingIcon = { Icon(Icons.Filled.Download, null, tint = p.muted) },
                            onClick = { menu = false; dlMenu = false; Graph.downloads.start(track, q); ui.toast = "Download queued" },
                        )
                    }
                }
            }
        }
    }
}
