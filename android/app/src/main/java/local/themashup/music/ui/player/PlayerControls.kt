package local.themashup.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import local.themashup.music.core.player.PlayStatus
import local.themashup.music.core.domain.RepeatMode
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Shared transport — web `PlayerControls`: shuffle · prev · big play · next ·
 * repeat, accent + underline dot when active; busy (LOADING) shows a spinner.
 */
@Composable
fun PlayerControls(
    state: PlayerSnapshot,
    onShuffle: () -> Unit,
    onPrev: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onRepeat: () -> Unit,
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val disabled = state.current == null
    val busy = state.status == PlayStatus.LOADING
    val playing = state.status == PlayStatus.PLAYING
    val iconSize = if (large) 26.dp else 22.dp
    val playSize = if (large) 64.dp else 44.dp

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(if (large) 18.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SideToggle(
            onClick = onShuffle,
            enabled = !disabled,
            active = state.shuffle,
            modifier = Modifier.size(if (large) 46.dp else 38.dp),
        ) {
            Icon(
                Icons.Filled.Shuffle,
                contentDescription = if (state.shuffle) "Shuffle on" else "Shuffle",
                tint = if (state.shuffle) tokens.accent else scheme.onBackground,
                modifier = Modifier.size(iconSize),
            )
        }
        TransportCircle(
            onClick = onPrev,
            enabled = !disabled,
            size = if (large) 50.dp else 42.dp,
        ) {
            Icon(
                Icons.Filled.SkipPrevious,
                contentDescription = "Previous",
                tint = scheme.onBackground,
                modifier = Modifier.size(if (large) 30.dp else 26.dp),
            )
        }
        Box(
            modifier = Modifier
                .size(playSize)
                .clip(CircleShape)
                .background(tokens.accent)
                .graphicsLayer { if (disabled) alpha = 0.4f }
                .clickable(enabled = !disabled, onClick = onToggle),
            contentAlignment = Alignment.Center,
        ) {
            when {
                busy -> CircularProgressIndicator(
                    modifier = Modifier.size(if (large) 28.dp else 22.dp),
                    color = tokens.accentContrast,
                    strokeWidth = 2.5.dp,
                )
                playing -> Icon(
                    Icons.Filled.Pause,
                    contentDescription = "Pause",
                    tint = tokens.accentContrast,
                    modifier = Modifier.size(if (large) 30.dp else 24.dp),
                )
                else -> Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Play",
                    tint = tokens.accentContrast,
                    modifier = Modifier.size(if (large) 30.dp else 24.dp),
                )
            }
        }
        TransportCircle(
            onClick = onNext,
            enabled = !disabled,
            size = if (large) 50.dp else 42.dp,
        ) {
            Icon(
                Icons.Filled.SkipNext,
                contentDescription = "Next",
                tint = scheme.onBackground,
                modifier = Modifier.size(if (large) 30.dp else 26.dp),
            )
        }
        val repeatActive = state.repeat != RepeatMode.OFF
        SideToggle(
            onClick = onRepeat,
            enabled = !disabled,
            active = repeatActive,
            modifier = Modifier.size(if (large) 46.dp else 38.dp),
        ) {
            Icon(
                imageVector = if (state.repeat == RepeatMode.ONE) {
                    Icons.Filled.RepeatOne
                } else {
                    Icons.Filled.Repeat
                },
                contentDescription = "Repeat: ${state.repeat}",
                tint = if (repeatActive) tokens.accent else scheme.onBackground,
                modifier = Modifier.size(iconSize),
            )
        }
    }
}

@Composable
private fun TransportCircle(
    onClick: () -> Unit,
    enabled: Boolean,
    size: Dp,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** Icon toggle with the web's accent underline dot when active. */
@Composable
private fun SideToggle(
    onClick: () -> Unit,
    enabled: Boolean,
    active: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier.graphicsLayer { if (!enabled) alpha = 0.4f },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(enabled = enabled) { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            content()
            if (active) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .size(width = 4.dp, height = 4.dp)
                        .clip(CircleShape)
                        .background(LocalMashupTokens.current.accent),
                )
            }
        }
    }
}
