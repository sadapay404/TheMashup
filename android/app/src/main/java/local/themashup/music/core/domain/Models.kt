package local.themashup.music.core.domain

import kotlinx.serialization.Serializable

/**
 * Core domain models — direct port of `packages/shared/src/types.ts`.
 * Pure Kotlin (no Android imports) so every algorithm here compiles and runs
 * on the JVM: see `scripts/test-kotlin-domain.sh` (sandbox) and
 * `./gradlew test` (build machine).
 */

enum class TrackSource { YT, PIPED, INVIDIOUS, YTMUSIC }

@Serializable
data class ArtistRef(
    val name: String,
    val channelId: String? = null,
    val url: String? = null,
    val image: String? = null,
)

@Serializable
data class Track(
    /** Stable client id — equals [externalId] until a local id scheme lands. */
    val id: String,
    val source: String = "ytdlp",
    /** Raw upstream id (YouTube video id). */
    val externalId: String,
    val title: String,
    val artists: List<ArtistRef> = emptyList(),
    val artistNames: String,
    val album: String? = null,
    val durationSec: Int? = null,
    val artwork: String? = null,
    val artworkBest: String? = null,
    val popularity: Int? = null,
    val explicit: Boolean = false,
    val category: String? = null,
    /** Explicitly chosen offline copy; null for ordinary catalog tracks. */
    val localDownloadId: String? = null,
)

/** One playable rendition of a track. */
@Serializable
data class StreamCandidate(
    val id: String,
    val source: String,
    val url: String,
    /** Native player uses [url] directly (no proxy needed — headers attachable). */
    val mime: String,
    val ext: String,
    val quality: String,
    val bitrateKbps: Int? = null,
    val width: Int? = null,
    val height: Int? = null,
    val hasVideo: Boolean = false,
    /** Video stream without audio (adaptive) — needs a merge with an audio candidate. */
    val videoOnly: Boolean = false,
    val sizeBytes: Long? = null,
    val expiresAt: String? = null,
    val httpHeaders: Map<String, String> = emptyMap(),
)

/** LRC line: seconds-since-start + text. */
@Serializable
data class LyricLine(val time: Double, val text: String)

@Serializable
data class Lyrics(
    val trackId: String? = null,
    val plain: String? = null,
    val synced: List<LyricLine> = emptyList(),
    val provider: String = "lrclib",
    val instrumental: Boolean = false,
)

/** Ranked candidate resolving free text to a track + lyrics (LRCLIB). */
@Serializable
data class LyricMatchRow(
    val trackName: String,
    val artistName: String,
    val albumName: String? = null,
    val durationSec: Int? = null,
    val synced: Boolean = false,
    val plain: Boolean = false,
    val similarity: Double = 0.0,
    val lrclibId: Long = 0L,
    val snippet: String? = null,
)

@Serializable
data class LyricMatch(
    val query: String,
    val matches: List<LyricMatchRow> = emptyList(),
    val tookMs: Long = 0,
)

enum class DownloadStatus { QUEUED, DOWNLOADING, PROCESSING, COMPLETED, FAILED }

/** Persistence shape of a download job (port of shared `DownloadJob`). */
@Serializable
data class DownloadJob(
    val id: String,
    val videoId: String,
    val title: String,
    val container: String, // "mp3" | "flac" | "opus" | "mp4"
    val quality: String,
    val status: DownloadStatus = DownloadStatus.QUEUED,
    val progress: Int = 0,
    val speedBps: Long? = null,
    val etaSec: Long? = null,
    val filesize: Long? = null,
    val filename: String? = null,
    val error: String? = null,
    val warning: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    /** URI (or legacy path) returned by the storage provider; absent in old installs. */
    val location: String? = null,
    /** Original metadata for offline display, notifications, and library history. */
    val track: Track? = null,
)

/** A heard track with play time (library history). */
data class HeardEntry(
    val track: Track,
    /** ISO-8601 instant, e.g. `2026-10-28T11:00:00Z`. */
    val at: String,
    val context: String? = null,
)

@Serializable
data class RecShelf(
    val kind: String, // quick | discover | trending | listen_again
    val title: String,
    val tracks: List<Track>,
    val personalized: Boolean = false,
)

@Serializable
data class Playlist(
    val id: String,
    val name: String,
    val trackIds: List<String> = emptyList(),
    val createdAt: Long = 0,
)

/** Catalog snapshot used by playlists (they store full tracks for offline UI). */
@Serializable
data class LibraryData(
    val likes: List<Track> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
    val playlistTracks: Map<String, List<Track>> = emptyMap(),
    val history: List<HeardEntrySerializable> = emptyList(),
    val follows: List<String> = emptyList(),
)

@Serializable
data class HeardEntrySerializable(
    val track: Track,
    val at: String,
    val context: String? = null,
)

fun HeardEntrySerializable.toHeard() = HeardEntry(track, at, context)
fun HeardEntry.toSerializable() = HeardEntrySerializable(track, at, context)

@Serializable
data class DownloadsData(val jobs: List<DownloadJob> = emptyList())

@Serializable
data class SearchCacheEntry(
    val query: String,
    val at: Long,
    val tracks: List<Track>,
)
