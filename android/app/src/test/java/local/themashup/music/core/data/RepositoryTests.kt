package local.themashup.music.core.data

import java.io.File
import kotlinx.coroutines.runBlocking
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.domain.LibraryData
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.validateDownloadQuality
import org.junit.Assert
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class JsonFileStoreTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun store() = JsonFileStore(File(tmp.root, "data.json"), LibraryData.serializer()) { LibraryData() }

    @Test
    fun roundTripsThroughDisk() = runBlocking {
        val s = store()
        val liked = Track(id = "a", externalId = "a", title = "Song A", artistNames = "Artist")
        s.write(LibraryData(likes = listOf(liked)))
        val back = s.read()
        Assert.assertEquals(1, back.likes.size)
        Assert.assertEquals("a", back.likes[0].id)
    }

    @Test
    fun missingFileYieldsDefaults() = runBlocking {
        val back = store().read()
        Assert.assertTrue(back.likes.isEmpty())
    }

    @Test
    fun corruptFileIsBackedUpAndDefaultsReturned() = runBlocking {
        val file = File(tmp.root, "data.json")
        file.writeText("{ definitely not json")
        val s = store()
        val back = s.read()
        Assert.assertTrue(back.likes.isEmpty())
        Assert.assertTrue("corrupt file moved aside", File(tmp.root, "data.json.bak").exists())
    }

    @Test
    fun updateSeesItsOwnWrites() = runBlocking {
        val s = store()
        s.update { it.copy(likes = listOf(Track(id = "p", externalId = "p", title = "P", artistNames = "Q"))) }
        val back = s.update { it.copy(follows = listOf("Band X")) }
        Assert.assertEquals(1, back.likes.size)
        Assert.assertEquals(listOf("Band X"), back.follows)
    }
}

class LibraryRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun repo(): LibraryRepository {
        val store = JsonFileStore(File(tmp.root, "library.json"), LibraryData.serializer()) { LibraryData() }
        return LibraryRepository(store)
    }

    private fun track(id: String, title: String, artist: String) =
        Track(id = id, externalId = id, title = title, artistNames = artist)

    @Test
    fun likeUnlikePersists() = runBlocking {
        val r = repo()
        val t = track("x", "X", "Y")
        r.setLiked(t, true)
        Assert.assertTrue(r.isLiked("x"))
        r.setLiked(t, false)
        Assert.assertFalse(r.isLiked("x"))
    }

    @Test
    fun playlistLifecycle() = runBlocking {
        val r = repo()
        val pl = r.createPlaylist(" Focus ")
        Assert.assertEquals("Focus", pl.name)
        r.addTrackToPlaylist(pl.id, track("a", "A", "X"))
        r.addTrackToPlaylist(pl.id, track("b", "B", "Y"))
        r.addTrackToPlaylist(pl.id, track("a", "A", "X")) // dupe ignored
        r.reorderPlaylist(pl.id, 1, 0)
        val data = r.state.value
        val tracks = data.playlistTracks.getValue(pl.id)
        Assert.assertEquals(2, tracks.size)
        Assert.assertEquals("b", tracks[0].id)
        r.removeTrackFromPlaylist(pl.id, "b")
        Assert.assertEquals(1, r.state.value.playlistTracks.getValue(pl.id).size)
        r.deletePlaylist(pl.id)
        Assert.assertTrue(r.state.value.playlists.isEmpty())
    }

    @Test
    fun historyCapsAndDedupesByTrack() = runBlocking {
        val r = repo()
        r.recordPlay(track("t1", "One", "A"), atMs = 1_000)
        r.recordPlay(track("t2", "Two", "B"), atMs = 2_000)
        r.recordPlay(track("t1", "One", "A"), atMs = 3_000)
        val hist = r.state.value.history
        Assert.assertEquals(2, hist.size)
        Assert.assertEquals("t1", hist[0].track.id) // replay moved to front
    }

    @Test
    fun downloadQualityValidationMatchesGatewayContract() {
        try {
            validateDownloadQuality("mp3_320", "mp3")
            Assert.fail("expected validation error")
        } catch (e: IllegalArgumentException) {
            Assert.assertEquals("quality 'mp3_320' invalid for mp3 (allowed: 128k, 320k)", e.message)
        }
        validateDownloadQuality("320k", "mp3")
        validateDownloadQuality("best", "flac")
        validateDownloadQuality("1080p", "mp4")
    }

    @Test
    fun downloadEnqueuePersistsJob() = runBlocking {
        val store = JsonFileStore(File(tmp.root, "downloads.json"), kotlinx.serialization.serializer<local.themashup.music.core.domain.DownloadsData>()) { local.themashup.music.core.domain.DownloadsData() }
        val r = DownloadsRepository(store)
        val job = r.enqueue(track("v", "Video", "Artist"), "320k", "mp3")
        Assert.assertEquals(DownloadStatus.QUEUED, job.status)
        r.updateProgress(job.id, 42, 1024)
        r.markCompleted(job.id, "Video.mp3", 4_000_000)
        val back = store.read()
        Assert.assertEquals(1, back.jobs.size)
        Assert.assertEquals(DownloadStatus.COMPLETED, back.jobs[0].status)
        Assert.assertEquals(100, back.jobs[0].progress)
        Assert.assertEquals("Video.mp3", back.jobs[0].filename)
    }
}
