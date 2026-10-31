package local.themashup.music.core.player

import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.Track
import kotlin.coroutines.cancellation.CancellationException

/** A download remains a distinct queue item even when several copies share a YouTube ID. */
fun DownloadJob.asDownloadedTrack(): Track? {
    if (status != DownloadStatus.COMPLETED) return null
    val original = track ?: Track(
        id = videoId,
        externalId = videoId,
        title = title,
        artistNames = "Unknown artist",
    )
    return original.copy(localDownloadId = id)
}

sealed interface DownloadLookup {
    data class Found(val job: DownloadJob, val candidate: StreamCandidate) : DownloadLookup
    /** No readable audio download for a catalog track; streaming may be attempted. */
    data object NotDownloaded : DownloadLookup
    /** A specifically selected download is missing; never silently stream it. */
    data object Missing : DownloadLookup
}

/**
 * Select and locate saved media without ever calling the network. The Android
 * locator validates the stored URI and can recover legacy jobs by filename.
 */
class DownloadedPlayback(
    private val jobs: suspend () -> List<DownloadJob>,
    private val locate: suspend (DownloadJob) -> String?,
    private val rememberLocation: suspend (DownloadJob, String) -> Unit = { _, _ -> },
) {
    suspend fun find(track: Track): DownloadLookup {
        val explicit = track.localDownloadId
        val all = jobs()
        val candidates = if (explicit != null) {
            all.filter {
                it.id == explicit && it.videoId == track.externalId && it.status == DownloadStatus.COMPLETED
            }
        } else {
            // Never substitute an MP4 video for a song selected elsewhere in the app.
            all.filter {
                it.videoId == track.externalId && it.status == DownloadStatus.COMPLETED &&
                    !it.container.equals("mp4", ignoreCase = true)
            }.sortedWith(compareByDescending<DownloadJob> { it.updatedAt }.thenByDescending { it.createdAt })
        }
        for (job in candidates) {
            val location = locate(job) ?: continue
            if (job.location != location) {
                // A persistence failure must not make a readable file unplayable.
                try {
                    rememberLocation(job, location)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // The file can still be played; recovery can run again later.
                }
            }
            val container = job.container.lowercase()
            val mime = when (container) {
                "mp3" -> "audio/mpeg"
                "flac" -> "audio/flac"
                "opus" -> "audio/ogg"
                "mp4" -> "video/mp4"
                else -> "application/octet-stream"
            }
            return DownloadLookup.Found(job, StreamCandidate(
                id = "download:${job.id}",
                source = SOURCE,
                url = location,
                mime = mime,
                ext = container,
                quality = job.quality,
                hasVideo = container == "mp4",
            ))
        }
        return if (explicit != null) DownloadLookup.Missing else DownloadLookup.NotDownloaded
    }

    companion object {
        const val SOURCE = "download"
        const val MISSING_MESSAGE = "Downloaded file not found or inaccessible. It may have been moved or deleted."
        const val PLAYBACK_ERROR = "Could not play this downloaded file. It may be damaged or unsupported."
    }
}
