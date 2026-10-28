package local.themashup.music.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import local.themashup.music.ui.logic.THEME_CATALOG
import local.themashup.music.ui.logic.ThemeId

/**
 * Header theme picker — the web's 5 swatch triples
 * (`ui/ThemeSwitcher.tsx` THEME_META): three overlapping circles per theme
 * (`-space-x-1.5`), active = accent ring. Tap persists immediately (DataStore).
 */
@Composable
fun ThemeSwatchPicker(
    current: ThemeId,
    onSelect: (ThemeId) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = local.themashup.music.ui.theme.LocalMashupTokens.current
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        THEME_CATALOG.forEach { theme ->
            val active = theme == current
            val ring = if (active) tokens.accent else Color.Transparent
            Box(
                modifier = Modifier
                    .size(width = 30.dp, height = 16.dp)
                    .clickable { onSelect(theme) }
                    .semantics {
                        contentDescription = "${theme.label}, ${theme.hint}"
                    },
            ) {
                Row {
                    theme.swatch.forEachIndexed { i, argb ->
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .offset(x = if (i == 0) 0.dp else (-6).dp)
                                .clip(CircleShape)
                                .border(
                                    BorderStroke(
                                        width = if (active && i == 0) 1.5.dp else 0.8.dp,
                                        color = if (active && i == 0) ring
                                        else Color.Black.copy(alpha = 0.25f),
                                    ),
                                    CircleShape,
                                )
                                .background(Color(argb.toInt())),
                        )
                    }
                }
            }
        }
    }
}
