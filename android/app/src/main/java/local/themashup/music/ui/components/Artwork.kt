package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.platform.LocalContext
import local.themashup.music.ui.logic.artGradient
import local.themashup.music.ui.logic.artInitials

/**
 * Album art with the web's deterministic gradient fallback when the URL is
 * missing/dead (`components/ui/Artwork.tsx`).
 */
@Composable
fun Artwork(
    src: String?,
    label: String,
    modifier: Modifier = Modifier,
    corner: Dp = 8.dp,
) {
    var failed by remember(src) { mutableStateOf(false) }
    val shape = RoundedCornerShape(corner)
    if (src.isNullOrBlank() || failed) {
        val (c1, c2) = remember(label) { artGradient(label.ifBlank { "themashup" }) }
        Box(
            modifier = modifier
                .clip(shape)
                .background(Brush.linearGradient(listOf(Color(c1.toInt()), Color(c2.toInt())))),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = artInitials(label).ifBlank { "♪" },
                color = Color.White.copy(alpha = 0.9f),
                fontSize = 12.sp,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    } else {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(src)
                .crossfade(true)
                .build(),
            contentDescription = label,
            contentScale = ContentScale.Crop,
            onError = { failed = true },
            modifier = modifier.clip(shape),
        )
    }
}
