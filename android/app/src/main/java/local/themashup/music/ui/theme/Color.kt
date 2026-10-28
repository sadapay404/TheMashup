package local.themashup.music.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/** Re-export so `ui.theme.ThemeId` keeps working (same enum, pure package). */
typealias ThemeId = local.themashup.music.ui.logic.ThemeId

/**
 * Extra semantic tokens beyond Material3's scheme — direct ports of the CSS
 * custom properties (`--bg-soft`, `--surface-2`, `--border`, `--accent-2`)
 * that cards/shelves/switcher need to visually match the web.
 */
data class MashupTokens(
    val bg: Color,
    val bgSoft: Color,
    val surface2: Color,
    val border: Color,
    val accent: Color,
    val accent2: Color,
    val accentContrast: Color,
    val textDim: Color,
    val textFaint: Color,
    /** Web `--art-opacity` (blurred artwork background strength). */
    val artOpacity: Float,
)

private fun hex(value: Long): Color = Color(value.toInt())
private fun alpha(color: Long, alpha: Int): Color = Color(((alpha shl 24) or (color and 0xFFFFFF)).toInt())

private data class WebTheme(
    val bg: Long,
    val bgSoft: Long,
    val surface: Long,
    val surface2: Long,
    val surfaceSolid: Long,
    val text: Long,
    val dim: Long,
    val faint: Long,
    val accent: Long,
    val accent2: Long,
    val contrast: Long,
    val border: Long,
    val artOpacity: Float,
)

/** `[data-theme=…]` sheets from `apps/web/src/styles/index.css`, exact. */
private val WEB_THEMES: Map<ThemeId, WebTheme> = mapOf(
    ThemeId.FROSTED to WebTheme(
        bg = 0xFF0A0A0F, bgSoft = 0xFF101018,
        surface = 0x0BFFFFFF, surface2 = 0x14FFFFFF, surfaceSolid = 0xFF15151F,
        text = 0xFFF4F4F8, dim = 0xFFA3A3B5, faint = 0xFF6B6B80,
        accent = 0xFF8B6CFF, accent2 = 0xFF4DD0FF, contrast = 0xFF0B0B12,
        border = 0x17FFFFFF, artOpacity = 0.32f,
    ),
    ThemeId.PAPER_INK to WebTheme(
        bg = 0xFFF4EFE4, bgSoft = 0xFFECE5D6,
        surface = 0xC7FFFDF7, surface2 = 0xF3FFFDF7, surfaceSolid = 0xFFFFFDF7,
        text = 0xFF211C14, dim = 0xFF6C6353, faint = 0xFF9A907C,
        accent = 0xFFB3441F, accent2 = 0xFF2F5D50, contrast = 0xFFFFFDF7,
        border = 0x24211C14, artOpacity = 0.14f,
    ),
    ThemeId.NEON to WebTheme(
        bg = 0xFF04060B, bgSoft = 0xFF080C14,
        surface = 0x0D00FFC8, surface2 = 0x1A00FFC8, surfaceSolid = 0xFF070B12,
        text = 0xFFE8FEFF, dim = 0xFF7FC9C4, faint = 0xFF46787A,
        accent = 0xFF00FFC8, accent2 = 0xFFFF3EC8, contrast = 0xFF02120E,
        border = 0x3800FFC8, artOpacity = 0.30f,
    ),
    ThemeId.AURORA to WebTheme(
        bg = 0xFF0A1022, bgSoft = 0xFF0E1730,
        surface = 0x1292B2FF, surface2 = 0x2192B2FF, surfaceSolid = 0xFF101A36,
        text = 0xFFEEF2FF, dim = 0xFF9FB0D8, faint = 0xFF62739C,
        accent = 0xFF6EE7FF, accent2 = 0xFFB490FF, contrast = 0xFF06121A,
        border = 0x2E92B2FF, artOpacity = 0.34f,
    ),
    ThemeId.VINYL to WebTheme(
        bg = 0xFF16110D, bgSoft = 0xFF1D1712,
        surface = 0x0EF3E9DC, surface2 = 0x1AF3E9DC, surfaceSolid = 0xFF221A14,
        text = 0xFFF3E9DC, dim = 0xFFBFAE99, faint = 0xFF7D6F5F,
        accent = 0xFFE8A33D, accent2 = 0xFFA03B3B, contrast = 0xFF1A1109,
        border = 0x21F3E9DC, artOpacity = 0.26f,
    ),
)

fun tokensFor(id: ThemeId): MashupTokens {
    val t = WEB_THEMES.getValue(id)
    return MashupTokens(
        bg = hex(t.bg),
        bgSoft = hex(t.bgSoft),
        surface2 = hex(t.surface2),
        border = hex(t.border),
        accent = hex(t.accent),
        accent2 = hex(t.accent2),
        accentContrast = hex(t.contrast),
        textDim = hex(t.dim),
        textFaint = hex(t.faint),
        artOpacity = t.artOpacity,
    )
}

private fun darkFrom(t: WebTheme): ColorScheme = darkColorScheme(
    primary = hex(t.accent),
    onPrimary = hex(t.contrast),
    primaryContainer = alpha(t.accent, 0x33),
    onPrimaryContainer = hex(t.accent),
    secondary = hex(t.accent2),
    onSecondary = hex(t.contrast),
    secondaryContainer = alpha(t.accent2, 0x2E),
    onSecondaryContainer = hex(t.accent2),
    background = hex(t.bg),
    onBackground = hex(t.text),
    surface = hex(t.surfaceSolid),
    onSurface = hex(t.text),
    surfaceVariant = hex(t.bgSoft),
    onSurfaceVariant = hex(t.dim),
    surfaceTint = hex(t.accent),
    outline = hex(t.faint),
    outlineVariant = hex(t.border),
    error = Color(0xFFF87171),
)

private fun lightFrom(t: WebTheme): ColorScheme = lightColorScheme(
    primary = hex(t.accent),
    onPrimary = hex(t.contrast),
    primaryContainer = alpha(t.accent, 0x1F),
    onPrimaryContainer = hex(t.accent),
    secondary = hex(t.accent2),
    onSecondary = hex(t.contrast),
    secondaryContainer = alpha(t.accent2, 0x1F),
    onSecondaryContainer = hex(t.accent2),
    background = hex(t.bg),
    onBackground = hex(t.text),
    surface = hex(t.surfaceSolid),
    onSurface = hex(t.text),
    surfaceVariant = hex(t.bgSoft),
    onSurfaceVariant = hex(t.dim),
    surfaceTint = hex(t.accent),
    outline = hex(t.faint),
    outlineVariant = hex(t.border),
    error = hex(t.accent),
)

fun colorSchemeFor(id: ThemeId): ColorScheme {
    val t = WEB_THEMES.getValue(id)
    return if (id.isLight) lightFrom(t) else darkFrom(t)
}
