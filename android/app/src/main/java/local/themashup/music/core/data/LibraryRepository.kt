package local.themashup.music.core.data

import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import local.themashup.music.core.domain.HeardEntry
import local.themashup.music.core.domain.LibraryData
import local.themashup.music.core.domain.Playlist
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.toHeard
import local.themashup.music.core.domain.toSerializable

/**
 * Likes / playlists / history / follows — persisted as one JSON document
 * (same contract as the web's local library store).
 */
class LibraryRepository(
    private val store: JsonFileStore<LibraryData>,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val _state = MutableStateFlow(LibraryData())
    val state: StateFlow<LibraryData> = _state.asStateFlow()

    /** Load once at startup (no-op if already hydrated). */
    fun startLoad() {
        scope.launch { load() }
    }

    /** Awaitable hydration — used by [startLoad] and tests. */
    suspend fun load() {
        _state.value = store.read()
    }

    /** Awaitable mutation: callers suspend until JSON is persisted. */
    private suspend fun mutate(fn: (LibraryData) -> LibraryData) {
        _state.value = store.update(fn)
    }

    /* ── likes ─────────────────────────────────────────────────────────── */

    fun isLiked(trackId: String): Boolean = _state.value.likes.any { it.id == trackId }

    suspend fun setLiked(track: Track, liked: Boolean) = mutate { data ->
        val likes = if (liked) {
            if (data.likes.any { it.id == track.id }) data.likes else data.likes + track
        } else {
            data.likes.filterNot { it.id == track.id }
        }
        data.copy(likes = likes)
    }

    /* ── playlists ─────────────────────────────────────────────────────── */

    suspend fun createPlaylist(name: String): Playlist {
        val playlist = Playlist(
            id = "pl-${System.currentTimeMillis()}-${(0 until 1_000_000).random()}",
            name = name.trim().ifEmpty { "Playlist" },
            createdAt = System.currentTimeMillis(),
        )
        mutate { it.copy(playlists = it.playlists + playlist) }
        return playlist
    }

    suspend fun renamePlaylist(playlistId: String, name: String) = mutate { data ->
        data.copy(
            playlists = data.playlists.map {
                if (it.id == playlistId) it.copy(name = name.trim().ifEmpty { it.name }) else it
            },
        )
    }

    suspend fun deletePlaylist(playlistId: String) = mutate { data ->
        data.copy(
            playlists = data.playlists.filterNot { it.id == playlistId },
            playlistTracks = data.playlistTracks - playlistId,
        )
    }

    suspend fun addTrackToPlaylist(playlistId: String, track: Track) = mutate { data ->
        val tracks = data.playlistTracks[playlistId].orEmpty()
        if (tracks.any { it.id == track.id }) data
        else data.copy(playlistTracks = data.playlistTracks + (playlistId to tracks + track))
    }

    suspend fun removeTrackFromPlaylist(playlistId: String, trackId: String) = mutate { data ->
        val tracks = data.playlistTracks[playlistId].orEmpty().filterNot { it.id == trackId }
        data.copy(playlistTracks = data.playlistTracks + (playlistId to tracks))
    }

    /** Drag-reorder (validated permutation — web parity). */
    suspend fun reorderPlaylist(playlistId: String, from: Int, to: Int) = mutate { data ->
        val tracks = data.playlistTracks[playlistId].orEmpty().toMutableList()
        if (from !in tracks.indices || to !in tracks.indices) return@mutate data
        val item = tracks.removeAt(from)
        tracks.add(to, item)
        data.copy(playlistTracks = data.playlistTracks + (playlistId to tracks))
    }

    /* ── history (drives Listen Again / taste) ─────────────────────────── */

    suspend fun recordPlay(track: Track, context: String? = null, atMs: Long = System.currentTimeMillis()) =
        mutate { data ->
            val entry = HeardEntry(track, Instant.ofEpochMilli(atMs).toString(), context)
                .toSerializable()
            val history = (listOf(entry) + data.history.filter { it.track.id != track.id })
                .take(HISTORY_CAP)
            data.copy(history = history)
        }

    fun historyEntries(): List<HeardEntry> = _state.value.history.map { it.toHeard() }

    fun likedTracks(): List<Track> = _state.value.likes

    fun likedIds(): Set<String> = _state.value.likes.map { it.id }.toSet()

    /* ── artist follows ────────────────────────────────────────────────── */

    suspend fun toggleFollow(artistName: String) = mutate { data ->
        val key = artistName.trim()
        val follows = if (key in data.follows) data.follows - key else data.follows + key
        data.copy(follows = follows)
    }

    fun isFollowing(artistName: String): Boolean = artistName.trim() in _state.value.follows

}

/** Web parity: `apps/api/src/services/libraryDb.ts` HISTORY_CAP. */
private const val HISTORY_CAP = 300
