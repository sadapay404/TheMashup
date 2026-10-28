package local.themashup.music.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Dynamic album-art accents — native port of the web `applyArtworkAccent`
 * (`--art-1` / `--art-2`). Phase N5 computes these with Palette; Phase N1
 * ships the plumbing so components can already read them.
 */
data class ArtAccents(val first: Color, val second: Color)

val LocalArtAccents = staticCompositionLocalOf {
    ArtAccents(first = MashupAccent, second = Color(0xFF8B5CF6))
}

/**
 * App theme. **Material You dynamic color is deliberately OFF** — the five
 * user-chosen themes must never be overridden by the system palette.
 */
@Composable
fun TheMashupTheme(
    themeId: ThemeId = ThemeId.FROSTED,
    content: @Composable () -> Unit,
) {
    // isSystemInDarkTheme() intentionally unused for scheme choice; kept for
    // Paper & Ink which is explicitly light while others are dark.
    MaterialTheme(
        colorScheme = colorSchemeFor(themeId),
        typography = MashupTypography,
        content = content,
    )
}

/** Convenience for previews. */
@Composable
fun PreviewTheme(content: @Composable () -> Unit) =
    TheMashupTheme(themeId = ThemeId.FROSTED, content = content)

/** Accent provider wrapper (used once artwork sampling lands in N5). */
@Composable
fun WithArtAccents(accents: ArtAccents, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalArtAccents provides accents, content = content)

@Suppress("unused")
private val darkModeHint: Boolean
    get() = isSystemInDarkTheme()
