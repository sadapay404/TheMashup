package local.themashup.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.themashup.music.core.domain.formatDuration
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Seekable progress — web `ProgressBar`: times on both sides, accent fill on
 * `surface-2` track, thumb visible while dragging (preview) with commit on
 * release (web scrubs with preview + commit).
 */
@Composable
fun SeekBar(
    positionMs: Long,
    durationMs: Long,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val tokens = LocalMashupTokens.current
    var preview by remember { mutableStateOf<Long?>(null) }
    val value = preview ?: positionMs
    val durationSec = durationMs / 1000
    val valueSec = value / 1000
    val text = if (compact) 10.sp else 11.sp

    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = formatDuration(valueSec.toInt()),
            color = tokens.textFaint,
            fontSize = text,
            modifier = Modifier.padding(end = 8.dp),
        )
        Slider(
            value = if (durationMs > 0) (value.toFloat() / durationMs).coerceIn(0f, 1f) else 0f,
            onValueChange = { frac -> preview = (frac * durationMs).toLong() },
            onValueChangeFinished = {
                preview?.let(onSeek)
                preview = null
            },
            modifier = Modifier
                .weight(1f)
                .height(24.dp),
            colors = SliderDefaults.colors(
                thumbColor = tokens.accent,
                activeTrackColor = tokens.accent,
                inactiveTrackColor = tokens.surface2,
            ),
            thumb = {
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(tokens.accent),
                )
            },
        )
        Text(
            text = formatDuration(durationSec.toInt()),
            color = tokens.textFaint,
            fontSize = text,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

/** Thin fixed progress line (mini player) — no interaction. */
@Composable
fun MiniProgress(positionMs: Long, durationMs: Long, modifier: Modifier = Modifier) {
    val tokens = LocalMashupTokens.current
    val fraction = if (durationMs > 0) {
        (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
    } else {
        0f
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(2.dp)
            .background(tokens.border),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(fraction)
                .height(2.dp)
                .background(tokens.accent),
        )
    }
}
