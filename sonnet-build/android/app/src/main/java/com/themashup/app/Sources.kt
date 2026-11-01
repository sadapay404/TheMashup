package com.themashup.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Public catalog sources with failover: Piped mirrors -> Invidious mirrors -> iTunes (metadata + 30s preview).
 * Lyrics come from lrclib.net. Every function is blocking; call from Dispatchers.IO.
 */
object Sources {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val piped = listOf(
        "https://api.piped.private.coffee", "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de", "https://pipedapi.leptons.xyz",
    )
    private val invidious = listOf("https://yewtu.be", "https://inv.nadeko.net", "https://invidious.nerdvpn.de")

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    fun get(url: String, headers: Map<String, String> = emptyMap()): String {
        val rb = Request.Builder().url(url).header("User-Agent", "TheMashup/1.0")
        headers.forEach { (k, v) -> rb.header(k, v) }
        client.newCall(rb.build()).execute().use { r ->
            if (!r.isSuccessful) error("HTTP ${r.code}")
            return r.body?.string() ?: error("empty body")
        }
    }

    private fun <T : Any> failover(bases: List<String>, path: String, parse: (String) -> T?): Pair<T, String>? {
        for (b in bases) {
            try {
                val v = parse(get(b + path))
                if (v != null) return v to b
            } catch (_: Exception) { /* next mirror */ }
        }
        return null
    }

    private fun host(u: String) = runCatching { URI(u).host }.getOrNull() ?: u
    private fun videoId(url: String?): String? = url?.substringAfter("v=", "")?.substringBefore("&")?.ifEmpty { null }
    private fun art(u: String?, size: Int = 400) = u?.replace("100x100bb", "${size}x${size}bb")

    /* ---------- iTunes ---------- */
    private fun itunes(term: String, entity: String, limit: Int = 20): List<JSONObject> =
        JSONObject(get("https://itunes.apple.com/search?term=${enc(term)}&entity=$entity&limit=$limit"))
            .optJSONArray("results")?.objects() ?: emptyList()

    private fun itunesTrack(o: JSONObject): Track? {
        if (!o.has("trackId")) return null
        return Track(
            id = "it:${o.getLong("trackId")}",
            title = o.optString("trackName"),
            artist = o.optString("artistName", "Unknown"),
            album = o.optString("collectionName").ifEmpty { null },
            artwork = art(o.optString("artworkUrl100").ifEmpty { null }),
            duration = if (o.has("trackTimeMillis")) (o.getLong("trackTimeMillis") / 1000).toInt() else null,
            previewUrl = o.optString("previewUrl").ifEmpty { null },
        )
    }

    /* ---------- search ---------- */
    private fun catalogSongs(q: String, via: MutableList<String>): List<Track> {
        failover(piped, "/search?q=${enc(q)}&filter=music_songs") { body ->
            val items = JSONObject(body).optJSONArray("items")?.objects()
            if (items.isNullOrEmpty()) null else items
        }?.let { (items, base) ->
            val out = items.mapNotNull { i ->
                val id = videoId(i.optString("url")) ?: return@mapNotNull null
                val dur = i.optInt("duration", -1)
                Track(
                    id = "yt:$id", title = i.optString("title"),
                    artist = i.optString("uploaderName", "Unknown").removeSuffix(" - Topic"),
                    artwork = i.optString("thumbnail").ifEmpty { null },
                    duration = if (dur > 0) dur else null,
                )
            }
            if (out.isNotEmpty()) { via += host(base); return out }
        }
        failover(invidious, "/api/v1/search?q=${enc(q)}&type=video") { body ->
            val a = JSONArray(body).objects()
            if (a.isEmpty()) null else a
        }?.let { (items, base) ->
            via += host(base)
            return items.take(20).map { v ->
                Track(
                    id = "yt:${v.getString("videoId")}", title = v.optString("title"),
                    artist = v.optString("author").removeSuffix(" - Topic"),
                    artwork = "https://i.ytimg.com/vi/${v.getString("videoId")}/hqdefault.jpg",
                    duration = v.optInt("lengthSeconds"),
                )
            }
        }
        return runCatching {
            itunes(q, "song").mapNotNull { itunesTrack(it) }.also { via += "itunes" }
        }.getOrDefault(emptyList())
    }

    private fun bestLine(lyrics: String, q: String): String? {
        val words = q.lowercase().split(Regex("\\s+")).filter { it.length > 2 }
        if (words.isEmpty()) return null
        return lyrics.lines().map { it.replace(Regex("\\[[^\\]]*\\]"), "").trim() }.filter { it.isNotEmpty() }
            .map { l -> l to words.count { l.lowercase().contains(it) } }
            .filter { it.second > 0 }.maxByOrNull { it.second }?.first
    }

