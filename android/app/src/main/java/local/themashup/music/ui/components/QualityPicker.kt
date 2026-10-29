package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.formatBytes
import local.themashup.music.core.domain.formatDuration
import local.themashup.music.core.download.logic.availableVideoHeights
import local.themashup.music.core.download.logic.heightTarget
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.ui.theme.LocalMashupTokens

private data class Chip(
    val container: String,
    val quality: String,
    val label: String,
    val sub: String,
)

// Verbatim from the web QualityPicker.
private val AUDIO_CHIPS = listOf(
    Chip("mp3", "128k", "MP3 128k", "small, plays everywhere"),
    Chip("mp3", "320k", "MP3 320k", "best MP3 quality"),
    Chip("flac", "best", "FLAC", "lossless archive"),
    Chip("opus", "best", "Opus", "source quality, tiny"),
)

private val VIDEO_CHIPS = listOf(
    Chip("mp4", "360p", "360p", "smallest video"),
    Chip("mp4", "720p", "720p", "HD"),
    Chip("mp4", "1080p", "1080p", "Full HD"),
    Chip("mp4", "4k", "4K", "Ultra HD"),
)

/**
 * Web `QualityPicker` dialog — artwork/title header, formats manifest load
 * (stream candidates stand in for `/formats`), 2×2 audio/video chip grids
 * with the "not available" / "≈size" rules, then start the job.
 */
@Composable
fun QualityPicker(
    track: Track,
    extraction: ExtractionService,
    onDismiss: () -> Unit,
    onStart: (track: Track, quality: String, container: String) -> Unit,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme

    var loading by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var videoCandidates by remember { mutableStateOf<List<StreamCandidate>>(emptyList()) }
    var busyKey by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(track.id) {
        loading = true
        loaded = false
        error = null
        videoCandidates = emptyList()
        try {
            val outcome = withContext(Dispatchers.IO) { extraction.streams(track.externalId) }
            videoCandidates = outcome.candidates
            loaded = true
        } catch (_: Exception) {
            error = "Could not load format list — showing all targets"
        } finally {
            loading = false
        }
    }

    val heights = remember(videoCandidates) { availableVideoHeights(videoCandidates) }
    val maxHeight = heights.maxOrNull()
    val loadedVideo = loaded && error == null
    val noVideo = loadedVideo && heights.isEmpty()

    fun sizeFor(height: Int): String? {
        val bytes = videoCandidates
            .filter { c -> c.hasVideo && (c.height?.takeIf { h -> h > 0 } ?: -1) == height }
            .mapNotNull { it.sizeBytes }
            .filter { it > 0 }
            .maxOrNull()
        return bytes?.let { formatBytes(it) }
    }

    fun disabled(chip: Chip): Boolean {
        if (chip.container != "mp4") return false
        if (noVideo) return true
        if (loadedVideo && maxHeight != null) return heightTarget(chip.quality) > maxHeight
        return false
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = scheme.surface,
            tonalElevation = 0.dp,
            modifier = Modifier.widthIn(max = 460.dp),
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                // ── header: art + title + artist · duration + close ──
                Row(verticalAlignment = Alignment.Top) {
                    Artwork(
                        src = track.artworkBest ?: track.artwork,
                        label = track.title,
                        corner = 8.dp,
                        modifier = Modifier.size(40.dp),
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 12.dp),
                    ) {
                        Text(
                            text = track.title,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = scheme.onBackground,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = buildString {
                                append(track.artistNames)
                                if ((track.durationSec ?: 0) > 0) {
                                    append(" · ")
                                    append(formatDuration(track.durationSec))
                                }
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.textDim,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = tokens.textDim,
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(17.dp))
                            .clickable(onClick = onDismiss)
                            .padding(8.dp),
                    )
                }

                if (loading) {
                    Row(
                        modifier = Modifier.padding(top = 26.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 1.5.dp,
                            color = tokens.textDim,
                        )
                        Text(
                            text = "Loading available formats…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.textDim,
                        )
                    }
                    return@Column
                }

                Column(modifier = Modifier.padding(top = 20.dp)) {
                    // ── Audio section ──
                    SectionLabel(icon = { Icon(Icons.Outlined.MusicNote, null, Modifier.size(13.dp), tint = tokens.textDim) }) {
                        Text(
                            "Audio",
                            color = tokens.textDim,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 1.2.sp,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    ChipGrid(chips = AUDIO_CHIPS, disabled = { false }, sizeLabel = { null }, busyKey = busyKey,
                        tokens = tokens) { chip ->
                        busyKey = "${chip.container}:${chip.quality}"
                        onStart(track, chip.quality, chip.container)
                    }

                    Spacer(Modifier.height(20.dp))

                    // ── Video section ──
                    SectionLabel(icon = { Icon(Icons.Outlined.Videocam, null, Modifier.size(13.dp), tint = tokens.textDim) }) {
                        Text(
                            "Video (MP4)",
                            color = tokens.textDim,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 1.2.sp,
                        )
                        when {
                            maxHeight != null -> Text(
                                " · up to ${maxHeight}p for this track",
                                color = tokens.textFaint,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Normal,
                            )
                            noVideo -> Text(
                                " · no video formats",
                                color = tokens.textFaint,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Normal,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    ChipGrid(
                        chips = VIDEO_CHIPS,
                        disabled = ::disabled,
                        sizeLabel = { chip ->
                            if (chip.container == "mp4") {
                                sizeFor(heightTarget(chip.quality))?.let { "≈$it" }
                            } else null
                        },
                        busyKey = busyKey,
                        tokens = tokens,
                    ) { chip ->
                        busyKey = "${chip.container}:${chip.quality}"
                        onStart(track, chip.quality, chip.container)
                    }

                    error?.let { msg ->
                        Spacer(Modifier.height(14.dp))
                        Text(msg, style = MaterialTheme.typography.bodySmall, color = scheme.error)
                    }

                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = "Files are prepared by the local resolver and show up under " +
                            "Downloads the moment they're ready.",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.textFaint,
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(icon: @Composable () -> Unit, content: @Composable () -> Unit) {
    val tokens = LocalMashupTokens.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        icon()
        content()
    }
}

@Composable
private fun ChipGrid(
    chips: List<Chip>,
    disabled: (Chip) -> Boolean,
    sizeLabel: (Chip) -> String?,
    busyKey: String?,
    tokens: local.themashup.music.ui.theme.MashupTokens,
    onPick: (Chip) -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { chip ->
                    val off = disabled(chip)
                    val isBusy = busyKey == "${chip.container}:${chip.quality}"
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(62.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(tokens.surface2)
                            .border(
                                width = 1.dp,
                                color = if (off) tokens.border else tokens.border,
                                shape = RoundedCornerShape(8.dp),
                            )
                            .clickable(enabled = !off) { onPick(chip) }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Column {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = chip.label,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (off) tokens.textFaint else scheme.onBackground,
                                    modifier = Modifier.weight(1f, fill = false),
                                )
                                val size = if (off) null else sizeLabel(chip)
                                if (size != null) {
                                    Text(
                                        text = size,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = tokens.textDim,
                                    )
                                }
                                if (isBusy) {
                                    Spacer(Modifier.width(6.dp))
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(13.dp),
                                        strokeWidth = 1.5.dp,
                                        color = tokens.accent,
                                    )
                                }
                            }
                            Text(
                                text = if (off) "not available" else chip.sub,
                                style = MaterialTheme.typography.labelSmall,
                                color = tokens.textDim,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}
