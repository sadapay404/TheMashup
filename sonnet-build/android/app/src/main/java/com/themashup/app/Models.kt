package com.themashup.app

import org.json.JSONArray
import org.json.JSONObject

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val artwork: String? = null,
    val duration: Int? = null,
    val previewUrl: String? = null,
    val lyricLine: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("title", title); put("artist", artist)
        album?.let { put("album", it) }
        artwork?.let { put("artwork", it) }
        duration?.let { put("duration", it) }
        previewUrl?.let { put("previewUrl", it) }
    }

    companion object {
        fun fromJson(o: JSONObject) = Track(
            id = o.getString("id"),
            title = o.optString("title"),
            artist = o.optString("artist"),
            album = o.optString("album").ifEmpty { null },
            artwork = o.optString("artwork").ifEmpty { null },
            duration = if (o.has("duration")) o.optInt("duration") else null,
            previewUrl = o.optString("previewUrl").ifEmpty { null },
        )
    }
}

data class Artist(val id: String, val name: String)
data class Album(val id: String, val title: String, val artist: String, val artwork: String?)

data class SearchResult(
    val songs: List<Track> = emptyList(),
    val lyrics: List<Track> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val albums: List<Album> = emptyList(),
    val via: List<String> = emptyList(),
    val error: String? = null,
)

data class Resolved(val url: String, val kind: String, val via: String)
data class LyricLine(val t: Double, val text: String)
data class Lyrics(val synced: List<LyricLine> = emptyList(), val plain: String = "")

enum class PState { IDLE, LOADING, PLAYING, PAUSED, ERROR, STOPPED }
enum class Repeat { OFF, ALL, ONE }

data class Playlist(val id: Long, val name: String, val tracks: List<Track>)
data class DownloadedTrack(val track: Track, val quality: String, val path: String, val size: Long)

enum class JobStatus { QUEUED, DOWNLOADING, PAUSED, CONVERTING, DONE, ERROR, CANCELLED }
data class DownloadJob(
    val id: String,
    val track: Track,
    val quality: String,
    val status: JobStatus = JobStatus.QUEUED,
    val received: Long = 0,
    val total: Long = 0,
    val error: String? = null,
)

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
