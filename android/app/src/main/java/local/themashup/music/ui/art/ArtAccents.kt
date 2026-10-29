package local.themashup.music.ui.art

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.graphics.drawable.toBitmap
import androidx.palette.graphics.Palette
import coil.imageLoader
import coil.request.ImageRequest
import local.themashup.music.ui.logic.artAccentFallback
import local.themashup.music.ui.theme.ArtAccents

/**
 * App-wide `--art-1` / `--art-2` sampling (web `lib/colors.ts`
 * applyArtworkAccent via Canvas — here androidx.palette): two dominant,
 * reasonably saturated colors from the current artwork, with web's
 * gray/black/white filter; fallbacks = `fallbackArtColors(seed)` so glows
 * always match the album mood.
 */
@Composable
fun rememberArtAccents(url: String?, seed: String): ArtAccents {
    val safeSeed = seed.ifBlank { "themashup" }
    val fallback = remember(safeSeed) {
        val (a, b) = artAccentFallback(safeSeed)
        ArtAccents(first = Color(a.toInt()), second = Color(b.toInt()))
    }
    var accents by remember(url, safeSeed) { mutableStateOf(fallback) }
    val context = LocalContext.current

    if (url != null) {
        LaunchedEffect(url, safeSeed) {
            runCatching {
                val request = ImageRequest.Builder(context)
                    .data(url)
                    .allowHardware(false)
                    .build()
                val drawable = context.imageLoader.execute(request).drawable
                    ?: error("no artwork")
                val palette = Palette.from(drawable.toBitmap()).generate()
                val fb1 = fallback.first.toArgb()
                val fb2 = fallback.second.toArgb()
                // Web: hue buckets ranked by population, gray/black/white skipped.
                val ranked = palette.swatches
                    .filter { s ->
                        s.population > 0 &&
                            webPass((s.rgb shr 16) and 0xFF, (s.rgb shr 8) and 0xFF, s.rgb and 0xFF)
                    }
                    .sortedByDescending { it.population }
                val c1 = ranked.getOrNull(0)?.rgb ?: fb1
                val c2 = ranked.getOrNull(1)?.rgb ?: fb2
                accents = ArtAccents(
                    first = Color(c1),
                    second = if (c2 == c1) Color(fb2) else Color(c2),
                )
            }.onFailure {
                accents = fallback
            }
        }
    }
    return accents
}

/** Web colors.ts filter: skip gray / near-black / near-white pixels. */
private fun webPass(r: Int, g: Int, b: Int): Boolean {
    val max = maxOf(r, g, b)
    val min = minOf(r, g, b)
    if (max == 0) return false
    val sat = (max - min) / max.toDouble()
    val lum = (max + min) / 2 / 255.0
    return sat >= 0.22 && lum >= 0.12 && lum <= 0.92
}
