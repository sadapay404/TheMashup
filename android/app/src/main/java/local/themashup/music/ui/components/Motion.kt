package local.themashup.music.ui.components

import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Motion helpers — framer-motion ports (N8):
 * - [pressClickable] ≈ `whileTap={{ scale }}` (web keeps ripple via the
 *   shared indication, so press feedback + touch feedback coexist)
 * - [FadeSlideIn] ≈ mount `initial={{ opacity: 0, y }}` entrance with the
 *   web's ease-out feel (CSS `easeOut` ≈ `LinearOutSlowInEasing`).
 */
fun Modifier.pressClickable(
    pressScale: Float = 0.96f,
    enabled: Boolean = true,
    onClick: () -> Unit,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) pressScale else 1f,
        animationSpec = tween(durationMillis = 110),
        label = "pressScale",
    )
    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .clickable(
            interactionSource = interaction,
            indication = LocalIndication.current,
            enabled = enabled,
            onClick = onClick,
        )
}

/**
 * One-shot entrance: fade + slide [offsetYDp] → rest over 350 ms after
 * [delayMillis] (web card stagger: `min(index * 40, 320)` ms).
 * `offsetYDp < 0` starts above (web hero `y: -8`).
 */
@Composable
fun FadeSlideIn(
    delayMillis: Int = 0,
    offsetYDp: Dp = 14.dp,
    content: @Composable () -> Unit,
) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val progress by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(
            durationMillis = 350,
            delayMillis = delayMillis,
            easing = LinearOutSlowInEasing,
        ),
        label = "entrance",
    )
    Box(
        modifier = Modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * offsetYDp.toPx()
        },
    ) {
        content()
    }
}
