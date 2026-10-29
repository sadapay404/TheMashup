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
import androidx.compose.ui.graphics.Path
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
) {
    if (!enabled) return
    val accents = LocalArtAccents.current
    val context = LocalContext.current // hoisted: CompositionLocal reads need @Composable scope
    val reduceMotion = remember(context) { animationsReduced(context) }
    val frame = remember { mutableStateOf<Pair<ByteArray?, Float>?>(null) }

    // Single rAF-equivalent loop: sample FFT + advance the idle phase on
    // every display frame (web idlePhase += 0.03 per 60fps frame).
    LaunchedEffect(enabled) {
        var lastNanos = 0L
        while (isActive) {
            withFrameNanos { now ->
                val dtMs = if (lastNanos == 0L) 16.7f else ((now - lastNanos) / 1_000_000f)
                lastNanos = now
                val prev = frame.value?.second ?: 0f
                val step = 0.03f * (dtMs / 16.667f).coerceIn(0.25f, 4f)
                frame.value = fft() to (prev + step)
            }
        }
    }

    Canvas(modifier = modifier.fillMaxSize()) {
        val (fftBytes, phase) = frame.value ?: (null to 0f)
        val accent = accents.first
        val accent2 = accents.second
        val width = size.width
        val height = size.height
        for (i in 0 until bars) {
            val raw = VisualizerBars.levelFromFft(fftBytes, i, bars)
                ?: VisualizerBars.idleLevel(phase, i)
            val level = VisualizerBars.applyReducedMotion(raw, reduceMotion)
            val rect = VisualizerBars.barRect(index = i, bars = bars, width = width, height = height, level = level)
            if (rect.w <= 0f || rect.h <= 0f) continue
            val gradient = Brush.verticalGradient(
                colors = listOf(accent, accent2),
                startY = rect.y,
                endY = height,
            )
            val path = Path().apply {
                val r = rect.r
                moveTo(rect.x, rect.y + rect.h)
                lineTo(rect.x, rect.y + r)
                quadraticBezierTo(rect.x, rect.y, rect.x + r, rect.y)
                lineTo(rect.x + rect.w - r, rect.y)
                quadraticBezierTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r)
                lineTo(rect.x + rect.w, rect.y + rect.h)
                close()
            }
            drawPath(path, brush = gradient, alpha = VisualizerBars.barAlpha(level))
        }
    }
}

/** OS "remove animations" accessibility flag (web prefers-reduced-motion). */
private fun animationsReduced(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    ) == 0f
}.getOrDefault(false)
