package local.themashup.music.core.network

import java.io.IOException
import java.security.MessageDigest
import kotlinx.serialization.json.*
import local.themashup.music.core.domain.Track
import local.themashup.music.core.network.logic.TrackNormalize
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Authenticated music home, following InnerTune's WEB_REMIX browse flow. */
class YouTubeMusicHome(private val client: okhttp3.OkHttpClient = newNetworkClient().newBuilder().followRedirects(false).build()) {
    fun load(cookie: String): List<MusicHomeShelf> {
        val sapisid = cookie.split(';').map { it.trim() }.firstNotNullOfOrNull {
            it.substringAfter('=', "").takeIf { _ -> it.substringBefore('=') == "SAPISID" }
        }?.takeIf { it.isNotBlank() } ?: throw IOException("Please reconnect your YouTube account")
        val time = System.currentTimeMillis() / 1000
        val hash = MessageDigest.getInstance("SHA-1")
            .digest("$time $sapisid https://music.youtube.com".toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val body = """{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"1.20220606.03.00","hl":"en"}},"browseId":"FEmusic_home"}"""
        val req = Request.Builder()
            .url("https://music.youtube.com/youtubei/v1/browse?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30&prettyPrint=false")
            .header("Cookie", cookie)
            .header("Authorization", "SAPISIDHASH ${time}_$hash")
            .header("Origin", "https://music.youtube.com")
            .header("X-Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .header("X-YouTube-Client-Name", "67")
            .header("X-YouTube-Client-Version", "1.20220606.03.00")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36")
            .post(body.toRequestBody("application/json".toMediaType())).build()
        client.newCall(req).execute().use { response ->
            if (!response.isSuccessful) throw IOException("YouTube Music returned HTTP ${response.code}; reconnect or retry")
            val text = response.body?.string() ?: throw IOException("Empty YouTube Music response")
            return MusicHomeParser.parse(text).ifEmpty { throw IOException("No playable recommendations returned; retry or reconnect") }
        }
    }
}

data class MusicHomeShelf(val title: String, val tracks: List<Track>)

/** Pick only playable video IDs; playlists and albums are not misrepresented as songs. */
object MusicHomeParser {
    fun parse(body: String): List<MusicHomeShelf> {
        val root = Json.parseToJsonElement(body)
        val shelves = mutableListOf<MusicHomeShelf>()
        fun walk(node: JsonElement) {
            when (node) {
                is JsonObject -> {
                    for ((key, value) in node) {
                        if (key == "musicCarouselShelfRenderer" || key == "musicShelfRenderer") {
                            val shelf = value as? JsonObject ?: continue
                            val header = shelf["header"]?.let { findText(it) }
                                ?: shelf["title"]?.let { findText(it) } ?: "Recommended for you"
                            val tracks = mutableListOf<Track>()
                            fun collect(item: JsonElement) {
                                when (item) {
                                    is JsonObject -> item.forEach { (k, v) ->
                                        if (k == "musicTwoRowItemRenderer" || k == "musicResponsiveListItemRenderer") {
                                            parseTrack(v)?.let { tracks.add(it) }
                                        } else collect(v)
                                    }
                                    is JsonArray -> item.forEach(::collect)
                                    else -> Unit
                                }
                            }
                            shelf["contents"]?.let(::collect)
                            val unique = tracks.distinctBy { it.id }
                            if (unique.isNotEmpty()) shelves.add(MusicHomeShelf(header, unique))
                        } else walk(value)
                    }
                }
                is JsonArray -> node.forEach(::walk)
                else -> Unit
            }
        }
        walk(root)
        return shelves
    }

    private fun parseTrack(node: JsonElement): Track? {
        val item = node as? JsonObject ?: return null
        val id = findWatchId(item) ?: return null
        val title = item["title"]?.let(::findText)
            ?: item["flexColumns"]?.let(::findText) ?: return null
        val artist = item["subtitle"]?.let(::findText) ?: "Unknown artist"
        val thumbnail = findThumbnail(item)
        return TrackNormalize.track(id, title, listOf(mapOf("name" to artist)), "ytmusic", artwork = thumbnail)
    }
    private fun findWatchId(node: JsonElement): String? = when (node) {
        is JsonObject -> (node["watchEndpoint"] as? JsonObject)?.get("videoId")?.let { (it as? JsonPrimitive)?.content }
            ?: node.values.firstNotNullOfOrNull(::findWatchId)
        is JsonArray -> node.firstNotNullOfOrNull(::findWatchId)
        else -> null
    }
    private fun findText(node: JsonElement): String? = when (node) {
        is JsonObject -> (node["text"] as? JsonPrimitive)?.contentOrNull
            ?: (node["simpleText"] as? JsonPrimitive)?.contentOrNull
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
}
