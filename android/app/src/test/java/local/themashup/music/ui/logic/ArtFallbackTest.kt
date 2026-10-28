package local.themashup.music.ui.logic

import org.junit.Assert
import org.junit.Test

/** Web Artwork.tsx / colors.ts fallback math, verified as literal ARGB. */
class ArtFallbackTest {

    @Test
    fun hueMatchesRollingHash() {
        Assert.assertEquals(285, artHue("themashup"))
        Assert.assertEquals(288, artHue("Blinding Lights"))
        Assert.assertEquals(234, artHue("abc"))
        Assert.assertEquals(0, artHue(""))
        // Deterministic + bounded.
        Assert.assertEquals(artHue("aurora"), artHue("aurora"))
        Assert.assertTrue(artHue("whatever") in 0..359)
    }

    @Test
    fun initialsTakeFirstTwoWords() {
        Assert.assertEquals("BL", artInitials("Blinding Lights"))
        Assert.assertEquals("TW", artInitials("the weeknd"))
        Assert.assertEquals("M", artInitials("Madonna"))
        Assert.assertEquals("", artInitials(""))
        Assert.assertEquals("", artInitials("   "))
        Assert.assertEquals("AB", artInitials("a b c"))
    }

    @Test
    fun hslConversionMatchesCss() {
        Assert.assertEquals(0xFFFF0000L, hslToArgb(0, 1.0, 0.5))
        Assert.assertEquals(0xFF00FF00L, hslToArgb(120, 1.0, 0.5))
        Assert.assertEquals(0xFF0000FFL, hslToArgb(240, 1.0, 0.5))
        Assert.assertEquals(0xFF7F7F7FL, hslToArgb(0, 0.0, 0.5))
        Assert.assertEquals(0xFF000000L, hslToArgb(0, 1.0, 0.0))
        Assert.assertEquals(0xFFFFFFFFL, hslToArgb(0, 1.0, 1.0))
        // Negative/wrapped hues wrap like CSS.
        Assert.assertEquals(0xFFFF0000L, hslToArgb(-360, 1.0, 0.5))
        Assert.assertEquals(0xFFFF0000L, hslToArgb(720, 1.0, 0.5))
    }

    @Test
    fun artworkGradientMatchesWebFormula() {
        val (a, b) = artGradient("themashup")
        Assert.assertEquals(0xFFAC35D4L, a)
        Assert.assertEquals(0xFF9C245AL, b)
    }

    @Test
    fun accentFallbackMatchesWebFormula() {
        val (a, b) = artAccentFallback("themashup")
        Assert.assertEquals(0xFFBA46E1L, a)
        Assert.assertEquals(0xFFC52562L, b)
        val (c, d) = artAccentFallback("Blinding Lights")
        Assert.assertEquals(0xFFC246E1L, c)
    }
}
