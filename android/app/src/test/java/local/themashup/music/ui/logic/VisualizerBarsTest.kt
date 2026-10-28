package local.themashup.music.ui.logic

import org.junit.Assert
import org.junit.Test

class VisualizerBarsTest {

    @Test
    fun idleSineMatchesWebFormula() {
        // web: 0.12 + 0.08 * Math.sin(idlePhase + i * 0.45)
        Assert.assertEquals(0.12, VisualizerBars.idleLevel(0f, 0).toDouble(), 0.0001)
        val expected = (0.12 + 0.08 * Math.sin(0.35 + 2 * 0.45)).toFloat()
        Assert.assertEquals(expected.toDouble(), VisualizerBars.idleLevel(0.35f, 2).toDouble(), 0.0001)
        Assert.assertTrue(VisualizerBars.idleLevel(1.1f, 5) in 0.04f..0.20f)
    }

    @Test
    fun spreadIndexFloorsAcrossBins() {
        // web: Math.floor((i / bars) * length)
        Assert.assertEquals(0, VisualizerBars.spreadIndex(0, 44, 64))
        Assert.assertEquals(32, VisualizerBars.spreadIndex(22, 44, 64)) // 0.5*64
        Assert.assertEquals(62, VisualizerBars.spreadIndex(43, 44, 64)) // floor(43/44*64)
        Assert.assertEquals(0, VisualizerBars.spreadIndex(0, 44, 0))
    }

    @Test
    fun fftMagnitudeUsesPairHypot() {
        // Layout: [0]=DC, [1]=Nyquist, pairs at 2k/2k+1.
        val fft = ByteArray(16)
        fft[0] = 9 // DC
        fft[2] = 3 // bin1 real
        fft[3] = 4 // bin1 imag
        Assert.assertEquals(9.0, VisualizerBars.fftMagnitude(fft, 0).toDouble(), 0.001)
        Assert.assertEquals(5.0, VisualizerBars.fftMagnitude(fft, 1).toDouble(), 0.001)
        Assert.assertEquals(0.0, VisualizerBars.fftMagnitude(fft, 99).toDouble(), 0.001)
        Assert.assertEquals(0.0, VisualizerBars.fftMagnitude(ByteArray(0), 1).toDouble(), 0.001)
    }

    @Test
    fun levelFromFftNormalizesAndReturnsNullForNoData() {
        Assert.assertNull(VisualizerBars.levelFromFft(null, 0, 44))
        Assert.assertNull(VisualizerBars.levelFromFft(ByteArray(2), 0, 44)) // too small
        val fft = ByteArray(128)
        fft[2] = 55 // bin1 real
        fft[3] = 0
        val v = VisualizerBars.levelFromFft(fft, 0, 44)!!
        Assert.assertEquals(55.0 / VisualizerBars.FFT_NORM, v.toDouble(), 0.001)
        // Full-scale-ish pair caps at 1.0.
        val loud = ByteArray(8)
        loud[2] = 127
        loud[3] = 127
        Assert.assertEquals(1.0, VisualizerBars.levelFromFft(loud, 0, 4)!!.toDouble(), 0.001)
    }

    @Test
    fun reducedMotionFloorIs018() {
        Assert.assertEquals(0.18, VisualizerBars.applyReducedMotion(0.05f, true).toDouble(), 0.0001)
        Assert.assertEquals(0.42, VisualizerBars.applyReducedMotion(0.42f, true).toDouble(), 0.0001)
        Assert.assertEquals(0.05, VisualizerBars.applyReducedMotion(0.05f, false).toDouble(), 0.0001)
    }

    @Test
    fun barGeometryMatchesWebDrawLoop() {
        // web: barW = max(2,(w - gap*(bars-1))/bars); h=100, bars=5, w=100
        val rect = VisualizerBars.barRect(index = 2, bars = 5, width = 100f, height = 100f, level = 0.5f)
        val gap = 3f
        val barW = (100f - gap * 4) / 5f // 17.6
        Assert.assertEquals(barW.toDouble(), rect.w.toDouble(), 0.001)
        Assert.assertEquals((2f * (barW + gap)).toDouble(), rect.x.toDouble(), 0.001)
        Assert.assertEquals((100f - 0.5f * 100f * 0.95f).toDouble(), rect.y.toDouble(), 0.001)
        Assert.assertEquals((0.5f * 100f * 0.95f).toDouble(), rect.h.toDouble(), 0.001)
        Assert.assertEquals(3.0, rect.r.toDouble(), 0.001) // min(barW/2, 3)
        // Tiny strip floors: min bar width 2, min height 3.
        val tiny = VisualizerBars.barRect(0, 40, width = 10f, height = 50f, level = 0f)
        Assert.assertEquals(2.0, tiny.w.toDouble(), 0.001)
        Assert.assertEquals(3.0, tiny.h.toDouble(), 0.001)
    }

    @Test
    fun alphaRampsWithLevel() {
        Assert.assertEquals(0.4, VisualizerBars.barAlpha(0f).toDouble(), 0.0001)
        Assert.assertEquals(1.0, VisualizerBars.barAlpha(1f).toDouble(), 0.0001)
        Assert.assertEquals(0.7, VisualizerBars.barAlpha(0.5f).toDouble(), 0.001)
    }
}
