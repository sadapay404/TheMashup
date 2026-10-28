package local.themashup.music.core.domain

/**
 * Pure queue transformations — port of
 * `apps/web/src/stores/queueLogic.ts`. Generic over the element type so the
 * same operations serve `Track` lists in the player and test fixtures here.
 * `cursor` = index of the currently loaded track (-1 when nothing loaded).
 */

data class EnqueueResult<T>(val queue: List<T>, val cursor: Int, val insertedAt: Int)
data class RemoveResult<T>(val queue: List<T>, val cursor: Int, val removedCurrent: Boolean)
data class MoveResult<T>(val queue: List<T>, val cursor: Int)

fun <T> enqueue(
    queue: List<T>,
    cursor: Int,
    item: T,
    mode: InsertMode,
): EnqueueResult<T> = when (mode) {
    InsertMode.NEXT -> {
        val at = (cursor + 1).coerceIn(0, queue.size)
        EnqueueResult(queue.subList(0, at) + item + queue.subList(at, queue.size), cursor, at)
    }
    InsertMode.END -> EnqueueResult(queue + item, cursor, queue.size)
}

fun <T> removeAt(queue: List<T>, cursor: Int, i: Int): RemoveResult<T> {
    if (i < 0 || i >= queue.size) return RemoveResult(queue, cursor, false)
    val next = queue.filterIndexed { idx, _ -> idx != i }
    var nextCursor = cursor
    if (i < cursor) nextCursor = cursor - 1
    if (i == cursor) nextCursor = minOf(cursor, next.size - 1)
    return RemoveResult(next, maxOf(-1, nextCursor), i == cursor)
}

fun <T> moveItem(queue: List<T>, from: Int, to: Int, cursor: Int): MoveResult<T> {
    if (from == to || from < 0 || to < 0 || from >= queue.size || to >= queue.size) {
        return MoveResult(queue, cursor)
    }
    val next = queue.toMutableList()
    val item = next.removeAt(from)
    next.add(to, item)
    val c = when {
        cursor == from -> to
        from < cursor && to >= cursor -> cursor - 1
        from > cursor && to <= cursor -> cursor + 1
        else -> cursor
    }
    return MoveResult(next, c)
}
