package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class PlaybackLogicTest {

    private fun snap(index: Int, length: Int, shuffle: Boolean = false, repeat: RepeatMode = RepeatMode.OFF) =
        QueueSnapshot(index, length, shuffle, repeat)

    private val fixedRng: () -> Double = lcgRng(42)

    @Test
    fun emptyQueueStops() {
        Assert.assertNull(nextIndex(snap(0, 0), manual = false))
        Assert.assertNull(prevIndex(snap(0, 0)))
    }

    @Test
    fun advanceAndNaturalEnd() {
        Assert.assertEquals(1, nextIndex(snap(0, 3), manual = false))
        Assert.assertEquals(2, nextIndex(snap(1, 3), manual = false))
        Assert.assertNull("natural end stops", nextIndex(snap(2, 3), manual = false))
    }

    @Test
    fun repeatAllWrapsAtEnd() {
        Assert.assertEquals(0, nextIndex(snap(2, 3, repeat = RepeatMode.ALL), manual = false))
        // Manual skip at the end with repeat ALL still wraps (repeat check first).
        Assert.assertEquals(0, nextIndex(snap(2, 3, repeat = RepeatMode.ALL), manual = true))
        // Manual + repeat OFF also wraps for convenience.
        Assert.assertEquals(0, nextIndex(snap(2, 3), manual = true))
    }

    @Test
    fun manualSkipWrapsForConvenience() {
        Assert.assertEquals(0, nextIndex(snap(2, 3), manual = true))
        Assert.assertNull(nextIndex(snap(0, 1), manual = true))
    }

    @Test
    fun repeatOneHoldsIndexOnAuto() {
        Assert.assertEquals(1, nextIndex(snap(1, 5, repeat = RepeatMode.ONE), manual = false))
        Assert.assertEquals(2, nextIndex(snap(1, 5, repeat = RepeatMode.ONE), manual = true))
    }

    @Test
    fun shufflePicksADifferentIndex() {
        repeat(50) {
            val pick = nextIndex(snap(1, 5, shuffle = true), manual = false, rng = fixedRng)!!
            Assert.assertTrue(pick in 0..4)
            Assert.assertNotEquals(1, pick)
        }
    }

    @Test
    fun prevWrapsAccordingToRepeat() {
        // Simple step-back.
        Assert.assertEquals(0, prevIndex(snap(1, 3)))
        Assert.assertEquals(1, prevIndex(snap(2, 3)))
        // At the start: repeat OFF holds the current index (TS semantics)…
        Assert.assertEquals(0, prevIndex(snap(0, 3)))
        Assert.assertEquals(0, prevIndex(snap(0, 3, repeat = RepeatMode.OFF)))
        // …while repeat ALL/ONE wraps backwards to the end of the queue.
        Assert.assertEquals(2, prevIndex(snap(0, 3, repeat = RepeatMode.ALL)))
        Assert.assertEquals(2, prevIndex(snap(0, 3, repeat = RepeatMode.ONE)))
        // Single-item queue: stay put.
        Assert.assertEquals(0, prevIndex(snap(0, 1)))
    }

    @Test
    fun insertPositions() {
        Assert.assertEquals(2, insertPosition(5, 1, InsertMode.NEXT))
        Assert.assertEquals(5, insertPosition(5, 4, InsertMode.NEXT))
        Assert.assertEquals(0, insertPosition(0, -1, InsertMode.NEXT))
        Assert.assertEquals(5, insertPosition(5, 2, InsertMode.END))
    }

    @Test
    fun stressShuffleWalkKeepsIndexInvariants() {
        // Port of the web stress test: 50k deterministic shuffle steps.
        val rng = lcgRng(12_345)
        var index = 0
        val length = 17
        repeat(50_000) {
            val next = nextIndex(snap(index, length, shuffle = true), manual = false, rng = rng)!!
            Assert.assertTrue(next in 0 until length)
            Assert.assertNotEquals(index, next)
            index = next
        }
    }
}
