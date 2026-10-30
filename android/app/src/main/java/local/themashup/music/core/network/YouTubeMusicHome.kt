package local.themashup.music.core.network

import java.io.IOException
import java.security.MessageDigest
import kotlinx.serialization.json.*
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.ArtistRef
import local.themashup.music.core.network.logic.TrackNormalize
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Authenticated WEB_REMIX account and browse calls. The WebView is only for sign-in. */
class YouTubeMusicHome(client: okhttp3.OkHttpClient = newNetworkClient()) {
    // Never forward a session credential across a redirect.
    private val client = client.newBuilder().followRedirects(false).followSslRedirects(false).build()

    /** A SAPISID alone can exist in an anonymous cookie jar; check the account menu. */
    fun verify(cookie: String) {
        val response = post(cookie, "account/account_menu", """{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"$CLIENT_VERSION","hl":"en"}}}""")
        if (!hasAccountIdentity(response))
            throw IOException("Could not verify the signed-in YouTube account. Please sign in again.")
    }

    fun load(cookie: String): List<MusicHomeShelf> {
        verify(cookie)
        val response = browse(cookie, "FEmusic_home")
        return MusicHomeParser.parse(response).ifEmpty {
            throw IOException("YouTube Music returned no recommendations. Retry or reconnect your account.")
        }
    }

    /** Expand an album/playlist inline on Home, without creating a playback queue. */
    fun loadCollection(cookie: String, browseId: String): List<Track> =
        MusicHomeParser.parseCollection(browse(cookie, browseId))

    private fun browse(cookie: String, browseId: String): JsonElement {
        val body = buildJsonObject {
            put("context", buildJsonObject {
                put("client", buildJsonObject {
                    put("clientName", "WEB_REMIX")
                    put("clientVersion", CLIENT_VERSION)
                    put("hl", "en")
                })
            })
            put("browseId", browseId)
        }.toString()
        return post(cookie, "browse", body)
    }

