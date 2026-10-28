package local.themashup.music.core.network

import local.themashup.music.core.domain.LyricMatch
import local.themashup.music.core.domain.Lyrics
import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.ExtractionLogic
import local.themashup.music.core.network.logic.MusicSource
import local.themashup.music.core.network.logic.SearchOutcome
import local.themashup.music.core.network.logic.StreamOutcome

/**
 * N3 facade: search / streams / related with NewPipe→Piped→Invidious
 * failover, plus LRCLIB lyrics. Blocking (call from Dispatchers.IO) —
 * exactly the resolver's synchronous policy, in-process.
 */
class ExtractionService(
    private val sources: List<MusicSource> = listOf(
        NewPipeSource(),
        PipedClient(),
        InvidiousClient(),
    ),
    val lyrics: LrclibClient = LrclibClient(),
) {

    /** Priority-ordered source ids (for UI/debug display). */
    val sourceIds: List<String> get() = sources.map { it.id }

    fun search(query: String, limit: Int = 20): SearchOutcome =
        ExtractionLogic.search(sources, query, limit)

    /** Charts pool for home shelves (trending walk). */
    fun trending(limit: Int = 40): List<Track> = ExtractionLogic.trending(sources, limit)

    /** Typeahead autocomplete. */
    fun suggest(query: String, limit: Int = 8): List<String> =
        ExtractionLogic.suggest(sources, query).take(limit)

    fun streams(videoId: String): StreamOutcome =
        ExtractionLogic.streams(sources, videoId)

    /** Related/up-next tracks for a video (first source that answers). */
    fun related(videoId: String, limit: Int = 20): List<Track> {
        val out = streams(videoId)
        return out.related.take(limit)
    }

    /** Ranked lyric candidates for free text (LRCLIB `/api/search`). */
    fun lyricMatch(query: String): LyricMatch = lyrics.match(query)

    /** Synced/plain lyrics for a track (`/api/get` + search fallback). */
    fun lyricsFor(track: Track): Lyrics? = lyrics.forTrack(track)
}
