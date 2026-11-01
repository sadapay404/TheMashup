package com.themashup.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

data class Palette(
    val id: String,
    val name: String,
    val tagline: String,
    val dark: Boolean,
    val bg: Color,
    val surface: Color,
    val raised: Color,
    val text: Color,
    val muted: Color,
    val subtle: Color,
    val accent: Color,
    val accent2: Color,
    val accentText: Color,
    val outline: Color,
) {
    val accentBrush: Brush get() = Brush.linearGradient(listOf(accent, accent2))
    val backdrop: Brush get() = Brush.verticalGradient(listOf(accent.copy(alpha = 0.16f), bg), endY = 900f)
}

private fun c(hex: Long) = Color(0xFF000000 or hex)

val Palettes = listOf(
    Palette("frosted", "Frosted Glass", "Dark · Glass", true,
        c(0x0A0A0F), c(0x15151F), c(0x1D1D2A), c(0xF4F4F8), c(0xA8A8BC), c(0x74748A), c(0x9B80FF), c(0x6C9BFF), c(0x0B0B12), c(0x2C2C3B)),
    Palette("paper", "Paper & Ink", "Light · Typographic", false,
        c(0xF6F1E7), c(0xECE5D6), c(0xFBF8F1), c(0x1E1A16), c(0x5E554A), c(0x8C8274), c(0xB3441F), c(0x7A5C3E), c(0xFFF8F0), c(0xD5CAB4)),
    Palette("neon", "Neon Cyber", "Dark · Electric", true,
        c(0x070B12), c(0x1B4742), c(0x245A54), c(0xE8FFF9), c(0x8FC9BE), c(0x5E9188), c(0x00DDB0), c(0xFF3EC8), c(0x04100D), c(0x2E6A62)),
    Palette("aurora", "Aurora", "Dark · Atmospheric", true,
        c(0x101A36), c(0x2B3E68), c(0x36508A), c(0xEAF2FF), c(0xA9BCE0), c(0x7C90B8), c(0x6EE7FF), c(0xB490FF), c(0x06121F), c(0x44598A)),
    Palette("vinyl", "Vinyl", "Warm · Retro", true,
        c(0x221A14), c(0x48392C), c(0x574536), c(0xF7EBDD), c(0xC9B49C), c(0x99856F), c(0xE8A33D), c(0xBD5959), c(0x1E1408), c(0x62503E)),
)

fun paletteFor(id: String): Palette = Palettes.firstOrNull { it.id == id } ?: Palettes[0]

val LocalPalette = staticCompositionLocalOf { Palettes[0] }

@Composable
fun MashupTheme(themeId: String, content: @Composable () -> Unit) {
    val p = paletteFor(themeId)
    val scheme = if (p.dark) {
        darkColorScheme(
            primary = p.accent, onPrimary = p.accentText, secondary = p.accent2,
            background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
            surfaceVariant = p.raised, onSurfaceVariant = p.muted, outline = p.outline,
        )
    } else {
        lightColorScheme(
            primary = p.accent, onPrimary = p.accentText, secondary = p.accent2,
            background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
            surfaceVariant = p.raised, onSurfaceVariant = p.muted, outline = p.outline,
        )
    }
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

@Suppress("unused")
@Composable
private fun systemDark() = isSystemInDarkTheme()
