package local.themashup.music.ui.components

import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.isActive
import androidx.compose.runtime.withFrameNanos
import local.themashup.music.ui.logic.VisualizerBars
import local.themashup.music.ui.theme.LocalArtAccents

/**
 * Expanded-player frequency strip — web `Visualizer.tsx` port driven by
 * `android.media.audiofx.Visualizer` FFT (N8). No data (permission denied,
 * session not ready) → the web idle sine; `visualizer_on=false` → not
 * composed at all (web returns null).
 */
@Composable
fun PlayerVisualizer(
    fft: () -> ByteArray?,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    bars: Int = VisualizerBars.EXPANDED_BARS,
    /** Beat envelope 0..1 (sharp spectral jump over an EMA baseline) — drives the player's reactive glow. */
    onPulse: (Float) -> Unit = {},
) {
    if (!enabled) return
    val accents = LocalArtAccents.current
    val context = LocalContext.current // hoisted: CompositionLocal reads need @Composable scope
    val reduceMotion = remember(context) { animationsReduced(context) }
    val frame = remember { mutableStateOf<Pair<ByteArray?, Float>?>(null) }
    // N9 beat envelope: bars breathe with it, the player background glows with it.
    val pulse = remember { mutableStateOf(0f) }

    // Single rAF-equivalent loop: sample FFT + advance the idle phase on
    // every display frame (web idlePhase += 0.03 per 60fps frame).
    LaunchedEffect(enabled, reduceMotion) {
        if (reduceMotion) {
            frame.value = null to 0f
            pulse.value = 0f
            onPulse(0f)
            return@LaunchedEffect
        }
        var lastNanos = 0L
        var ema = 0f
        var env = 0f
        while (isActive) {
            // A 30 fps visualizer is sufficient and halves redraw pressure.
            kotlinx.coroutines.delay(33)
            withFrameNanos { now ->
                val dtMs = if (lastNanos == 0L) 16.7f else ((now - lastNanos) / 1_000_000f)
                lastNanos = now
                val prev = frame.value?.second ?: 0f
                val step = 0.03f * (dtMs / 16.667f).coerceIn(0.25f, 4f)
                val bytes = fft()
                frame.value = bytes to (prev + step)
                // Mean spectral level vs its EMA → onset envelope (idle sine is
                // smooth, so it never spikes; real drum hits do).
                val phase = prev + step
                var sum = 0f
                var n = 0
                for (i in 0 until bars) {
                    val lv = VisualizerBars.levelFromFft(bytes, i, bars)
                        ?: VisualizerBars.idleLevel(phase, i)
                    sum += lv
                    n++
                }
                val avg = if (n > 0) sum / n else 0f
                env = if (!reduceMotion && bytes != null && avg > 0.16f && avg - ema > 0.055f) 1f else env * 0.86f
                ema = ema * 0.82f + avg * 0.18f
                pulse.value = env
                onPulse(env)
            }
        }
    }

    Canvas(modifier = modifier.fillMaxSize()) {
        val (fftBytes, phase) = frame.value ?: (null to 0f)
        val accent = accents.first
        val accent2 = accents.second
        val width = size.width
        val height = size.height
        val gradient = Brush.verticalGradient(colors = listOf(accent, accent2), startY = 0f, endY = height)
        for (i in 0 until bars) {
            val raw = VisualizerBars.levelFromFft(fftBytes, i, bars)
                ?: VisualizerBars.idleLevel(phase, i)
            val level = VisualizerBars.applyReducedMotion(raw, reduceMotion)
                .let { it * (1f + 0.32f * pulse.value) }.coerceAtMost(1f)
            val rect = VisualizerBars.barRect(index = i, bars = bars, width = width, height = height, level = level)
            if (rect.w <= 0f || rect.h <= 0f) continue
            drawRoundRect(
                brush = gradient,
                topLeft = Offset(rect.x, rect.y),
                size = Size(rect.w, rect.h),
                cornerRadius = CornerRadius(rect.r, rect.r),
                alpha = VisualizerBars.barAlpha(level),
            )
        }
    }
}

/** OS "remove animations" accessibility flag (web prefers-reduced-motion). */
internal fun animationsReduced(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    ) == 0f
}.getOrDefault(false)
