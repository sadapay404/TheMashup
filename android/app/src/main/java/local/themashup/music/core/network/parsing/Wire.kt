package local.themashup.music.core.network.parsing

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.LrclibRecord
import local.themashup.music.core.network.logic.StreamNormalize
import local.themashup.music.core.network.logic.TrackNormalize
import local.themashup.music.core.network.logic.VideoIds

/* ── wire DTOs (tolerant: ignoreUnknownKeys, every field optional) ──────── */

@Serializable
data class PipedThumb(val url: String? = null, val width: Int? = null, val height: Int? = null)

@Serializable
data class PipedSearchItem(
    val url: String? = null,
    val id: String? = null,
    val title: String? = null,
    val uploaderName: String? = null,
    val uploader: String? = null,
    val duration: Long? = null,
    val lengthSeconds: Long? = null,
    val thumbnail: String? = null,
    val thumbnails: List<PipedThumb> = emptyList(),
)

@Serializable
data class PipedSearchResponse(val items: List<PipedSearchItem> = emptyList())

@Serializable
data class PipedSuggestResponse(val suggestions: List<String> = emptyList())

@Serializable
data class PipedAudioStream(
    val url: String? = null,
    val mimeType: String? = null,
    val quality: String? = null,
    val bitrate: Long? = null,
    /** Piped sends a JSON number OR string depending on instance. */
    val contentLength: JsonElement? = null,
)

@Serializable
data class PipedVideoStream(
    val url: String? = null,
    val mimeType: String? = null,
    val quality: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    /** false = muxed (video+audio in one file); true = adaptive video-only. */
    val videoOnly: Boolean? = null,
    val bitrate: Long? = null,
    val contentLength: JsonElement? = null,
)

@Serializable
data class PipedStreamsResponse(
    val audioStreams: List<PipedAudioStream> = emptyList(),
    val videoStreams: List<PipedVideoStream> = emptyList(),
    val relatedStreams: List<PipedSearchItem> = emptyList(),
)

@Serializable
data class InvidiousSearchItem(
    val videoId: String? = null,
    val id: String? = null,
    val title: String? = null,
    val author: String? = null,
    val uploader: String? = null,
    val authorId: String? = null,
    val lengthSeconds: Long? = null,
    val videoThumbnails: List<PipedThumb> = emptyList(),
    val thumbnails: List<PipedThumb> = emptyList(),
)

@Serializable
data class InvidiousFormat(
    val type: String? = null,
    val url: String? = null,
    val bitrate: Long? = null,
    val audioQuality: String? = null,
    /** e.g. "1080p" / "720p60" on video entries. */
    val qualityLabel: String? = null,
    val quality: String? = null,
    val contentLength: JsonElement? = null,
    val size: JsonElement? = null,
)

@Serializable
data class InvidiousVideoResponse(
    val adaptiveFormats: List<InvidiousFormat> = emptyList(),
    val recommendedVideos: List<InvidiousSearchItem> = emptyList(),
    val recommendations: List<InvidiousSearchItem> = emptyList(),
)

/** LRCLIB record wire shape (`trackName`, `artistName`, … camelCase). */
@Serializable
data class LrclibRecordWire(
    val id: Long = 0,
    val trackName: String = "",
    val artistName: String = "",
    val albumName: String? = null,
    val duration: Int? = null,
    val plainLyrics: String? = null,
    val syncedLyrics: String? = null,
    val instrumental: Boolean = false,
)

/* ── decoders ───────────────────────────────────────────────────────────── */

private val json = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private fun JsonElement?.decimalText(): String? =
    (this as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() }

private fun PipedThumb.toMap(): Map<String, Any?> =
    mapOf("url" to (url ?: ""), "width" to width, "height" to height)

/** Shared `_item_to_track` (piped_source.py) with `watch?v=`/id fallbacks. */
private fun pipedItemToTrack(item: PipedSearchItem, category: String): Track? {
    val vid = VideoIds.fromUrl(item.url) ?: item.id?.takeIf { it.isNotBlank() }
    if (vid == null) return null
    val thumbs: List<Map<String, Any?>> = when {
        item.thumbnails.isNotEmpty() -> item.thumbnails.map { it.toMap() }
        !item.thumbnail.isNullOrBlank() -> listOf(mapOf("url" to item.thumbnail))
        else -> emptyList()
    }
    return TrackNormalize.track(
        videoId = vid,
        title = item.title.orEmpty(),
        artists = listOf(
            mapOf("name" to (item.uploaderName ?: item.uploader ?: "Unknown")),
        ),
        source = "piped",
        duration = item.duration ?: item.lengthSeconds,
        artwork = TrackNormalize.bestThumb(thumbs),
        category = category,
    )
}

private fun invidiousItemToTrack(item: InvidiousSearchItem, category: String): Track? {
    val vid = item.videoId ?: item.id
    if (vid.isNullOrBlank()) return null
    val thumbs = (item.videoThumbnails.ifEmpty { item.thumbnails }).map { it.toMap() }
    return TrackNormalize.track(
        videoId = vid,
        title = item.title.orEmpty(),
        artists = listOf(
            mapOf(
                "name" to (item.author ?: item.uploader ?: "Unknown"),
                "channel_id" to item.authorId,
            ),
        ),
        source = "invidious",
        duration = item.lengthSeconds,
        artwork = TrackNormalize.bestThumb(thumbs),
        category = category,
    )
}

