package local.themashup.music.core.domain

/**
 * Hybrid search-bar merge — port of
 * `packages/shared/src/utils/hybrid.ts`.
 * A) metadata results (search catalog)
 * B) lyric-match candidates (free text/partial lyrics → LRCLIB)
 */

sealed class HybridRow {
    abstract val key: String
    abstract val rankScore: Double

    data class TrackRow(
        val track: RankedTrack,
        override val rankScore: Double,
        override val key: String,
    ) : HybridRow()

    data class LyricRow(
        val match: LyricMatchRow,
        override val rankScore: Double,
        override val key: String,
    ) : HybridRow()
}

fun mergeHybrid(
    tracks: List<Track>,
    lyricMatches: List<LyricMatchRow>,
    query: String,
): List<HybridRow> {
    val ranked = rankSearchResults(tracks, query)
    val seen = ranked.map { normalize(it.track.title) + "|" + normalize(it.track.artistNames) }.toSet()

    val trackRows: List<HybridRow> = ranked.map {
        HybridRow.TrackRow(
            track = it,
            rankScore = it.rankScore,
            key = "track:${it.track.id}",
        )
    }

    val lyricRows = mutableListOf<HybridRow>()
    for (m in lyricMatches) {
        val dedupeKey = normalize(m.trackName) + "|" + normalize(m.artistName)
        if (dedupeKey in seen) continue
        if (m.similarity < 0.3) continue
        lyricRows.add(
            HybridRow.LyricRow(
                match = m,
                rankScore = minOf(1.0, m.similarity * 0.95),
                key = "lyric:${m.lrclibId}",
            ),
        )
    }

    return (trackRows + lyricRows).sortedByDescending { it.rankScore }
}

/** Flatten helper for keyboard navigation over mixed rows. */
fun hybridIndexBounds(rows: List<HybridRow>): Int = rows.size - 1
