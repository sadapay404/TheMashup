package local.themashup.music.core.network

import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.FallbackHosts
import local.themashup.music.core.network.logic.InstancePool
import local.themashup.music.core.network.logic.MusicSource
import local.themashup.music.core.network.logic.SourceStreams
import local.themashup.music.core.network.parsing.PipedParsing
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/**
 * Piped fallback source — port of `services/resolver/app/sources/piped_source.py`
 * on top of the shared `InstancePool` rotation (first healthy instance wins,
 * failure marks down for 45s).
 */
class PipedClient(
    private val client: OkHttpClient = newNetworkClient(),
    override val id: String = "piped",
    pool: InstancePool? = null,
) : MusicSource {

    private val pool = pool ?: InstancePool(FallbackHosts.PIPED)

    override fun search(query: String, limit: Int): List<Track> =
        PipedParsing.search(
            getJson("/search", mapOf("q" to query, "filter" to "songs")),
            limit,
        )

    override fun trending(limit: Int): List<Track> =
        runCatching {
            PipedParsing.trending(getJson("/trending", mapOf("region" to "US")), limit)
        }.getOrElse { emptyList() }

    override fun suggest(query: String): List<String> = suggestions(query, 8)

    fun suggestions(query: String, limit: Int = 8): List<String> =
        PipedParsing.suggestions(getJson("/suggest", mapOf("q" to query)), limit)

    override fun streams(videoId: String): SourceStreams {
        val (candidates, related) = PipedParsing.streams(getJson("/streams/$videoId"))
        return SourceStreams(candidates, related)
    }

    fun related(videoId: String, limit: Int = 20): List<Track> = streams(videoId).related.take(limit)

    /** Resolver `InstancePool.get_json`: first healthy mirror, else "all failed". */
    private fun getJson(path: String, params: Map<String, String> = emptyMap()): String {
        var lastError: Exception? = null
        for (base in pool.ordered()) {
            val urlBuilder = (base + path).toHttpUrl().newBuilder()
            params.forEach { (k, v) -> urlBuilder.addQueryParameter(k, v) }
            try {
                return client.get_BODY(urlBuilder.build().toString())
            } catch (e: Exception) {
                lastError = e
                pool.markDown(base)
            }
        }
        throw RuntimeException("$id: all instances failed ($lastError)")
    }

    /** Exposed for diagnostics/tests. */
    val instancePool: InstancePool get() = pool
}
