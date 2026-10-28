package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class FuzzyTest {

    @Test
    fun normalizeStripsCasePunctuationAndDiacritics() {
        Assert.assertEquals("blinding lights", normalize("Blinding Lights!"))
        Assert.assertEquals("beyonce s deja vu", normalize("Beyoncé's  Déjà Vu"))
        Assert.assertEquals("spaced out", normalize("  spaced   out  "))
    }

    @Test
    fun similarityIsOrderInsensitiveAndBounded() {
        Assert.assertEquals(1.0, similarity("blinding lights", "lights blinding"), 1e-9)
        // "lights" vs "light" are distinct tokens → Dice = 0.5, above noise
        Assert.assertTrue(similarity("blinding lights", "blinding light") > 0.4)
        Assert.assertTrue(similarity("blinding lights", "blinding light") < 1.0)
        Assert.assertTrue(similarity("blinding lights", "bohemian rhapsody") < 0.2)
        Assert.assertEquals(0.0, similarity("anything", ""), 1e-9)
    }

    @Test
    fun exactBoostRewardsEqualityAndContainment() {
        Assert.assertEquals(1.0, exactBoost("Hello", "hello"), 1e-9)
        Assert.assertEquals(0.6, exactBoost("Hello", "Hello World"), 1e-9)
        Assert.assertEquals(0.0, exactBoost("Hello", "Goodbye"), 1e-9)
    }

    @Test
    fun matchScoreRanksTrueMatchesAboveUnrelatedText() {
        val good = matchScore("never gonna give you up", "Never Gonna Give You Up - Rick Astley")
        val bad = matchScore("never gonna give you up", "Blinding Lights - The Weeknd")
        Assert.assertTrue("expected good > 0.6, got $good", good > 0.6)
        Assert.assertTrue("expected bad << good ($bad vs $good)", bad < good - 0.3)
    }
}