    private fun lyricSearch(q: String): List<Track> = runCatching {
        JSONArray(get("https://lrclib.net/api/search?q=${enc(q)}")).objects().take(12).map { i ->
            val body = i.optString("syncedLyrics").ifEmpty { i.optString("plainLyrics") }
            Track(
                id = "lr:${i.getLong("id")}", title = i.optString("trackName"), artist = i.optString("artistName"),
                album = i.optString("albumName").ifEmpty { null },
                duration = i.optDouble("duration", 0.0).toInt().takeIf { it > 0 },
                lyricLine = bestLine(body, q),
            )
        }
    }.getOrDefault(emptyList())

    /** Dual-mode search: catalog + lyric index in parallel, merged. */
    suspend fun search(q: String): SearchResult = coroutineScope {
        val via = mutableListOf<String>()
        val songsD = async(Dispatchers.IO) { catalogSongs(q, via) }
        val lyricsD = async(Dispatchers.IO) { lyricSearch(q) }
        val aaD = async(Dispatchers.IO) {
            runCatching {
                val artists = itunes(q, "musicArtist", 6).filter { it.has("artistId") }.map { Artist(it.getLong("artistId").toString(), it.optString("artistName")) }
                val albums = itunes(q, "album", 8).filter { it.has("collectionId") }.map {
                    Album(it.getLong("collectionId").toString(), it.optString("collectionName"), it.optString("artistName"), art(it.optString("artworkUrl100").ifEmpty { null }))
                }
                artists to albums
            }.getOrDefault(emptyList<Artist>() to emptyList<Album>())
        }
        val songs = songsD.await()
        val seen = songs.map { "${it.title}|${it.artist}".lowercase() }.toSet()
        val lyrics = lyricsD.await().filter { "${it.title}|${it.artist}".lowercase() !in seen }
        val (artists, albums) = aaD.await()
        SearchResult(
            songs, lyrics, artists, albums, via.toList(),
            if (songs.isEmpty() && lyrics.isEmpty() && artists.isEmpty()) "No sources responded. Check your connection and try again." else null,
        )
    }

    suspend fun suggest(q: String): List<String> = withContext(Dispatchers.IO) {
        failover(piped, "/suggestions?query=${enc(q)}") { b -> JSONArray(b).let { a -> if (a.length() == 0) null else (0 until a.length()).map { a.getString(it) } } }
            ?.first?.take(8)
            ?: failover(invidious, "/api/v1/search/suggestions?q=${enc(q)}") { b ->
                JSONObject(b).optJSONArray("suggestions")?.let { a -> if (a.length() == 0) null else (0 until a.length()).map { a.getString(it) } }
            }?.first?.take(8)
            ?: emptyList()
    }

    suspend fun trending(): List<Track> = withContext(Dispatchers.IO) {
        runCatching {
            val entries = JSONObject(get("https://itunes.apple.com/us/rss/topsongs/limit=24/json")).getJSONObject("feed").getJSONArray("entry").objects()
            entries.map { e ->
                val imgs = e.getJSONArray("im:image")
                val link = e.opt("link")
                val links = if (link is JSONArray) link.objects() else listOfNotNull(link as? JSONObject)
                val preview = links.map { it.getJSONObject("attributes") }.firstOrNull { it.optString("type").startsWith("audio") }?.optString("href")
                Track(
                    id = "it:${e.getJSONObject("id").getJSONObject("attributes").getString("im:id")}",
                    title = e.getJSONObject("im:name").getString("label"),
                    artist = e.getJSONObject("im:artist").getString("label"),
                    artwork = imgs.getJSONObject(imgs.length() - 1).getString("label").replace(Regex("\\d+x\\d+bb"), "400x400bb"),
                    previewUrl = preview,
                )
            }
        }.getOrDefault(emptyList())
    }

    suspend fun related(t: Track): List<Track> = withContext(Dispatchers.IO) {
        catalogSongs(t.artist, mutableListOf()).filter { it.id != t.id && it.title != t.title }.take(15)
    }

