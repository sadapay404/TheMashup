package local.themashup.music.core.network

import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.MusicSource
import local.themashup.music.core.network.logic.SourceStreams
import local.themashup.music.core.network.logic.StreamNormalize
import local.themashup.music.core.network.logic.TrackNormalize
import local.themashup.music.core.network.logic.VideoIds
import okhttp3.OkHttpClient
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem

/**
 * Primary source — NewPipeExtractor search/streams/related (the native analog
 * of the resolver's ytdlp primary: direct YouTube extraction in-process, no
 * PC/gateway). Blocking; callers hop to Dispatchers.IO.
 */
class NewPipeSource(
    client: OkHttpClient = newNetworkClient(),
) : MusicSource {

    override val id: String = "newpipe"

    init {
        ensureInit(client)
    }

    override fun search(query: String, limit: Int): List<Track> {
        val extractor = ServiceList.YouTube.getSearchExtractor(query)
        extractor.fetchPage()
        val items = extractor.initialPage?.itemsList ?: emptyList()
        return items.mapNotNull { infoItemToTrack(it, category = "song") }.take(limit)
    }

    override fun streams(videoId: String): SourceStreams {
        val info = StreamInfo.getInfo(ServiceList.YouTube, VideoIds.watchUrl(videoId))
        val audio = info.audioStreams
            .filter { it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP }
            .mapNotNull { a ->
                val url = a.url ?: return@mapNotNull null
                val base = StreamNormalize.candidate(
                    source = "newpipe",
                    url = url,
                    mime = a.format?.mimeType ?: "audio/mp4",
                    quality = a.quality,
                    bitrateBps = null,
                    sizeValue = null,
                ) ?: return@mapNotNull null
                base.copy(
                    bitrateKbps = StreamNormalize.kbpsFromNewPipe(a.quality, a.averageBitrate),
                )
            }
        // N7 downloads: muxed (audio attached) + adaptive (video-only) video
        // streams — StreamInfo keeps them in separate lists.
        val video = (info.videoStreams.map { s -> s to false } +
            info.videoOnlyStreams.map { s -> s to true }).mapNotNull { (v, videoOnly) ->
            if (v.deliveryMethod != DeliveryMethod.PROGRESSIVE_HTTP) return@mapNotNull null
            val url = v.url ?: return@mapNotNull null
            StreamNormalize.videoCandidate(
                source = "newpipe",
                url = url,
                mime = v.format?.mimeType ?: "video/mp4",
                quality = v.resolution?.takeIf { it.isNotBlank() } ?: v.quality,
                width = v.width,
                height = v.height,
                videoOnly = videoOnly,
                sizeValue = null,
            )
        }
        val candidates = StreamNormalize.sortCandidates(audio) + video
        val related = info.relatedItems.mapNotNull { infoItemToTrack(it, category = "video") }
        return SourceStreams(candidates, related)
    }

    private fun infoItemToTrack(
        item: org.schabi.newpipe.extractor.InfoItem,
        category: String,
    ): Track? {
        val vid = VideoIds.fromUrl(item.url) ?: return null
        val sii = item as? StreamInfoItem
        val thumbs = item.thumbnails.mapNotNull { img ->
            val url = img.url
            if (url.isNullOrBlank()) null
            else mapOf(
                "url" to url,
                "width" to img.width.takeIf { it > 0 },
                "height" to img.height.takeIf { it > 0 },
            )
        }
        return TrackNormalize.track(
            videoId = vid,
            title = item.name ?: "",
            artists = listOf(
                mapOf("name" to (sii?.uploaderName ?: "Unknown")),
            ),
            source = id,
            duration = sii?.duration?.takeIf { it > 0 },
            artwork = TrackNormalize.bestThumb(thumbs),
            category = category,
        )
    }

    companion object {
        @Volatile
        private var initialized = false
        private val lock = Any()

        /** `NewPipe.init(Downloader)` exactly once per process. */
        fun ensureInit(client: OkHttpClient) {
            if (initialized) return
            synchronized(lock) {
                if (!initialized) {
                    NewPipe.init(OkHttpDownloader(client))
                    initialized = true
                }
            }
        }
    }
}
