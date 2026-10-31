package local.themashup.music.core.data

import java.io.File
import java.io.IOException
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
    fun readIoFailureIsNotTreatedAsCorruptJson() = runBlocking {
        val directory = File(tmp.root, "not-a-file").apply { mkdirs() }
        val s = JsonFileStore(directory, LibraryData.serializer()) { LibraryData() }
        try {
            s.read()
            Assert.fail("expected read failure")
        } catch (_: IOException) {
            Assert.assertTrue(directory.isDirectory)
        }
    }

    @Test
    fun failedReplacementKeepsPreviousPath() = runBlocking {
        val directory = File(tmp.root, "not-a-file").apply { mkdirs() }
        File(directory, "keep").writeText("original")
        val s = JsonFileStore(directory, LibraryData.serializer()) { LibraryData() }
        try {
            s.write(LibraryData())
            Assert.fail("expected rename failure")
        } catch (_: IOException) {
            Assert.assertEquals("original", File(directory, "keep").readText())
        }
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
        // N7 contract: validate returns null (ok) or the gateway 400 message.
        Assert.assertEquals(
            "quality 'mp3_320' invalid for mp3 (allowed: 128k, 320k)",
            validateDownloadQuality("mp3", "mp3_320"),
        )
        Assert.assertNull(validateDownloadQuality("mp3", "320k"))
        Assert.assertNull(validateDownloadQuality("flac", "best"))
        Assert.assertNull(validateDownloadQuality("mp4", "1080p"))
        // The repository still surfaces it as IllegalArgumentException with the
        // exact message contract (gateway VALIDATION_ERROR parity).
        try {
            runBlocking {
                JsonFileStore(
                    File(tmp.root, "q.json"),
                    kotlinx.serialization.serializer<local.themashup.music.core.domain.DownloadsData>(),
                ) { local.themashup.music.core.domain.DownloadsData() }.let { store ->
                    DownloadsRepository(store).enqueue(track("bad", "Bad", "Artist"), "mp3_320", "mp3")
                }
            }
            Assert.fail("expected validation error")
        } catch (e: IllegalArgumentException) {
            Assert.assertEquals("quality 'mp3_320' invalid for mp3 (allowed: 128k, 320k)", e.message)
        }
    }

    @Test
    fun likesAndPlaylistsDoNotPinDeletedDownloadIds() = runBlocking {
        val store = JsonFileStore(File(tmp.root, "library.json"), local.themashup.music.core.domain.LibraryData.serializer()) {
            local.themashup.music.core.domain.LibraryData()
        }
        val library = LibraryRepository(store)
        val downloaded = local.themashup.music.core.domain.Track(
            id = "v", externalId = "v", title = "Song", artistNames = "Artist", localDownloadId = "copy",
        )
        library.setLiked(downloaded, true)
        val playlist = library.createPlaylist("Test")
        library.addTrackToPlaylist(playlist.id, downloaded)
        Assert.assertNull(library.state.value.likes.single().localDownloadId)
        Assert.assertNull(library.state.value.playlistTracks[playlist.id]!!.single().localDownloadId)
    }

    @Test
    fun oldDownloadRowsStillLoadWithoutLocationOrTrackMetadata() = runBlocking {
        val file = File(tmp.root, "legacy-downloads.json")
        file.writeText("""{"jobs":[{"id":"old","videoId":"v","title":"Song","container":"mp3","quality":"320k","status":"COMPLETED","filename":"Song.mp3"}]}""")
        val store = JsonFileStore(file, local.themashup.music.core.domain.DownloadsData.serializer()) {
            local.themashup.music.core.domain.DownloadsData()
        }
        val old = store.read().jobs.single()
        Assert.assertNull(old.location)
        Assert.assertNull(old.track)
        Assert.assertEquals("Song.mp3", old.filename)
    }

    @Test
    fun downloadEnqueuePersistsJob() = runBlocking {
        val store = JsonFileStore(File(tmp.root, "downloads.json"), kotlinx.serialization.serializer<local.themashup.music.core.domain.DownloadsData>()) { local.themashup.music.core.domain.DownloadsData() }
        val r = DownloadsRepository(store)
        val job = r.enqueue(track("v", "Video", "Artist"), "320k", "mp3")
        Assert.assertEquals(DownloadStatus.QUEUED, job.status)
        r.updateProgress(job.id, 42, 1024)
        r.markCompleted(job.id, "Video.mp3", 4_000_000, "content://media/external/downloads/42")
        val back = store.read()
        Assert.assertEquals(1, back.jobs.size)
        Assert.assertEquals(DownloadStatus.COMPLETED, back.jobs[0].status)
        Assert.assertEquals(100, back.jobs[0].progress)
        Assert.assertEquals("Video.mp3", back.jobs[0].filename)
        Assert.assertEquals("content://media/external/downloads/42", back.jobs[0].location)
        Assert.assertEquals("Artist", back.jobs[0].track?.artistNames)
    }
}
