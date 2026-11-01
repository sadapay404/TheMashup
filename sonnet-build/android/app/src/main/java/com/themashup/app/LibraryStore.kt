package com.themashup.app

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class LibraryData(
    val liked: List<Track> = emptyList(),
    val history: List<Track> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
    val downloads: List<DownloadedTrack> = emptyList(),
)

/** Playlists, liked songs, history and finished downloads persisted as one JSON file. */
class LibraryStore(ctx: Context, private val scope: CoroutineScope) {
    private val file = File(ctx.filesDir, "library.json")
    private val _data = MutableStateFlow(LibraryData())
    val data: StateFlow<LibraryData> = _data

    init {
        runCatching { if (file.exists()) _data.value = parse(file.readText()) }
    }

    private fun parse(s: String): LibraryData {
        val o = JSONObject(s)
        fun tracks(a: JSONArray?) = a?.objects()?.map { Track.fromJson(it) } ?: emptyList()
        return LibraryData(
            liked = tracks(o.optJSONArray("liked")),
            history = tracks(o.optJSONArray("history")),
            playlists = o.optJSONArray("playlists")?.objects()?.map {
                Playlist(it.getLong("id"), it.getString("name"), tracks(it.optJSONArray("tracks")))
            } ?: emptyList(),
            downloads = o.optJSONArray("downloads")?.objects()?.map {
                DownloadedTrack(Track.fromJson(it.getJSONObject("track")), it.optString("quality"), it.getString("path"), it.optLong("size"))
            }?.filter { File(it.path).exists() } ?: emptyList(),
        )
    }

    private fun save() {
        val d = _data.value
        scope.launch(Dispatchers.IO) {
            runCatching {
                val o = JSONObject()
                o.put("liked", JSONArray(d.liked.map { it.toJson() }))
                o.put("history", JSONArray(d.history.map { it.toJson() }))
                o.put("playlists", JSONArray(d.playlists.map { p ->
                    JSONObject().put("id", p.id).put("name", p.name).put("tracks", JSONArray(p.tracks.map { it.toJson() }))
                }))
                o.put("downloads", JSONArray(d.downloads.map {
                    JSONObject().put("track", it.track.toJson()).put("quality", it.quality).put("path", it.path).put("size", it.size)
                }))
                file.writeText(o.toString())
            }
        }
    }

    private fun mutate(f: (LibraryData) -> LibraryData) {
        _data.update(f)
        save()
    }

    fun isLiked(id: String) = _data.value.liked.any { it.id == id }
    fun toggleLike(t: Track) = mutate { d ->
        if (d.liked.any { it.id == t.id }) d.copy(liked = d.liked.filter { it.id != t.id }) else d.copy(liked = listOf(t) + d.liked)
    }

    fun addHistory(t: Track) = mutate { d -> d.copy(history = (listOf(t) + d.history).take(50)) }
    fun clearHistory() = mutate { it.copy(history = emptyList()) }

    fun createPlaylist(name: String): Long {
        val id = System.currentTimeMillis()
        mutate { it.copy(playlists = it.playlists + Playlist(id, name.trim(), emptyList())) }
        return id
    }

    fun renamePlaylist(id: Long, name: String) = mutate { d ->
        d.copy(playlists = d.playlists.map { if (it.id == id) it.copy(name = name.trim()) else it })
    }

    fun deletePlaylist(id: Long) = mutate { d -> d.copy(playlists = d.playlists.filter { it.id != id }) }

    fun addToPlaylist(id: Long, t: Track) = mutate { d ->
        d.copy(playlists = d.playlists.map { p ->
            if (p.id == id && p.tracks.none { it.id == t.id }) p.copy(tracks = p.tracks + t) else p
        })
    }

    fun removeFromPlaylist(id: Long, trackId: String) = mutate { d ->
        d.copy(playlists = d.playlists.map { p -> if (p.id == id) p.copy(tracks = p.tracks.filter { it.id != trackId }) else p })
    }

    fun addDownload(dt: DownloadedTrack) = mutate { d ->
        d.copy(downloads = listOf(dt) + d.downloads.filter { !(it.track.id == dt.track.id && it.quality == dt.quality) })
    }

    fun removeDownload(dt: DownloadedTrack) {
        runCatching { File(dt.path).delete() }
        mutate { d -> d.copy(downloads = d.downloads.filter { it.path != dt.path }) }
    }

    fun downloadedPath(trackId: String): String? =
        _data.value.downloads.firstOrNull { it.track.id == trackId && File(it.path).exists() }?.path
}
