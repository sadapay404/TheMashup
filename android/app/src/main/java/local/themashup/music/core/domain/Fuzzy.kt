package local.themashup.music.core.domain

import java.text.Normalizer

/**
 * Text normalization + fuzzy similarity — port of
 * `packages/shared/src/utils/fuzzy.ts` (behavior-identical).
 */

fun normalize(input: String): String {
    val noDiacritics = Normalizer.normalize(input.lowercase(), Normalizer.Form.NFKD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
    val punctuated = noDiacritics.replace(Regex("['’\"“”.,:;!?()\\[\\]{}|/\\\\_-]"), " ")
    return punctuated.replace(Regex("\\s+"), " ").trim()
}

fun tokens(input: String): Set<String> =
    normalize(input).split(" ").filter { it.isNotEmpty() }.toSet()

/**
 * Token-set similarity in [0,1]: Dice coefficient — twice the intersection
 * over the sum of set sizes. Order-insensitive:
 * "lights blinding" == "blinding lights".
 */
fun similarity(a: String, b: String): Double {
    val ta = tokens(a)
    val tb = tokens(b)
    if (ta.isEmpty() || tb.isEmpty()) return 0.0
    val inter = ta.count { it in tb }
    return (2.0 * inter) / (ta.size + tb.size)
}

/** Exact-ish match boost: normalized equality or containment. */
fun exactBoost(a: String, b: String): Double {
    val na = normalize(a)
    val nb = normalize(b)
    if (na.isEmpty() || nb.isEmpty()) return 0.0
    if (na == nb) return 1.0
    if (na.contains(nb) || nb.contains(na)) return 0.6
    return 0.0
}

/**
 * Combined score in [0,1] for matching free text against
 * "Title - Artist"-style strings (lyric match ranking).
 */
fun matchScore(query: String, candidate: String): Double {
    val s = similarity(query, candidate)
    val e = exactBoost(query, candidate)
    return kotlin.math.min(1.0, 0.7 * s + 0.3 * e + (if (e == 1.0) 0.3 else 0.0))
}
