package local.themashup.music.core.network.logic

import java.net.URLEncoder
import local.themashup.music.core.domain.matchScore
import local.themashup.music.core.domain.normalize
import local.themashup.music.core.domain.similarity
import local.themashup.music.core.domain.LyricMatchRow
import local.themashup.music.core.domain.Lyrics
import local.themashup.music.core.domain.parseLrc

/**
 * LRCLIB matching logic — exact port of `apps/api/src/services/lyrics.ts`
 * (`bestLine`, `recordToMatch`, `pickBest`, `match` filters, `forTrack`
 * selection, `toLyrics`) operating on [LrclibRecord] so every rule is unit
 * testable without HTTP or JSON (parsing lives in `../parsing`).
 */
data class LrclibRecord(
    val id: Long,
    val trackName: String,
    val artistName: String,
    val albumName: String? = null,
    val duration: Int? = null,
    val plainLyrics: String? = null,
    val syncedLyrics: String? = null,
    val instrumental: Boolean = false,
)

object LyricsLogic {

    const val SNIPPET_THRESHOLD = 0.34
    const val MATCH_THRESHOLD = 0.25
    const val MATCH_LIMIT = 8
    const val SEARCH_SLICE = 20
    const val DURATION_BONUS_WINDOW_SEC = 3
    const val DURATION_BONUS = 0.3
    const val SYNCED_BONUS = 0.1

    private const val USER_AGENT = "TheMashup/0.1 (personal music player)"
    const val DEFAULT_BASE = "https://lrclib.net"

    val userAgent: String get() = USER_AGENT

    /** `GET {base}/api/search?q=…` (URLSearchParams-compatible encoding). */
    fun searchUrl(query: String, base: String = DEFAULT_BASE): String =
        "$base/api/search?q=${encode(query)}"

    /** `GET {base}/api/get?track_name=…&artist_name=…[&duration=…]` (param order preserved). */
    fun getUrl(
        trackName: String,
        artistName: String,
        durationSec: Int?,
        base: String = DEFAULT_BASE,
    ): String {
        val sb = StringBuilder("$base/api/get?track_name=${encode(trackName)}")
        sb.append("&artist_name=").append(encode(artistName))
        if (durationSec != null && durationSec > 0) {
            sb.append("&duration=").append(durationSec)
        }
        return sb.toString()
    }

    /** Best-matching lyric line for the "matched lyric" snippet UI. */
    fun bestLine(r: LrclibRecord, query: String): String? {
        val plainSource = r.plainLyrics?.trim().orEmpty()
        val source = if (plainSource.isNotEmpty()) {
            plainSource
        } else {
            (r.syncedLyrics ?: "")
                .split("\n")
                .joinToString("\n") { it.replace(Regex("""\[[^\]]*]"""), "").trim() }
                .trim()
        }
        if (source.isEmpty()) return null
        var best = ""
        var bestScore = 0.0
        for (raw in source.split("\n")) {
            val line = raw.trim()
            if (line.length < 3) continue
            val s = similarity(query, line)
            if (s > bestScore) {
                bestScore = s
                best = line
            }
        }
        return if (bestScore >= SNIPPET_THRESHOLD) best else null
    }

    /**
     * Scores against BOTH "title artist" (metadata queries) AND the lyric body
     * (partial-lyric queries) — mirrors LRCLIB full-text behaviour.
     */
    fun recordToMatch(r: LrclibRecord, query: String): LyricMatchRow {
        val titleArtistScore = matchScore(query, "${r.trackName} ${r.artistName}")
        val plain = r.plainLyrics?.trim().orEmpty()
        val lyricTextScore = if (plain.isNotEmpty()) similarity(query, plain) else 0.0
        return LyricMatchRow(
            trackName = r.trackName,
            artistName = r.artistName,
            albumName = r.albumName,
            durationSec = r.duration,
            synced = r.syncedLyrics != null,
            plain = r.plainLyrics != null,
            similarity = maxOf(titleArtistScore, lyricTextScore),
            lrclibId = r.id,
            snippet = bestLine(r, query),
        )
    }

    /** Exact-ish record for a track: metadata match + duration/synced bonuses. */
    fun pickBest(
        records: List<LrclibRecord>,
        trackName: String,
        artistName: String,
        duration: Int?,
    ): LrclibRecord? {
        val want = normalize("$trackName $artistName")
        return records
            .map { r ->
                var s = matchScore(want, "${r.trackName} ${r.artistName}")
                if (duration != null && r.duration != null &&
                    kotlin.math.abs(r.duration - duration) <= DURATION_BONUS_WINDOW_SEC
                ) {
                    s += DURATION_BONUS
                }
                if (r.syncedLyrics != null) s += SYNCED_BONUS
                r to s
            }
            .sortedByDescending { it.second }
            .firstOrNull()?.first
    }

    /** Ranked lyric candidates: top 20 → score → threshold → sort → top 8. */
    fun match(records: List<LrclibRecord>, query: String): List<LyricMatchRow> =
        records
            .take(SEARCH_SLICE)
            .map { recordToMatch(it, query) }
            .filter { it.similarity > MATCH_THRESHOLD }
            .sortedByDescending { it.similarity }
            .take(MATCH_LIMIT)

    /** parseLrc-powered Lyrics (Kotlin shape parses synced up front). */
    fun toLyrics(r: LrclibRecord, provider: String = "lrclib"): Lyrics = Lyrics(
        plain = r.plainLyrics,
        synced = r.syncedLyrics?.let { parseLrc(it) } ?: emptyList(),
        provider = provider,
        instrumental = r.instrumental,
    )

    /**
     * `forTrack` selection rule without HTTP: exact `/api/get` record if given,
     * else best of the search fallback (callers fetch both sides).
     */
    fun forTrack(
        direct: LrclibRecord?,
        searchRecords: List<LrclibRecord>,
        title: String,
        artistNames: String,
        durationSec: Int?,
    ): LrclibRecord? =
        direct ?: searchRecords.takeIf { it.isNotEmpty() }
            ?.let { pickBest(it, title, artistNames, durationSec) }

    private fun encode(v: String): String =
        URLEncoder.encode(v, Charsets.UTF_8.name())
}
