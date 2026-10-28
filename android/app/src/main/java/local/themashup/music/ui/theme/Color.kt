package local.themashup.music.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * The five persistent themes — seeds ported from
 * `apps/web/src/styles/index.css` (`[data-theme=…]` blocks). Phase N5 refines
 * every token to pixel-match the web sheets; the structure is final now.
 */
enum class ThemeId(val storageKey: String, val label: String) {
    FROSTED("frosted", "Frosted"),
    PAPER_INK("paper-ink", "Paper & Ink"),
    NEON("neon", "Neon"),
    AURORA("aurora", "Aurora"),
    VINYL("vinyl", "Vinyl"),
}

/** Shared brand red — accent used across themes (matches web `--accent`). */
val MashupAccent = Color(0xFFE11D48)

private fun dark(
    background: Color,
    surface: Color,
    surfaceVariant: Color,
    onBackground: Color,
    outline: Color,
    accent: Color = MashupAccent,
): ColorScheme = darkColorScheme(
    primary = accent,
    onPrimary = Color.White,
    secondary = surfaceVariant,
    onSecondary = onBackground,
    background = background,
    onBackground = onBackground,
    surface = surface,
    onSurface = onBackground,
    surfaceVariant = surfaceVariant,
    onSurfaceVariant = outline,
    outline = outline,
    error = Color(0xFFF87171),
)

/** Frosted — dark glass over near-black (web default `#0a0a0f`). */
val FrostedScheme = dark(
    background = Color(0xFF0A0A0F),
    surface = Color(0xFF101018),
    surfaceVariant = Color(0xFF171722),
    onBackground = Color(0xFFEDEDF2),
    outline = Color(0xFF8A8A99),
)

/** Neon — hot dark with electric accents. */
val NeonScheme = dark(
    background = Color(0xFF05050A),
    surface = Color(0xFF0B0B14),
    surfaceVariant = Color(0xFF12121F),
    onBackground = Color(0xFFF2F2FF),
    outline = Color(0xFF9B8CFF),
    accent = Color(0xFF22D3EE),
)

/** Aurora — deep space with teal/violet glow. */
val AuroraScheme = dark(
    background = Color(0xFF070B14),
    surface = Color(0xFF0D1322),
    surfaceVariant = Color(0xFF131B2E),
    onBackground = Color(0xFFE8EEF9),
    outline = Color(0xFF7DD3FC),
    accent = Color(0xFFA78BFA),
)

/** Vinyl — warm dark (record-sleeve browns over charcoal). */
val VinylScheme = dark(
    background = Color(0xFF0E0B09),
    surface = Color(0xFF161210),
    surfaceVariant = Color(0xFF1F1916),
    onBackground = Color(0xFFF4EDE6),
    outline = Color(0xFFB3A08F),
    accent = Color(0xFFE8A33D),
)

/** Paper & Ink — the light theme (web `#f4efe4` paper). */
val PaperInkScheme = lightColorScheme(
    primary = Color(0xFFB91C1C),
    onPrimary = Color.White,
    secondary = Color(0xFF3F3F46),
    onSecondary = Color.White,
    background = Color(0xFFF4EFE4),
    onBackground = Color(0xFF1C1917),
    surface = Color(0xFFFBF7EE),
    onSurface = Color(0xFF1C1917),
    surfaceVariant = Color(0xFFEAE3D5),
    onSurfaceVariant = Color(0xFF57534E),
    outline = Color(0xFF78716C),
    error = Color(0xFFB91C1C),
)

fun colorSchemeFor(id: ThemeId): ColorScheme = when (id) {
    ThemeId.FROSTED -> FrostedScheme
    ThemeId.PAPER_INK -> PaperInkScheme
    ThemeId.NEON -> NeonScheme
    ThemeId.AURORA -> AuroraScheme
    ThemeId.VINYL -> VinylScheme
}
