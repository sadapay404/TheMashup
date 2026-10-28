package local.themashup.music.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import local.themashup.music.ui.logic.DEFAULT_THEME_ID

/**
 * Dynamic album-art accents — native port of the web `applyArtworkAccent`
 * (`--art-1` / `--art-2`). N5 samples the current artwork with Palette;
 * fallbacks = web `fallbackArtColors` accents.
 */
data class ArtAccents(val first: Color, val second: Color)

val LocalArtAccents = staticCompositionLocalOf {
    ArtAccents(first = Color(0xFF8B6CFF), second = Color(0xFF4DD0FF))
}

/** Per-theme extra tokens (translucent surfaces, borders, accent-2 …). */
val LocalMashupTokens = staticCompositionLocalOf { tokensFor(DEFAULT_THEME_ID) }

/**
 * App theme. **Material You dynamic color is deliberately OFF** — the five
 * user-chosen themes must never be overridden by the system palette.
 */
@Composable
fun TheMashupTheme(
    themeId: ThemeId = DEFAULT_THEME_ID,
    content: @Composable () -> Unit,
) {
    val serif = themeId.serif
    val base = mashupTypography(if (serif) FontFamily.Serif else FontFamily.SansSerif)
    CompositionLocalProvider(LocalMashupTokens provides tokensFor(themeId)) {
        MaterialTheme(
            colorScheme = colorSchemeFor(themeId),
            typography = base,
            content = content,
        )
    }
}

/** Convenience for previews. */
@Composable
fun PreviewTheme(content: @Composable () -> Unit) =
    TheMashupTheme(themeId = DEFAULT_THEME_ID, content = content)

/** Accent provider wrapper — ArtAccents sampled by the app shell (N5). */
@Composable
fun WithArtAccents(accents: ArtAccents, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalArtAccents provides accents, content = content)

@Suppress("unused")
private val darkModeHint: Boolean
    get() = isSystemInDarkTheme()
