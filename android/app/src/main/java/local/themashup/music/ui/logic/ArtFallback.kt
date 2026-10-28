package local.themashup.music.ui.logic

/**
 * Deterministic artwork fallbacks — port of `components/ui/Artwork.tsx`
 * (`hueFrom`, `initials`, gradient formula) + `lib/colors.ts`
 * (`fallbackArtColors`). Pure Kotlin (HSL → ARGB) for sandbox tests.
 */

/** Web `hueFrom`: rolling (h * 31 + code) mod 360. */
fun artHue(seed: String): Int {
    var h = 0
    for (ch in seed) h = (h * 31 + ch.code) % 360
    return h
}

/** Web `initials`: first character of the first two words, uppercased. */
fun artInitials(label: String): String =
    label.split(Regex("\\s+"))
        .filter { it.isNotBlank() }
        .take(2)
        .mapNotNull { w -> w.firstOrNull()?.uppercaseChar()?.toString() }
        .joinToString("")

/** Standard HSL → ARGB (matches CSS `hsl(h s% l%)` rendering). */
fun hslToArgb(hDegrees: Int, s: Double, l: Double, alpha: Int = 255): Long {
    val c = (1 - kotlin.math.abs(2 * l - 1)) * s
    val hp = (((hDegrees % 360) + 360) % 360) / 60.0
    val x = c * (1 - kotlin.math.abs(hp % 2 - 1))
    val (r1, g1, b1) = when {
        hp < 1 -> Triple(c, x, 0.0)
        hp < 2 -> Triple(x, c, 0.0)
        hp < 3 -> Triple(0.0, c, x)
        hp < 4 -> Triple(0.0, x, c)
        hp < 5 -> Triple(x, 0.0, c)
        else -> Triple(c, 0.0, x)
    }
    val m = l - c / 2
    fun ch(v: Double): Int = ((v + m) * 255).toInt().coerceIn(0, 255)
    return (alpha.toLong() shl 24) or
        (ch(r1).toLong() shl 16) or
        (ch(g1).toLong() shl 8) or
        ch(b1).toLong()
}

/** Web Artwork fallback gradient: 135° hsl(h 65% 52%) → hsl(h+48 62% 38%). */
fun artGradient(seed: String): Pair<Long, Long> {
    val h = artHue(seed)
    return hslToArgb(h, 0.65, 0.52) to hslToArgb((h + 48) % 360, 0.62, 0.38)
}

/** Web `fallbackArtColors`: hsl(h 72% 58%) → hsl(h+52 68% 46%) for `--art-*`. */
fun artAccentFallback(seed: String): Pair<Long, Long> {
    val h = artHue(seed)
    return hslToArgb(h, 0.72, 0.58) to hslToArgb((h + 52) % 360, 0.68, 0.46)
}
