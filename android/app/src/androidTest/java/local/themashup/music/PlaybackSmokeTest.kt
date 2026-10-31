package local.themashup.music

import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.player.PlayStatus
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import org.junit.Assert
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Phase N4 gate — "Background play + controls verified on device":
 * search → playQueue → real audio playback (position advances), pause,
 * next-track with re-resolve, stop. Requires network:
 *
 *     cd android && ./gradlew connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class PlaybackSmokeTest {

    private lateinit var engine: PlaybackEngine
    private lateinit var scenario: ActivityScenario<MainActivity>
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }

    @Before
    fun setUp() {
        val app = ApplicationProvider.getApplicationContext<TheMashupApp>()
        engine = app.container.player
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun tearDown() {
        main { engine.clearQueue() }
        scenario.close()
    }

    @Test
    fun playPauseNextStopLifecycle() {
        val search = ExtractionService().search("never gonna give you up", limit = 3)
        Assert.assertTrue("search failed: ${search.warnings}", search.tracks.size >= 2)

        // Play → resolving → playing with position advancing.
        main { engine.playQueue(search.tracks, startIndex = 0) }
        val playing = engine.awaitState(45_000) {
            it.status == PlayStatus.PLAYING && it.positionMs >= 0 && it.cursor == 0
        }
        Assert.assertEquals("expected PLAYING, got ${playing.status} err=${playing.error}", PlayStatus.PLAYING, playing.status)
        Assert.assertNotNull("active candidate", playing.failover?.active)

        val p0 = playing.positionMs
        val later = engine.awaitState(10_000) { it.positionMs > p0 }
        Assert.assertTrue("position should advance: $p0 -> ${later.positionMs}", later.positionMs > p0)

        // Pause → PAUSED.
        main { engine.togglePlay() }
        val paused = engine.awaitState(10_000) { it.status == PlayStatus.PAUSED }
        Assert.assertEquals(PlayStatus.PAUSED, paused.status)

        // Next → second track re-resolves and plays.
        main { engine.nextTrack() }
        val next = engine.awaitState(45_000) { it.status == PlayStatus.PLAYING && it.cursor == 1 }
        Assert.assertEquals(1, next.cursor)
        Assert.assertEquals(search.tracks[1].id, next.current?.id)

        // Stop → idle, queue cleared.
        main { engine.clearQueue() }
        val idle = engine.awaitState(10_000) { it.status == PlayStatus.IDLE && it.isEmpty }
        Assert.assertTrue(idle.isEmpty)
        Assert.assertEquals(PlayStatus.IDLE, idle.status)
    }

    @Test
    fun queueEditsReflectInState() {
        val t = ExtractionService().search("void - dancing in the moonlight", limit = 1).tracks.firstOrNull()
        Assert.assertNotNull(t)
        main { engine.clearQueue() }
        engine.awaitState(5_000) { it.isEmpty }

        main { engine.addToEnd(t!!) }
        engine.awaitState(5_000) { it.queue.size == 1 }
        val snap: PlayerSnapshot = engine.state.value
        Assert.assertEquals(1, snap.queue.size)
        Assert.assertEquals(-1, snap.cursor) // queued, not auto-started
        main { engine.clearQueue() }
    }
}
