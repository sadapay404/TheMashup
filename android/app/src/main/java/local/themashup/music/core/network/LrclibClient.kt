package local.themashup.music.core.network

import java.io.IOException
import local.themashup.music.core.domain.LyricMatch
import local.themashup.music.core.domain.Lyrics
import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.LrclibRecord
import local.themashup.music.core.network.logic.LyricsLogic
import local.themashup.music.core.network.parsing.LrclibParsing
import okhttp3.OkHttpClient

/**
 * LRCLIB HTTP client — port of `apps/api/src/services/lyrics.ts` fetch layer:
 * 404 → null, any failure → null/empty (the web `lrclibFetch` never throws),
 * with matching UA header + 8s timeouts.
 */
class LrclibClient(
    private val client: OkHttpClient = newNetworkClient(),
    private val base: String = LyricsLogic.DEFAULT_BASE,
) {
    /** Free-text / title / artist → ranked lyric candidates (top 8, >0.25). */
    fun match(query: String, tookMs: Long = 0L): LyricMatch {
        val started = System.currentTimeMillis()
        val records = fetchList(LyricsLogic.searchUrl(query, base)) ?: emptyList()
        val matches = LyricsLogic.match(records, query)
        return LyricMatch(
            query = query,
            matches = matches,
            tookMs = if (tookMs > 0) tookMs else System.currentTimeMillis() - started,
        )
    }

    /** Exact-ish lyrics for a track: `/api/get`, then search+pickBest fallback. */
    fun forTrack(track: Track): Lyrics? = forTrack(
        title = track.title,
        artistNames = track.artistNames,
        durationSec = track.durationSec,
    )

    fun forTrack(title: String, artistNames: String, durationSec: Int?): Lyrics? {
        val direct = fetchRecord(
            LyricsLogic.getUrl(title, artistNames, durationSec, base),
        )
        val searchRecords = if (direct == null) {
            fetchList(LyricsLogic.searchUrl("$title $artistNames", base)) ?: emptyList()
        } else {
            emptyList()
        }
        val record = LyricsLogic.forTrack(direct, searchRecords, title, artistNames, durationSec)
        return record?.let { LyricsLogic.toLyrics(it) }
    }

    private fun fetchRecord(url: String): LrclibRecord? = try {
        val body = client.get_BODY(url, mapOf("User-Agent" to LyricsLogic.userAgent))
        LrclibParsing.get(body)
    } catch (_: Exception) {
        // 404 and transport errors are both "no direct hit" (web lrclibFetch).
        null
    }

    private fun fetchList(url: String): List<LrclibRecord>? = try {
        val body = client.get_BODY(url, mapOf("User-Agent" to LyricsLogic.userAgent))
        LrclibParsing.search(body)
    } catch (_: IOException) {
        null
    } catch (_: Exception) {
        null
    }
}
