package local.themashup.music.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.Track
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Heart toggle — web `ui/LikeButton` (liked → accent filled + scale pulse).
 * Local profile is always identified, so no sign-in gate.
 */
@Composable
fun LikeButton(
    track: Track,
    library: LibraryRepository,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
) {
    val tokens = LocalMashupTokens.current
    val scope = rememberCoroutineScope()
    // StateFlow-backed so the heart recomposes for likes toggled anywhere.
    val libState by library.state.collectAsState()
    val isLiked = libState.likes.any { it.id == track.id }

    Box(
        modifier = modifier
            .size(size + 20.dp)
            .clickable {
                scope.launch { library.setLiked(track, !isLiked) }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            contentDescription = if (isLiked) "Remove from Liked" else "Save to Liked",
            tint = if (isLiked) tokens.accent else tokens.textFaint,
            modifier = Modifier
                .size(size)
                .graphicsLayer { scaleX = if (isLiked) 1.1f else 1f; scaleY = scaleX },
        )
    }
}
