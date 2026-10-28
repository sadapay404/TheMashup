package local.themashup.music

import androidx.test.ext.junit.runners.AndroidJUnit4
import local.themashup.music.core.network.ExtractionService
import org.junit.Assert
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Phase N3 gate — "Live smoke on device/emulator: search → candidates resolve".
 * Run on a connected device with network access:
 *
 *     cd android && ./gradlew connectedDebugAndroidTest
 *
 * Deliberately requires the REAL network (no mocks): NewPipe extraction and
 * the Piped/Invidious fallbacks must actually work on-device.
 */
@RunWith(AndroidJUnit4::class)
class ExtractionSmokeTest {

    @Test
    fun searchThenStreamCandidatesResolve() {
        val service = ExtractionService()

        // 1) Search resolves tracks via the priority walk.
        val search = service.search("the weeknd blinding lights", limit = 5)
        Assert.assertTrue(
            "expected tracks, got warnings=${search.warnings}",
            search.tracks.isNotEmpty(),
        )
        val first = search.tracks.first()
        Assert.assertTrue(first.externalId.isNotBlank())

        // 2) Stream candidates resolve for the top hit (NewPipe primary).
        val streams = service.streams(first.id)
        Assert.assertTrue(
            "expected stream candidates, warnings=${streams.warnings}",
            streams.candidates.isNotEmpty(),
        )
        val best = streams.candidates.first()
        Assert.assertTrue(best.url.startsWith("http"))
        Assert.assertFalse(best.hasVideo)
        Assert.assertNotNull(best.bitrateKbps)

        // 3) Lyrics resolve (LRCLIB) — synced or plain, never both absent.
        val lyrics = service.lyricsFor(first)
        if (lyrics != null) {
            Assert.assertTrue(
                lyrics.plain != null || lyrics.synced.isNotEmpty() || lyrics.instrumental,
            )
        }
        // (null is tolerated: not every upload has an LRCLIB entry.)
    }
}