    /* ---------- stream resolution with failover ---------- */
    fun resolveStream(t: Track, bitrateKbps: Int = 320, video: Boolean = false): Resolved? {
        var vid = if (t.id.startsWith("yt:")) t.id.removePrefix("yt:") else null
        if (vid == null) {
            vid = catalogSongs("${t.artist} ${t.title}", mutableListOf()).firstOrNull { it.id.startsWith("yt:") }?.id?.removePrefix("yt:")
        }
        val target = bitrateKbps * 1000
        if (vid != null) {
            failover(piped, "/streams/$vid") { b ->
                val o = JSONObject(b)
                if ((o.optJSONArray("audioStreams")?.length() ?: 0) > 0 || (o.optJSONArray("videoStreams")?.length() ?: 0) > 0) o else null
            }?.let { (o, base) ->
                if (video) {
                    o.optJSONArray("videoStreams")?.objects()?.firstOrNull { !it.optBoolean("videoOnly") && it.optString("mimeType").contains("mp4") }
                        ?.let { return Resolved(it.getString("url"), "video", host(base)) }
                } else {
                    val audio = o.optJSONArray("audioStreams")?.objects()
                    if (!audio.isNullOrEmpty()) {
                        val sorted = audio.sortedBy { kotlin.math.abs(it.optInt("bitrate") - target) }
                        val pick = sorted.firstOrNull { it.optString("mimeType").contains("mp4") } ?: sorted.first()
                        return Resolved(pick.getString("url"), "full", host(base))
                    }
                }
            }
            if (!video) {
                failover(invidious, "/api/v1/videos/$vid?local=true") { b ->
                    JSONObject(b).optJSONArray("adaptiveFormats")?.objects()?.filter { it.optString("type").startsWith("audio/") }?.takeIf { it.isNotEmpty() }
                }?.let { (formats, base) ->
                    val pick = formats.minByOrNull { kotlin.math.abs(it.optString("bitrate").toIntOrNull()?.minus(target) ?: Int.MAX_VALUE) } ?: formats.first()
                    val u = pick.getString("url")
                    return Resolved(if (u.startsWith("http")) u else base + u, "full", host(base))
                }
            }
        }
        if (video) return null
        val preview = t.previewUrl ?: runCatching {
            itunes("${t.artist} ${t.title}", "song", 3).firstOrNull { it.has("previewUrl") }?.optString("previewUrl")
        }.getOrNull()
        return preview?.let { Resolved(it, "preview", "itunes-preview") }
    }

    /* ---------- lyrics ---------- */
    private fun parseLrc(src: String): List<LyricLine> {
        val out = mutableListOf<LyricLine>()
        val stamp = Regex("\\[(\\d+):(\\d+(?:\\.\\d+)?)]")
        for (raw in src.lines()) {
            val stamps = stamp.findAll(raw).toList()
            if (stamps.isEmpty()) continue
            val text = raw.replace(Regex("\\[[^\\]]*]"), "").trim()
            stamps.forEach { out += LyricLine(it.groupValues[1].toDouble() * 60 + it.groupValues[2].toDouble(), text) }
        }
        return out.sortedBy { it.t }
    }

    private fun lyricsFrom(o: JSONObject) = Lyrics(
        synced = o.optString("syncedLyrics").takeIf { it.isNotEmpty() && it != "null" }?.let { parseLrc(it) } ?: emptyList(),
        plain = o.optString("plainLyrics").takeIf { it != "null" } ?: "",
    )

    suspend fun lyrics(t: Track): Lyrics = withContext(Dispatchers.IO) {
        runCatching {
            var u = "https://lrclib.net/api/get?track_name=${enc(t.title)}&artist_name=${enc(t.artist)}"
            t.duration?.let { u += "&duration=$it" }
            lyricsFrom(JSONObject(get(u)))
        }.getOrElse {
            runCatching {
                val list = JSONArray(get("https://lrclib.net/api/search?q=${enc("${t.artist} ${t.title}")}")).objects()
                val hit = list.firstOrNull { it.optString("syncedLyrics").isNotEmpty() && it.optString("syncedLyrics") != "null" } ?: list.firstOrNull()
                hit?.let { lyricsFrom(it) } ?: Lyrics()
            }.getOrDefault(Lyrics())
        }
    }

    /* ---------- account ---------- */
    /** Verifies a YouTube Music session cookie with the account endpoint. Returns the account name or null. */
    suspend fun verifyCookie(cookie: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val sapisid = Regex("(?:^|;\\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)").find(cookie)?.groupValues?.get(1)
                ?: error("Cookie is missing SAPISID.")
            val ts = System.currentTimeMillis() / 1000
            val origin = "https://music.youtube.com"
            val hash = MessageDigest.getInstance("SHA-1").digest("$ts $sapisid $origin".toByteArray()).joinToString("") { "%02x".format(it) }
            val body = """{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"1.20240101.01.00","hl":"en"}}}"""
            val req = Request.Builder().url("https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false")
                .header("Cookie", cookie).header("Origin", origin).header("X-Origin", origin)
                .header("Authorization", "SAPISIDHASH ${ts}_$hash")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")
                .post(body.toRequestBody("application/json".toMediaType())).build()
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) error("Account endpoint returned HTTP ${r.code}")
                val text = r.body?.string().orEmpty()
                Regex("\"accountName\":\\{\"runs\":\\[\\{\"text\":\"([^\"]+)\"").find(text)?.groupValues?.get(1)
                    ?: error("Session was not recognized (signed out or expired).")
            }
        }
    }
}
