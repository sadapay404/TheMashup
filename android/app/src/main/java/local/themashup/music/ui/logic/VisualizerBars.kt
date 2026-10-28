package local.themashup.music.ui.logic

import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Bar math for the playback visualizer — port of `apps/web/src/components/
 * player/Visualizer.tsx` (spread analyser bins, idle sine, web geometry).
 * Pure px math so the sandbox can assert exact web parity; the Compose
 * canvas + `android.media.audiofx.Visualizer` live around it.
 */
object VisualizerBars {

    /** Expanded-player strip bar count (web `<Visualizer bars={44} />`). */
    const val EXPANDED_BARS = 44

    /** Gap between bars, px (web `gap = 3`). */
    const val GAP_PX = 3f

    /**
     * Normalization for FFT pair magnitudes → 0..1. Raw bytes are signed and
     * unbounded-ish; 110 ≈ full-scale pop levels sit near 1.0 without
     * clipping quiet music into noise.
     */
    const val FFT_NORM = 110f

    /** Web: `v = 0.12 + 0.08 * sin(idlePhase + i * 0.45)`. */
    fun idleLevel(phase: Float, index: Int): Float =
        0.12f + 0.08f * sin(phase + index * 0.45f)

    /** Web: `idx = Math.floor((i / bars) * data.length)` clamped in range. */
    fun spreadIndex(index: Int, bars: Int, length: Int): Int {
        if (bars <= 0 || length <= 0) return 0
        val raw = (index.toFloat() / bars.toFloat() * length.toFloat()).toInt()
        return raw.coerceIn(0, length - 1)
    }

    /**
     * Magnitude of FFT bin [bin] from `Visualizer.getFft()` layout:
     * `[0] = DC, [1] = Nyquist, then real/imag pairs at [2k]/[2k+1]`.
     * bin 0 → the DC value itself; bin k ≥ 1 → hypot(real, imag).
     * Returns 0..~181 (127·√2).
     */
    fun fftMagnitude(fft: ByteArray, bin: Int): Float {
        if (bin <= 0) return if (fft.isEmpty()) 0f else kotlin.math.abs(fft[0].toFloat())
        val re = 2 * bin
        if (re >= fft.size) return 0f
        val im = re + 1
        val real = fft[re].toFloat()
        val imag = if (im < fft.size) fft[im].toFloat() else 0f
        return sqrt(real * real + imag * imag)
    }

    /**
     * Level for bar [index] from live FFT data — null data → null (caller
     * falls back to [idleLevel], web's no-analyser path).
     */
    fun levelFromFft(fft: ByteArray?, index: Int, bars: Int): Float? {
        if (fft == null || fft.size < 4) return null
        // Skip the DC entry (fft[0]) — WebAudio's data[0] is the lowest
        // frequency band, so bar spread runs across bins 1..N/2-1.
        val bins = fft.size / 2 - 1
        val bin = spreadIndex(index, bars, bins) + 1
        val v = fftMagnitude(fft, bin) / FFT_NORM
        return v.coerceIn(0f, 1f)
    }

    /** Web reduced-motion clamp: `v = Math.max(v, 0.18)`. */
    fun applyReducedMotion(level: Float, reduceMotion: Boolean): Float =
        if (reduceMotion) level.coerceAtLeast(0.18f) else level

    /**
     * Geometry of one bar (web draw loop): `barW = max(2, (w - gap*(bars-1))
     * / bars)`, `barH = max(3, v*h*0.95)`, `x = i*(barW+gap)`, `y = h-barH`,
     * corner `r = min(barW/2, 3)` (top corners only).
     */
    data class BarRect(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float)

    fun barRect(index: Int, bars: Int, width: Float, height: Float, level: Float): BarRect {
        val gap = GAP_PX
        val barW = maxOf(2f, (width - gap * (bars - 1)) / bars)
        val barH = maxOf(3f, level * height * 0.95f)
        val x = index * (barW + gap)
        val y = height - barH
        return BarRect(x = x, y = y, w = barW, h = barH, r = min(barW / 2f, 3f))
    }

    /** Web alpha: `0.4 + v * 0.6`. */
    fun barAlpha(level: Float): Float = (0.4f + level * 0.6f).coerceIn(0f, 1f)
}
