package local.themashup.music.core.domain

import java.time.Instant
import java.time.format.DateTimeParseException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Recommendation shelves — port of `packages/shared/src/utils/recommend.ts`.
 * Local stand-in for the pgvector features: recency-weighted replays,
 * artist taste vectors, deterministic diversity repair.
 */

private const val DAY_MS = 86_400_000.0

private fun ageDays(iso: String, nowMs: Long): Double {
    val t = try {
        Instant.parse(iso).toEpochMilli().toDouble()
    } catch (_: DateTimeParseException) {
        return 30.0 // unknown → treat as old
    }
    return max(0.0, (nowMs - t) / DAY_MS)
}

/**
 * "Listen Again": recency-weighted replays + stable favorites. Liked tracks
 * always outrank equally-recent plain plays; duplicates keep their best
 * score; result preserves descending score order.
 */
fun listenAgain(
    history: List<HeardEntry>,
    likedIds: Set<String>,
    limit: Int = 24,
    nowMs: Long = System.currentTimeMillis(),
): List<Track> {
    val best = LinkedHashMap<String, Pair<Track, Double>>()
    for (h in history) {
        val decay = 0.9.pow(ageDays(h.at, nowMs)) // ~half-life 6.6 days
        val likedBonus = if (h.track.id in likedIds) 40.0 else 0.0
        val score = 50 * decay + likedBonus + 5
        val prev = best[h.track.id]
        if (prev == null || score > prev.second) best[h.track.id] = h.track to score
    }
    return best.values
        .sortedByDescending { it.second }
        .take(limit)
        .map { it.first }
}

/** Include liked tracks that were never played (favorites still belong here). */
fun listenAgainWithLikes(
    history: List<HeardEntry>,
    likedTracks: List<Track>,
    limit: Int = 24,
    nowMs: Long = System.currentTimeMillis(),
): List<Track> {
    val likedIds = likedTracks.map { it.id }.toSet()
    val base = listenAgain(history, likedIds, limit * 2, nowMs)
    val seen = base.map { it.id }.toSet()
    val extra = likedTracks.filter { it.id !in seen }
    val merged = base.toMutableList()
    for (t in extra) {
        if (merged.size >= limit) break
        merged.add(t)
    }
    return merged.take(limit)
}

/**
 * User taste vector: artist → weight from plays (recency decay) + likes.
 * The on-device analogue of the web taste embeddings.
 */
fun tasteVector(
    history: List<HeardEntry>,
    likedIds: Set<String>,
    nowMs: Long = System.currentTimeMillis(),
): Map<String, Double> {
    val v = LinkedHashMap<String, Double>()
    fun add(names: String, w: Double) {
        for (raw in names.split(",")) {
            val key = normalize(raw.trim())
            if (key.isEmpty()) continue
            v[key] = (v[key] ?: 0.0) + w
        }
    }
    for (h in history) {
        val decay = 0.93.pow(ageDays(h.at, nowMs))
        add(h.track.artistNames, (if (h.track.id in likedIds) 2.4 else 1.0) * decay)
    }
    return v
}

private fun tasteScore(taste: Map<String, Double>, track: Track): Double {
    if (taste.isEmpty()) return 0.0
    var score = 0.0
    for (raw in track.artistNames.split(",")) {
        val key = normalize(raw.trim())
        score = max(score, taste[key] ?: 0.0)
    }
    val maxWeight = max(taste.values.maxOrNull() ?: 1.0, 1.0)
    return min(1.0, score / maxWeight)
}

/** No two adjacent rows from the same artist (deterministic repair pass). */
fun diversify(list: List<Track>): List<Track> {
    val reordered = list.toMutableList()
    var i = 1
    while (i < reordered.size) {
        if (normalize(reordered[i].artistNames) == normalize(reordered[i - 1].artistNames)) {
            val swap = reordered.indexOfFirstIndexed { j, t ->
                j > i && normalize(t.artistNames) != normalize(reordered[i - 1].artistNames)
            }
            if (swap > i) {
                val tmp = reordered[i]
                reordered[i] = reordered[swap]
                reordered[swap] = tmp
            }
        }
        i++
    }
    return reordered
}

private inline fun <T> List<T>.indexOfFirstIndexed(predicate: (Int, T) -> Boolean): Int {
    for (i in indices) if (predicate(i, this[i])) return i
    return -1
}

/**
 * "Discover weekly": rank chart candidates against the taste vector, drop
 * whatever the user heard recently (unless the pool gets thin), diversify.
 * Falls back to raw candidates without taste data.
 */
fun discoverMix(
    history: List<HeardEntry>,
    likedIds: Set<String>,
    candidates: List<Track>,
    limit: Int = 24,
    nowMs: Long = System.currentTimeMillis(),
): List<Track> {
    val taste = tasteVector(history, likedIds, nowMs)
    val heardIds = history.take(60).map { it.track.id }.toSet()

    var pool = candidates.filter { it.id !in heardIds }
    if (pool.size < limit) pool = candidates // thin pool → relax the rule

    val scored = pool.map { track ->
        val rel = if (taste.isNotEmpty()) tasteScore(taste, track) else 0.4
        val pop = ((track.popularity ?: 40).coerceAtMost(100)) / 100.0
        track to 0.72 * rel + 0.28 * pop
    }.sortedByDescending { it.second }

    return diversify(scored.take(limit * 2).map { it.first }).take(limit)
}
