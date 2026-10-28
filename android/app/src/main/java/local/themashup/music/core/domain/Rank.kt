package local.themashup.music.core.domain

/**
 * Search result ranking — port of `packages/shared/src/utils/rank.ts`.
 * Priority: exact title/artist hits, then fuzzy title hits, then popularity.
 * Lyric-derived candidates carry a similarity boost.
 */

data class LyricHit(val similarity: Double, val snippet: String? = null)

data class RankedTrack(
    val track: Track,
    val rankScore: Double,
    val matchedLyric: String? = null,
)

fun rankSearchResults(
    tracks: List<Track>,
    query: String,
    lyricIds: Map<String, LyricHit> = emptyMap(),
): List<RankedTrack> {
    val q = normalize(query)
    val qTokens = q.split(" ").filter { it.isNotEmpty() }.toSet()

    val ranked = tracks.map { t ->
        val titleSim = matchScore(query, t.title)
        val artistSim = matchScore(query, t.artistNames)
        val titleNorm = normalize(t.title)

        val exactBonus = when {
            titleNorm == q -> 0.5
            titleNorm.startsWith(q) -> 0.3
            else -> 0.0
        }

        // Partial word coverage of the query in the title.
        val wordHits = qTokens.count { titleNorm.contains(it) }
        val coverage = if (qTokens.isNotEmpty()) wordHits.toDouble() / qTokens.size else 0.0

        val lyric = lyricIds[t.externalId] ?: lyricIds[t.id]
        val pop = ((t.popularity ?: 0).coerceAtMost(100)) / 100.0

        val rankScore = 0.35 * titleSim +
            0.15 * artistSim +
            0.2 * coverage +
            exactBonus +
            0.1 * pop +
            (if (lyric != null) 0.25 * lyric.similarity else 0.0)

        RankedTrack(
            track = t,
            rankScore = minOf(1.0, rankScore),
            matchedLyric = lyric?.snippet,
        )
    }

    return ranked.sortedByDescending { it.rankScore }
}
