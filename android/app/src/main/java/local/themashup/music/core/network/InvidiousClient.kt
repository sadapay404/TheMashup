package local.themashup.music.core.network

import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.FallbackHosts
import local.themashup.music.core.network.logic.InstancePool
import local.themashup.music.core.network.logic.MusicSource
import local.themashup.music.core.network.logic.SourceStreams
import local.themashup.music.core.network.parsing.InvidiousParsing
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/**
 * Invidious fallback source — port of
 * `services/resolver/app/sources/invidious_source.py` (last-resort pool).
 */
class InvidiousClient(
    private val client: OkHttpClient = newNetworkClient(),
    override val id: String = "invidious",
    pool: InstancePool? = null,
) : MusicSource {

    private val pool = pool ?: InstancePool(FallbackHosts.INVIDIOUS)

    override fun search(query: String, limit: Int): List<Track> =
        InvidiousParsing.search(
            getJson("/api/v1/search", mapOf("q" to query, "type" to "video")),
            limit,
        )

    override fun streams(videoId: String): SourceStreams {
        val (candidates, related) = InvidiousParsing.streams(getJson("/api/v1/videos/$videoId"))
        return SourceStreams(candidates, related)
    }

    fun related(videoId: String, limit: Int = 20): List<Track> = streams(videoId).related.take(limit)

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

    val instancePool: InstancePool get() = pool
}
