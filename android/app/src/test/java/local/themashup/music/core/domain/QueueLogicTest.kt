package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class QueueLogicTest {

    private val tracks = listOf("a", "b", "c", "d")

    @Test
    fun enqueueNextInsertsAfterCursor() {
        val r = enqueue(tracks, 1, "x", InsertMode.NEXT)
        Assert.assertEquals(listOf("a", "b", "x", "c", "d"), r.queue)
        Assert.assertEquals(1, r.cursor)
        Assert.assertEquals(2, r.insertedAt)
    }

    @Test
    fun enqueueNextWithEmptyOrUnloadedQueueInsertsFirst() {
        Assert.assertEquals(0, enqueue(emptyList<String>(), -1, "x", InsertMode.NEXT).insertedAt)
        Assert.assertEquals(0, enqueue(tracks, -1, "x", InsertMode.NEXT).insertedAt)
    }

    @Test
    fun enqueueEndAppends() {
        val r = enqueue(tracks, 1, "x", InsertMode.END)
        Assert.assertEquals(listOf("a", "b", "c", "d", "x"), r.queue)
        Assert.assertEquals(4, r.insertedAt)
        Assert.assertEquals(1, r.cursor)
    }

    @Test
    fun removeBeforeCursorShiftsIt() {
        val r = removeAt(tracks, 2, 0)
        Assert.assertEquals(listOf("b", "c", "d"), r.queue)
        Assert.assertEquals(1, r.cursor)
        Assert.assertFalse(r.removedCurrent)
    }

    @Test
    fun removeCurrentMarksAndClampsCursor() {
        val r = removeAt(tracks, 3, 3)
        Assert.assertEquals(listOf("a", "b", "c"), r.queue)
        Assert.assertEquals(2, r.cursor)
        Assert.assertTrue(r.removedCurrent)
    }

    @Test
    fun removeAtBoundsAreNoops() {
        val r = removeAt(tracks, 1, 99)
        Assert.assertEquals(tracks, r.queue)
        Assert.assertEquals(1, r.cursor)
        Assert.assertFalse(r.removedCurrent)
        val r2 = removeAt(tracks, -1, -1)
        Assert.assertEquals(tracks, r2.queue)
    }

    @Test
    fun removingLastRemainingCurrentGoesToEmptyCursor() {
        val r = removeAt(listOf("a"), 0, 0)
        Assert.assertTrue(r.queue.isEmpty())
        Assert.assertEquals(-1, r.cursor)
        Assert.assertTrue(r.removedCurrent)
    }

    @Test
    fun moveItemFollowsCursorRules() {
        // Cursor itself moved → cursor follows.
        Assert.assertEquals(2, moveItem(tracks, 1, 2, 1).cursor)
        // Move before cursor onto/over cursor → shifts left.
        Assert.assertEquals(1, moveItem(tracks, 0, 2, 2).cursor)
        // Move after cursor back onto cursor → shifts right.
        Assert.assertEquals(3, moveItem(tracks, 3, 1, 2).cursor)
        // No-op moves.
        val same = moveItem(tracks, 2, 2, 1)
        Assert.assertEquals(tracks, same.queue)
        Assert.assertEquals(1, same.cursor)
        val oob = moveItem(tracks, 0, 99, 1)
        Assert.assertEquals(tracks, oob.queue)
        Assert.assertEquals(1, oob.cursor)
    }

    @Test
    fun moveItemRelocatesElement() {
        Assert.assertEquals(listOf("a", "c", "d", "b"), moveItem(tracks, 1, 3, 0).queue)
        Assert.assertEquals(listOf("d", "a", "b", "c"), moveItem(tracks, 3, 0, 0).queue)
    }
}
