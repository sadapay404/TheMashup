package local.themashup.music.core.player

import android.media.audiofx.Visualizer
import androidx.media3.exoplayer.ExoPlayer

/**
 * Binds `android.media.audiofx.Visualizer` to the playback audio session and
 * hands the latest FFT to the Compose bar strip (docs N8 — the native
 * AnalyserNode equivalent). Every refusal degrades to the web's no-analyser
 * path: no data → idle sine bars, never a crash (missing RECORD_AUDIO,
 * no session id yet, unsupported capture sizes).
 */
class OutputVisualizer {

    @Volatile
    private var fft: ByteArray? = null

    private var viz: Visualizer? = null
    @Volatile
    private var bound = false

    /** Hard failure (permission/unsupported) — stop polling this session. */
    private var unavailable = false

    enum class BindOutcome { BOUND, RETRY, UNAVAILABLE }

    private val listener = object : Visualizer.OnDataCaptureListener {
        override fun onWaveFormDataCapture(
            visualizer: Visualizer?,
            waveform: ByteArray?,
            samplingRate: Int,
        ) = Unit

        override fun onFftDataCapture(
            visualizer: Visualizer?,
            fftBytes: ByteArray?,
            samplingRate: Int,
        ) {
            // The capture buffer is reused — copy for the UI reader.
            if (fftBytes != null) fft = fftBytes.copyOf()
        }
    }

    /** Idempotent; RETRY while the audio session id is still unset (0). */
    @Synchronized
    fun tryBind(sessionId: Int): BindOutcome {
        if (bound) return BindOutcome.BOUND
        if (unavailable) return BindOutcome.UNAVAILABLE
        if (sessionId <= 0) return BindOutcome.RETRY
        return try {
            val fx = Visualizer(sessionId)
            val range = Visualizer.getCaptureSizeRange()
            fx.captureSize = 512.coerceIn(range[0], range[1])
            val rate = (Visualizer.getMaxCaptureRate() / 2).coerceAtLeast(1)
            fx.setDataCaptureListener(listener, rate, false, true)
            fx.enabled = true
            viz = fx
            bound = true
            BindOutcome.BOUND
        } catch (_: SecurityException) {
            // RECORD_AUDIO missing — web parity: idle sine, not an error.
            unavailable = true
            BindOutcome.UNAVAILABLE
        } catch (_: Exception) {
            // IllegalStateException / IllegalArgumentException / unsupported hw.
            unavailable = true
            BindOutcome.UNAVAILABLE
        }
    }

    /** Latest FFT bytes (Visualizer layout) — null → idle animation. */
    fun latestFft(): ByteArray? = if (bound) fft else null

    /**
     * Clear a permission hard-fail so the next poll may try again (called
     * after RECORD_AUDIO is granted from the expanded player).
     */
    @Synchronized
    fun allowRetry() {
        unavailable = false
    }

    @Synchronized
    fun release() {
        val fx = viz
        viz = null
        bound = false
        fft = null
        unavailable = false // a future session may bind again
        if (fx != null) {
            runCatching { fx.enabled = false }
            runCatching { fx.release() }
        }
    }

    companion object {
        /**
         * Session id via reflection so either media3 API shape compiles:
         * `Int` or `AudioSessionId` (`.getId()`); absent/0 → not ready.
         */
        fun audioSessionIdOf(player: ExoPlayer): Int = try {
            val method = player.javaClass.getMethod("getAudioSessionId")
            when (val value = method.invoke(player)) {
                is Int -> value
                null -> 0
                else -> try {
                    value.javaClass.getMethod("getId").invoke(value) as Int
                } catch (_: Exception) {
                    0
                }
            }
        } catch (_: Exception) {
            0
        }
    }
}
