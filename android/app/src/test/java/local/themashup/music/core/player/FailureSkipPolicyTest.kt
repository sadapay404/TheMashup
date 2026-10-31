package local.themashup.music.core.player

import local.themashup.music.core.domain.RepeatMode
import local.themashup.music.core.domain.Track
import org.junit.Assert
import org.junit.Test

class FailureSkipPolicyTest {
    private val queue = listOf("a", "b", "c").map { Track(id = it, externalId = it, title = it, artistNames = "artist") }

    @Test
    fun shuffleVisitsOnlyUnfailedPositionsAndEventuallyStops() {
        val state = PlayerSnapshot(queue = queue, cursor = 0, shuffle = true, repeat = RepeatMode.ALL)
        Assert.assertEquals(2, FailureSkipPolicy.nextIndex(state, setOf(0, 1)) { 0.4 })
        Assert.assertNull(FailureSkipPolicy.nextIndex(state, setOf(0, 1, 2)) { 0.4 })
    }

    @Test
    fun sequentialFailureDoesNotLoopToStartWithRepeatAll() {
        val state = PlayerSnapshot(queue = queue, cursor = 2, repeat = RepeatMode.ALL)
        Assert.assertNull(FailureSkipPolicy.nextIndex(state, setOf(2)) { 0.0 })
    }

    @Test
    fun sequentialFailureAdvancesToNextAvailablePosition() {
        val state = PlayerSnapshot(queue = queue, cursor = 0)
        Assert.assertEquals(2, FailureSkipPolicy.nextIndex(state, setOf(0, 1)) { 0.0 })
    }
}
