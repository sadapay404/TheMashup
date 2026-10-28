package local.themashup.music.ui.logic

import org.junit.Assert
import org.junit.Test

/** Theme catalog — web THEME_IDS / DEFAULT_THEME / THEME_META parity. */
class ThemeCatalogTest {

    @Test
    fun orderMatchesWebThemeIds() {
        Assert.assertEquals(
            listOf("frosted", "paper-ink", "neon", "aurora", "vinyl"),
            THEME_CATALOG.map { it.storageKey },
        )
    }

    @Test
    fun defaultIsFrosted() {
        Assert.assertEquals("frosted", DEFAULT_THEME_ID.storageKey)
        Assert.assertEquals(ThemeId.FROSTED, DEFAULT_THEME_ID)
    }

    @Test
    fun themeFromKeyResolvesAllAndFallsBack() {
        THEME_CATALOG.forEach { t ->
            Assert.assertEquals(t, themeFromKey(t.storageKey))
        }
        Assert.assertEquals(ThemeId.FROSTED, themeFromKey("nope"))
        Assert.assertEquals(ThemeId.FROSTED, themeFromKey(null))
        Assert.assertEquals(ThemeId.FROSTED, themeFromKey(""))
        // Legacy value seen in old installs must not crash.
        Assert.assertEquals(ThemeId.FROSTED, themeFromKey("paper"))
    }

    @Test
    fun labelsAndHintsMatchWebThemeMeta() {
        Assert.assertEquals("Frosted Glass", ThemeId.FROSTED.label)
        Assert.assertEquals("dark · glass", ThemeId.FROSTED.hint)
        Assert.assertEquals("Paper & Ink", ThemeId.PAPER_INK.label)
        Assert.assertEquals("light · type", ThemeId.PAPER_INK.hint)
        Assert.assertEquals("Neon Cyber", ThemeId.NEON.label)
        Assert.assertEquals("dark · glow", ThemeId.NEON.hint)
        Assert.assertEquals("Aurora", ThemeId.AURORA.label)
        Assert.assertEquals("dark · mesh", ThemeId.AURORA.hint)
        Assert.assertEquals("Vinyl", ThemeId.VINYL.label)
        Assert.assertEquals("warm · retro", ThemeId.VINYL.hint)
    }

    @Test
    fun swatchTriplesMatchWeb() {
        Assert.assertEquals(
            listOf(0xFF0A0A0FL, 0xFF8B6CFFL, 0xFF4DD0FFL),
            ThemeId.FROSTED.swatch,
        )
        Assert.assertEquals(
            listOf(0xFFF4EFE4L, 0xFFB3441FL, 0xFF211C14L),
            ThemeId.PAPER_INK.swatch,
        )
        Assert.assertEquals(
            listOf(0xFF04060BL, 0xFF00FFC8L, 0xFFFF3EC8L),
            ThemeId.NEON.swatch,
        )
        Assert.assertEquals(
            listOf(0xFF0A1022L, 0xFF6EE7FFL, 0xFFB490FFL),
            ThemeId.AURORA.swatch,
        )
        Assert.assertEquals(
            listOf(0xFF16110DL, 0xFFE8A33DL, 0xFFA03B3BL),
            ThemeId.VINYL.swatch,
        )
    }

    @Test
    fun lightAndSerifFlags() {
        Assert.assertTrue(ThemeId.PAPER_INK.isLight)
        Assert.assertFalse(ThemeId.FROSTED.isLight)
        Assert.assertTrue(ThemeId.VINYL.isLight.not())
        // Paper & Ink + Vinyl use the serif display face (web --font-display).
        Assert.assertTrue(ThemeId.PAPER_INK.serif)
        Assert.assertTrue(ThemeId.VINYL.serif)
        Assert.assertFalse(ThemeId.FROSTED.serif)
        Assert.assertFalse(ThemeId.NEON.serif)
        Assert.assertFalse(ThemeId.AURORA.serif)
    }
}
