package local.themashup.music.core.network.logic

import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.Track

/** Streams + related returned by one source for a video id. */
data class SourceStreams(
    val candidates: List<StreamCandidate> = emptyList(),
    val related: List<Track> = emptyList(),
)

/**
 * One upstream (NewPipe / Piped / Invidious). Blocking on purpose — callers
 * hop to `Dispatchers.IO`, mirroring the resolver's synchronous sources.
 */
interface MusicSource {
    /** "newpipe" | "piped" | "invidious" */
    val id: String

    fun search(query: String, limit: Int = 20): List<Track>

    fun streams(videoId: String): SourceStreams

    /** Trending/charts list (Piped `/trending`, Invidious `/api/v1/trending`). */
    fun trending(limit: Int = 40): List<Track> = emptyList()

    /** Autocomplete suggestions (Piped `/suggestions`). */
    fun suggest(query: String): List<String> = emptyList()
}

/** Search outcome (web `SearchResponse`-shaped, minus artists/albums for N3). */
data class SearchOutcome(
    val tracks: List<Track>,
    val source: String,
    /** true when the primary failed and we fell back (or everything failed). */
    val degraded: Boolean,
    val warnings: List<String>,
)

/** Stream outcome (web `StreamResponse`-shaped: resolution_ms + degraded + warnings). */
data class StreamOutcome(
    val candidates: List<StreamCandidate>,
    val related: List<Track>,
    val source: String,
    val resolutionMs: Long,
    val degraded: Boolean,
    val warnings: List<String>,
)

/**
 * Walk [sources] in priority order, first success wins; failures become
 * warnings (resolver policy: fallbacks engage only after a failure).
 * Total failure → empty result + degraded=true + all warnings.
 */
object ExtractionLogic {

    fun search(
        sources: List<MusicSource>,
        query: String,
        limit: Int = 20,
    ): SearchOutcome {
        val warnings = mutableListOf<String>()
        var sawFailure = false
        for (source in sources) {
            try {
                val tracks = source.search(query, limit)
                if (tracks.isNotEmpty()) {
                    return SearchOutcome(tracks, source.id, degraded = sawFailure, warnings = warnings)
                }
                warnings += "${source.id}: no results"
                sawFailure = true
            } catch (e: Exception) {
                warnings += "${source.id}: ${e.message ?: e.javaClass.simpleName}"
                sawFailure = true
            }
        }
        return SearchOutcome(emptyList(), "none", degraded = true, warnings = warnings)
    }

    fun streams(
        sources: List<MusicSource>,
        videoId: String,
        resolutionStartMs: Long = System.currentTimeMillis(),
    ): StreamOutcome {
        val warnings = mutableListOf<String>()
        var sawFailure = false
        for (source in sources) {
            try {
                val result = source.streams(videoId)
                if (result.candidates.isNotEmpty()) {
                    return StreamOutcome(
                        candidates = result.candidates,
                        related = result.related,
                        source = source.id,
                        resolutionMs = System.currentTimeMillis() - resolutionStartMs,
                        degraded = sawFailure,
                        warnings = warnings,
                    )
                }
                warnings += "${source.id}: no streams"
                sawFailure = true
            } catch (e: Exception) {
                warnings += "${source.id}: ${e.message ?: e.javaClass.simpleName}"
                sawFailure = true
            }
        }
        return StreamOutcome(
            candidates = emptyList(),
            related = emptyList(),
            source = "none",
            resolutionMs = System.currentTimeMillis() - resolutionStartMs,
            degraded = true,
            warnings = warnings,
        )
    }

    /** First source with a non-empty trending list (charts pool for shelves). */
    fun trending(sources: List<MusicSource>, limit: Int): List<Track> {
        for (src in sources) {
            val items = runCatching { src.trending(limit) }.getOrElse { emptyList() }
            if (items.isNotEmpty()) return items
        }
        return emptyList()
    }

    /** First source with suggestions; never throws (typeahead degrades). */
    fun suggest(sources: List<MusicSource>, query: String): List<String> {
        for (src in sources) {
            val items = runCatching { src.suggest(query) }.getOrElse { emptyList() }
            if (items.isNotEmpty()) return items
        }
        return emptyList()
    }
}
