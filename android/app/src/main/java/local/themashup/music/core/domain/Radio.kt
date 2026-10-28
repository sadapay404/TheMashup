package local.themashup.music.core.domain

import kotlin.math.abs

/**
 * Endless-radio queue builder — port of
 * `packages/shared/src/utils/radio.ts` (MMR greedy re-rank).
 */

data class RadioOptions(
    val limit: Int = 30,
    /** MMR lambda: 1 = pure relevance to seed, 0 = pure diversity. */
    val lambda: Double = 0.7,
    /** Injectable RNG so tests are deterministic. */
    val rng: () -> Double = { kotlin.random.Random.nextDouble() },
)

fun buildRadioQueue(
    seed: Track?,
    pool: List<Track>,
    options: RadioOptions = RadioOptions(),
): List<Track> {
    val limit = options.limit
    val lambda = options.lambda
    val rng = options.rng

    val seen = HashSet<String>()
    val fresh = mutableListOf<Track>()
    for (t in pool) {
        if (t.id.isEmpty()) continue
        if (seed != null && t.id == seed.id) continue
        if (t.id in seen) continue
        seen.add(t.id)
        fresh.add(t)
    }
    if (fresh.isEmpty()) return emptyList()

    val remaining = fresh.toMutableList()
    val picked = mutableListOf<Track>()

    // Seed relevance profile: artist tokens + title of the seed (if any).
    val seedProfile = if (seed != null) {
        normalize("${seed.artistNames} ${seed.title}")
    } else {
        normalize(fresh.first().artistNames)
    }

    while (picked.size < limit && remaining.isNotEmpty()) {
        var bestIdx = 0
        var bestScore = Double.NEGATIVE_INFINITY
        for (i in remaining.indices) {
            val cand = remaining[i]
            val rel = if (seedProfile.isNotEmpty()) {
                similarity(seedProfile, normalize("${cand.artistNames} ${cand.title}"))
            } else {
                0.5
            }
            // Diversity: penalize similarity to what we already picked (MMR).
            var maxSimToPicked = 0.0
            for (p in picked) {
                val s = similarity(
                    normalize("${cand.artistNames} ${cand.title}"),
                    normalize("${p.artistNames} ${p.title}"),
                )
                if (s > maxSimToPicked) maxSimToPicked = s
            }
            // Never play the same artist twice in a row — unless every
            // remaining candidate IS that artist (forced pick when exhausted).
            val prev = picked.lastOrNull()
            val prevArtist = if (prev != null) normalize(prev.artistNames) else ""
            val hasAlternative = if (prevArtist.isNotEmpty()) {
                remaining.any { normalize(it.artistNames) != prevArtist }
            } else {
                true
            }
            val sameArtistAsPrev =
                prevArtist.isNotEmpty() &&
                    normalize(cand.artistNames) == prevArtist &&
                    hasAlternative
            val streakPenalty = if (sameArtistAsPrev) 0.45 else 0.0
            // Tiny jitter keeps repeats varied between regenerations.
            val score = lambda * rel - (1 - lambda) * maxSimToPicked -
                streakPenalty + rng() * 0.05
            if (score > bestScore) {
                bestScore = score
                bestIdx = i
            }
        }
        picked.add(remaining.removeAt(bestIdx))
    }
    return picked
}

/** Deterministic RNG for reproducible tests (mirrors the TS test fixtures). */
fun lcgRng(seed: Long): () -> Double {
    var state = if (seed == 0L) 0x9E3779B9L else seed
    return {
        state = state * 6364136223846793005L + 1442695040888963407L
        ((state ushr 11) and ((1L shl 31) - 1)).toDouble() / (1L shl 31).toDouble()
    }
}

@Suppress("unused")
private val absRef: (Int) -> Int = { abs(it) }