    private fun post(cookie: String, endpoint: String, body: String): JsonElement {
        val sapisid = sessionId(cookie) ?: throw IOException("Please reconnect your YouTube account")
        val time = System.currentTimeMillis() / 1000
        val hash = MessageDigest.getInstance("SHA-1")
            .digest("$time $sapisid https://music.youtube.com".toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val req = Request.Builder()
            .url("https://music.youtube.com/youtubei/v1/$endpoint?key=$API_KEY&prettyPrint=false")
            .header("Cookie", cookie)
            .header("Authorization", "SAPISIDHASH ${time}_$hash")
            .header("Origin", "https://music.youtube.com")
            .header("X-Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .header("X-Goog-Api-Format-Version", "1")
            .header("X-Goog-AuthUser", "0")
            .header("X-YouTube-Client-Name", "67")
            .header("X-YouTube-Client-Version", CLIENT_VERSION)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0")
            .post(body.toRequestBody("application/json".toMediaType())).build()
        client.newCall(req).execute().use { response ->
            if (!response.isSuccessful) throw IOException("YouTube Music returned HTTP ${response.code}; reconnect or retry")
            val text = response.body?.string() ?: throw IOException("Empty YouTube Music response")
            val root = try { Json.parseToJsonElement(text) } catch (_: Exception) {
                throw IOException("YouTube Music returned an invalid response")
            }
            val context = (root as? JsonObject)?.get("responseContext") as? JsonObject
            val webContext = context?.get("mainAppWebResponseContext") as? JsonObject
            if ((webContext?.get("loggedOut") as? JsonPrimitive)?.booleanOrNull == true)
                throw IOException("Your YouTube session has expired. Reconnect your account.")
            return root
        }
    }

    private fun hasAccountIdentity(node: JsonElement): Boolean = when (node) {
        is JsonObject -> {
            val account = node["activeAccountHeaderRenderer"] as? JsonObject
            (account != null && listOf("accountName", "email", "channelHandle").any {
                account[it]?.let(::hasNonblankText) == true
            }) || node.values.any(::hasAccountIdentity)
        }
        is JsonArray -> node.any(::hasAccountIdentity)
        else -> false
    }

    private fun hasNonblankText(node: JsonElement): Boolean = when (node) {
        is JsonObject -> (node["text"] as? JsonPrimitive)?.contentOrNull?.isNotBlank() == true ||
            (node["simpleText"] as? JsonPrimitive)?.contentOrNull?.isNotBlank() == true || node.values.any(::hasNonblankText)
        is JsonArray -> node.any(::hasNonblankText)
        else -> false
    }

    companion object {
        private const val CLIENT_VERSION = "1.20260707.12.00"
        private const val API_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30"
        fun sessionId(cookie: String): String? {
            val entries = cookie.split(';').mapNotNull { part ->
                val pair = part.trim().split('=', limit = 2)
                if (pair.size == 2) pair[0] to pair[1].trim() else null
            }.toMap()
            return listOf("SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID")
                .firstNotNullOfOrNull { entries[it]?.takeIf(String::isNotBlank) }
        }
    }
}

sealed interface MusicHomeItem {
    data class Song(val track: Track) : MusicHomeItem
    data class Collection(val browseId: String, val title: String, val artwork: String?) : MusicHomeItem
}
data class MusicHomeShelf(val title: String, val items: List<MusicHomeItem>)

/** Parse song and collection navigation endpoints, never a playlist's menu as a song. */
object MusicHomeParser {
    fun parse(body: String): List<MusicHomeShelf> = parse(Json.parseToJsonElement(body))

    fun parse(root: JsonElement): List<MusicHomeShelf> {
        val shelves = mutableListOf<MusicHomeShelf>()
        fun walk(node: JsonElement) {
            when (node) {
                is JsonObject -> node.forEach { (key, value) ->
                    if (key == "musicCarouselShelfRenderer" || key == "musicShelfRenderer") {
                        val shelf = value as? JsonObject ?: return@forEach
                        val header = (shelf["header"] as? JsonObject)?.get("musicCarouselShelfBasicHeaderRenderer") as? JsonObject
                        val title = header?.get("title")?.let(::findText)
                            ?: shelf["title"]?.let(::findText) ?: "Recommended for you"
                        val items = mutableListOf<MusicHomeItem>()
                        shelf["contents"]?.let { collectItems(it, items) }
                        val unique = items.distinctBy {
                            when (it) {
                                is MusicHomeItem.Song -> "song:${it.track.id}"
                                is MusicHomeItem.Collection -> "collection:${it.browseId}"
                            }
                        }
                        if (unique.isNotEmpty()) shelves += MusicHomeShelf(title, unique)
                    } else walk(value)
                }
                is JsonArray -> node.forEach(::walk)
                else -> Unit
            }
        }
        walk(root)
        return shelves
    }

    fun parseCollection(root: JsonElement): List<Track> {
        val result = mutableListOf<MusicHomeItem>()
        collectItems(root, result)
        val header = findObject(root, "musicResponsiveHeaderRenderer") ?: findObject(root, "musicDetailHeaderRenderer")
        val isAlbum = header?.get("subtitle")?.let(::findText)?.contains("Album", ignoreCase = true) == true
        val albumArtist = if (isAlbum) header?.get("straplineTextOne")?.let(::findText) else null
        val albumTitle = if (isAlbum) header?.get("title")?.let(::findText) else null
        val albumArt = if (isAlbum) header?.get("thumbnail")?.let(::findThumbnail) else null
        return result.filterIsInstance<MusicHomeItem.Song>().map { song ->
            val track = song.track
            val art = track.artwork ?: albumArt ?: "https://i.ytimg.com/vi/${track.id}/hqdefault.jpg"
            val artist = albumArtist?.takeIf { track.artistNames == "Unknown artist" }
            track.copy(artwork = art, artworkBest = art, album = track.album ?: albumTitle,
                artistNames = artist ?: track.artistNames,
                artists = if (artist != null) listOf(ArtistRef(name = artist)) else track.artists)
        }.distinctBy { it.id }
    }

    private fun findObject(node: JsonElement, key: String): JsonObject? = when (node) {
        is JsonObject -> (node[key] as? JsonObject) ?: node.values.firstNotNullOfOrNull { findObject(it, key) }
        is JsonArray -> node.firstNotNullOfOrNull { findObject(it, key) }
        else -> null
    }

    private fun collectItems(node: JsonElement, items: MutableList<MusicHomeItem>) {
        when (node) {
            is JsonObject -> node.forEach { (key, value) ->
                if (key == "musicTwoRowItemRenderer" || key == "musicResponsiveListItemRenderer") {
                    parseItem(value)?.let { items += it }
                } else collectItems(value, items)
            }
            is JsonArray -> node.forEach { collectItems(it, items) }
            else -> Unit
        }
    }

    private fun parseItem(node: JsonElement): MusicHomeItem? {
        val item = node as? JsonObject ?: return null
        val title = item["title"]?.let(::findText)
            ?: (item["flexColumns"] as? JsonArray)?.firstOrNull()?.let(::findText) ?: return null
        val thumbnail = (item["thumbnailRenderer"] ?: item["thumbnail"])?.let(::findThumbnail)
        val navigation = item["navigationEndpoint"] as? JsonObject
        val browseId = ((navigation?.get("browseEndpoint") as? JsonObject)?.get("browseId") as? JsonPrimitive)?.contentOrNull
        // Album/playlist browse endpoints are not playable videos, even when a menu has watch endpoints.
        if (browseId != null) {
            return if (browseId.startsWith("VL") || browseId.startsWith("MPRE"))
                MusicHomeItem.Collection(browseId, title, thumbnail) else null
        }
        val direct = ((navigation?.get("watchEndpoint") as? JsonObject)?.get("videoId") as? JsonPrimitive)?.contentOrNull
        val playlistItem = ((item["playlistItemData"] as? JsonObject)?.get("videoId") as? JsonPrimitive)?.contentOrNull
        val overlay = item["overlay"] ?: item["thumbnailOverlay"]
        val firstColumn = (item["flexColumns"] as? JsonArray)?.firstOrNull()
        val id = direct ?: playlistItem ?: firstColumn?.let(::findWatchId) ?: overlay?.let(::findWatchId) ?: return null
        if (!VIDEO_ID.matches(id)) return null
        val artist = item["subtitle"]?.let(::findText)
            ?: (item["flexColumns"] as? JsonArray)?.getOrNull(1)?.let(::findText)
            ?: "Unknown artist"
        return MusicHomeItem.Song(TrackNormalize.track(id, title, listOf(mapOf("name" to artist)), "ytmusic", artwork = thumbnail))
    }

    private fun findWatchId(node: JsonElement): String? = when (node) {
        is JsonObject -> ((node["watchEndpoint"] as? JsonObject)?.get("videoId") as? JsonPrimitive)?.contentOrNull
            ?: node.values.firstNotNullOfOrNull(::findWatchId)
        is JsonArray -> node.firstNotNullOfOrNull(::findWatchId)
        else -> null
    }
    private fun findText(node: JsonElement): String? = when (node) {
        is JsonObject -> (node["text"] as? JsonPrimitive)?.contentOrNull
            ?: (node["simpleText"] as? JsonPrimitive)?.contentOrNull
            ?: (node["runs"] as? JsonArray)?.mapNotNull { ((it as? JsonObject)?.get("text") as? JsonPrimitive)?.contentOrNull }
                ?.joinToString("")?.takeIf { it.isNotBlank() }
            ?: node.values.firstNotNullOfOrNull(::findText)
        is JsonArray -> node.firstNotNullOfOrNull(::findText)
        else -> null
    }
    private fun findThumbnail(node: JsonElement): String? = when (node) {
        is JsonObject -> (node["thumbnails"] as? JsonArray)?.lastOrNull()?.let {
            ((it as? JsonObject)?.get("url") as? JsonPrimitive)?.contentOrNull
        } ?: node.values.firstNotNullOfOrNull(::findThumbnail)
        is JsonArray -> node.firstNotNullOfOrNull(::findThumbnail)
        else -> null
    }
    private val VIDEO_ID = Regex("[A-Za-z0-9_-]{11}")
}
