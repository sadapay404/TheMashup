package app.themashup.music.playback

import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import java.util.concurrent.ConcurrentHashMap

/**
 * Per-URL request headers for natively resolved streams.
 *
 * Some media URLs only serve bytes when the request carries the headers the extractor used to obtain
 * them: a `Referer`, a matching `User-Agent`, sometimes an `Origin`. YouTube's own CDN URLs are
 * usually happy with anything, but a NewPipeExtractor result can be a DASH/HLS manifest or a mirror
 * that checks — and handing ExoPlayer a URL without its headers produces a 403, which is
 * indistinguishable from "the stream died".
 *
 * Media3 has no per-item header API, so the mapping lives here and is applied by a
 * [ResolvingDataSource]. Keys are the full URL (signed, query string and all), because two tracks can
 * share a host and still need different referrers.
 *
 * Entries are capped, so a long session cannot grow this without bound.
 */
@OptIn(UnstableApi::class)
object MediaItemHeaders {

    private const val MAX_ENTRIES = 32

    private val headers = ConcurrentHashMap<String, Map<String, String>>()

    /** Remember the headers a resolved URL needs. An empty map is a no-op. */
    fun put(url: String, values: Map<String, String>) {
        if (url.isBlank() || values.isEmpty()) return
        if (headers.size >= MAX_ENTRIES) headers.clear()
        headers[url] = values
    }

    fun get(url: String): Map<String, String> = headers[url] ?: emptyMap()

    fun clear() = headers.clear()

    /** The headers stored for a media item's URI, if any. */
    fun forItem(item: MediaItem): Map<String, String> {
        val uri = item.localConfiguration?.uri ?: return emptyMap()
        return get(uri.toString())
    }

    /**
     * Apply the stored headers at the [DataSpec] level.
     *
     * This is the only place Media3 lets an app touch the actual HTTP request, and it covers both a
     * manifest and the segment requests a DASH/HLS source derives from it.
     */
    fun applyTo(spec: DataSpec): DataSpec {
        val extra = get(spec.uri.toString())
        if (extra.isEmpty()) return spec
        val merged = HashMap<String, String>(spec.httpRequestHeaders.size + extra.size)
        merged.putAll(spec.httpRequestHeaders)
        // The extractor's value wins where both exist: the server validated that one.
        merged.putAll(extra)
        return spec.buildUpon().setHttpRequestHeaders(merged).build()
    }

    /** A data source factory that applies [applyTo] to every request. */
    fun factory(upstream: DataSource.Factory): DataSource.Factory =
        DataSource.Factory {
            ResolvingDataSource(upstream.createDataSource()) { spec -> applyTo(spec) }
        }

    /** The app's normal source chain (file, asset, content, http) with headers layered on top. */
    fun defaultFactory(context: android.content.Context): DataSource.Factory =
        factory(DefaultDataSource.Factory(context))
}