object PipedParsing {
    fun search(body: String, limit: Int): List<Track> {
        val resp = json.decodeFromString(PipedSearchResponse.serializer(), body)
        return resp.items.mapNotNull { pipedItemToTrack(it, category = "song") }.take(limit)
    }

    fun suggestions(body: String, limit: Int): List<String> =
        json.decodeFromString(PipedSuggestResponse.serializer(), body).suggestions.take(limit)

    /** `/trending` returns a bare search-item array (no envelope). */
    fun trending(body: String, limit: Int): List<Track> =
        json.decodeFromString<List<PipedSearchItem>>(body)
            .mapNotNull { pipedItemToTrack(it, category = "video") }
            .take(limit)

    fun streams(body: String): Pair<List<StreamCandidate>, List<Track>> {
        val resp = json.decodeFromString(PipedStreamsResponse.serializer(), body)
        val audio = resp.audioStreams.mapNotNull { a ->
            StreamNormalize.fromPipedAudio(
                url = a.url,
                mimeType = a.mimeType,
                quality = a.quality,
                bitrateBps = a.bitrate,
                contentLength = a.contentLength.decimalText(),
            )
        }
        val video = resp.videoStreams.mapNotNull { v ->
            StreamNormalize.videoCandidate(
                source = "piped",
                url = v.url,
                mime = v.mimeType ?: "video/mp4",
                quality = v.quality,
                width = v.width,
                height = v.height,
                videoOnly = v.videoOnly ?: true,
                sizeValue = v.contentLength.decimalText(),
            )
        }
        val candidates = StreamNormalize.sortCandidates(audio) + video
        val related = resp.relatedStreams.mapNotNull { pipedItemToTrack(it, category = "video") }
        return candidates to related
    }
}

object InvidiousParsing {
    private fun searchItems(body: String): List<InvidiousSearchItem> =
        if (body.trimStart().startsWith("[")) {
            json.parseToJsonElement(body).jsonArray.map {
                json.decodeFromJsonElement(InvidiousSearchItem.serializer(), it)
            }
        } else {
            val root = json.parseToJsonElement(body).jsonObject
            root["items"]?.jsonArray?.map {
                json.decodeFromJsonElement(InvidiousSearchItem.serializer(), it)
            } ?: emptyList()
        }

    fun search(body: String, limit: Int): List<Track> =
        searchItems(body).mapNotNull { invidiousItemToTrack(it, category = "video") }.take(limit)

    /** `/api/v1/trending?region=` — same tolerant item shape as search. */
    fun trending(body: String, limit: Int): List<Track> =
        searchItems(body).mapNotNull { invidiousItemToTrack(it, category = "video") }.take(limit)

    fun streams(body: String): Pair<List<StreamCandidate>, List<Track>> {
        val resp = json.decodeFromString(InvidiousVideoResponse.serializer(), body)
        val audio = resp.adaptiveFormats
            .filter { f -> f.type?.startsWith("audio") == true }
            .mapNotNull { f ->
                StreamNormalize.fromInvidiousAudio(
                    url = f.url,
                    type = f.type,
                    audioQuality = f.audioQuality,
                    bitrateBps = f.bitrate,
                    size = f.contentLength.decimalText() ?: f.size.decimalText(),
                )
            }
        // Adaptive formats are video-only by definition (N7 downloads).
        val video = resp.adaptiveFormats
            .filter { f -> f.type?.startsWith("video") == true }
            .mapNotNull { f ->
                val label = f.qualityLabel ?: f.quality
                StreamNormalize.videoCandidate(
                    source = "invidious",
                    url = f.url,
                    mime = f.type ?: "video/mp4",
                    quality = label,
                    width = null,
                    height = local.themashup.music.core.domain.heightFromLabel(label),
                    videoOnly = true,
                    sizeValue = f.contentLength.decimalText() ?: f.size.decimalText(),
                )
            }
        val candidates = StreamNormalize.sortCandidates(audio) + video
        val relatedItems = resp.recommendedVideos.ifEmpty { resp.recommendations }
        val related = relatedItems.mapNotNull { invidiousItemToTrack(it, category = "video") }
        return candidates to related
    }
}

object LrclibParsing {
    fun search(body: String): List<LrclibRecord> =
        json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(LrclibRecordWire.serializer()), body)
            .map { it.toDomain() }

    /** `/api/get` returns a single object (or a JSON error body — handled by client status). */
    fun get(body: String): LrclibRecord =
        json.decodeFromString(LrclibRecordWire.serializer(), body).toDomain()

    private fun LrclibRecordWire.toDomain() = LrclibRecord(
        id = id,
        trackName = trackName,
        artistName = artistName,
        albumName = albumName,
        duration = duration,
        plainLyrics = plainLyrics,
        syncedLyrics = syncedLyrics,
        instrumental = instrumental,
    )
}
