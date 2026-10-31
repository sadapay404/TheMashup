package local.themashup.music.core.player

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.domain.Track
import org.junit.Assert
import org.junit.Test

class DownloadedPlaybackTest {
    private val song = Track(id = "yt1", externalId = "yt1", title = "Song", artistNames = "Artist", artwork = "https://art")
    private fun job(id: String, container: String = "mp3", at: Long = 1, location: String? = null) = DownloadJob(
        id = id, videoId = "yt1", title = "Song", container = container, quality = "320k",
        status = DownloadStatus.COMPLETED, filename = "Song.$container", updatedAt = at, location = location, track = song,
    )

    // The fakes used here complete synchronously; this also runs in the pure Kotlin sandbox.
    private fun <T> immediate(block: suspend () -> T): T {
        var outcome: Result<T>? = null
        block.startCoroutine(object : Continuation<T> {
            override val context = EmptyCoroutineContext
            override fun resumeWith(result: Result<T>) { outcome = result }
        })
        return requireNotNull(outcome).getOrThrow()
    }

    @Test
    fun legacyDownloadRecoversLocationAndPreservesMetadata() {
        val saved = job("old", location = null)
        var recovered: Pair<String, String>? = null
        val playback = DownloadedPlayback(
            jobs = { listOf(saved) },
            locate = { "content://media/external/downloads/123" },
            rememberLocation = { job, location -> recovered = job.id to location },
        )
        val track = saved.asDownloadedTrack()!!
        val found = immediate { playback.find(track) } as DownloadLookup.Found
        Assert.assertEquals("old", track.localDownloadId)
        Assert.assertEquals("Artist", track.artistNames)
        Assert.assertEquals("https://art", track.artwork)
        Assert.assertEquals("download", found.candidate.source)
        Assert.assertEquals("content://media/external/downloads/123", found.candidate.url)
        Assert.assertEquals("old" to found.candidate.url, recovered)
    }

    @Test
    fun selectedDownloadNeverSilentlyFallsBackToStreaming() {
        val saved = job("missing")
        val playback = DownloadedPlayback(jobs = { listOf(saved) }, locate = { null })
        Assert.assertEquals(DownloadLookup.Missing, immediate { playback.find(saved.asDownloadedTrack()!!) })
        Assert.assertEquals(DownloadLookup.NotDownloaded, immediate { playback.find(song) })
    }

    @Test
    fun catalogPlaybackPrefersReadableAudioAndNeverSubstitutesVideo() {
        val audio = job("audio", at = 1, location = "file:///old.mp3")
        val inaccessible = job("new", at = 2, location = "file:///gone.mp3")
        val video = job("video", container = "mp4", at = 3, location = "file:///video.mp4")
        val playback = DownloadedPlayback(
            jobs = { listOf(audio, inaccessible, video) },
            locate = { if (it.id == "new") null else it.location },
        )
        val found = immediate { playback.find(song) } as DownloadLookup.Found
        Assert.assertEquals("audio", found.job.id)
        Assert.assertEquals("file:///old.mp3", found.candidate.url)
        Assert.assertFalse(found.candidate.hasVideo)
    }

    @Test
    fun explicitlySelectedVideoUsesThatCopyAndVideoMime() {
        val video = job("video", container = "mp4", location = "content://media/video/9")
        val playback = DownloadedPlayback(jobs = { listOf(video) }, locate = { it.location })
        val found = immediate { playback.find(video.asDownloadedTrack()!!) } as DownloadLookup.Found
        Assert.assertEquals("video/mp4", found.candidate.mime)
        Assert.assertTrue(found.candidate.hasVideo)
    }

    @Test
    fun jobMustBeCompletedAndMatchTheSelectedTrack() {
        val pending = job("a").copy(status = DownloadStatus.DOWNLOADING)
        Assert.assertNull(pending.asDownloadedTrack())
        val wrong = song.copy(externalId = "other", localDownloadId = "a")
        val playback = DownloadedPlayback(jobs = { listOf(job("a")) }, locate = { "file:///music" })
        Assert.assertEquals(DownloadLookup.Missing, immediate { playback.find(wrong) })
    }

    @Test
    fun readableFileStillPlaysIfSavingTheRecoveredLocationFails() {
        val saved = job("old")
        val playback = DownloadedPlayback(
            jobs = { listOf(saved) }, locate = { "file:///music.mp3" },
            rememberLocation = { _, _ -> throw IllegalStateException("disk full") },
        )
        Assert.assertTrue(immediate { playback.find(saved.asDownloadedTrack()!!) } is DownloadLookup.Found)
    }

    @Test
    fun downloadingTrackKeepsPreviousTrackImmediatelyBehindIt() {
        val previous = Track(id = "previous", externalId = "previous", title = "Previous", artistNames = "A")
        val download = job("copy").asDownloadedTrack()!!
        val initial = PlayerSnapshot(queue = listOf(previous), cursor = 0, status = PlayStatus.PLAYING)
        val (next, _) = PlaybackStateMachine.playNow(initial, download, "downloads")
        Assert.assertEquals(listOf("yt1", "previous"), next.queue.map { it.id })
        Assert.assertEquals("copy", next.current?.localDownloadId)
    }
}
