package local.themashup.music.core.domain

import kotlin.random.Random

/**
 * Pure playback decision logic — port of
 * `apps/web/src/engine/playbackLogic.ts` (DOM/audio-free by design).
 */

enum class RepeatMode { OFF, ALL, ONE }

data class QueueSnapshot(
    val index: Int,
    val length: Int,
    val shuffle: Boolean,
    val repeat: RepeatMode,
)

/**
 * Index of the track to play next, or null when playback should stop.
 * - repeat ONE (auto)  → same index (caller replays)
 * - shuffle            → random other index (rng injectable for tests)
 * - wrap at end        → when repeat ALL or manual skip past the end
 */
fun nextIndex(
    state: QueueSnapshot,
    manual: Boolean,
    rng: () -> Double = { Random.nextDouble() },
): Int? {
    val (index, length, shuffle, repeat) = state
    if (length == 0) return null
    if (repeat == RepeatMode.ONE && !manual) return index
    if (shuffle && length > 1) {
        var pick = index
        while (pick == index) pick = (rng() * length).toInt()
        return pick
    }
    val next = index + 1
    if (next < length) return next
    // End of queue
    if (repeat == RepeatMode.ALL) return 0
    if (manual) return if (length > 1) 0 else null // manual skip wraps for convenience
    return null // natural end → stop
}

/** Previous track index (wraps backwards), or null at start. */
fun prevIndex(state: QueueSnapshot, rng: () -> Double = { Random.nextDouble() }): Int? {
    val (index, length, shuffle, repeat) = state
    if (length == 0) return null
    if (shuffle && length > 1) {
        var pick = index
        while (pick == index) pick = (rng() * length).toInt()
        return pick
    }
    val prev = index - 1
    if (prev >= 0) return prev
    if (length > 1) return if (repeat == RepeatMode.OFF) index else length - 1
    return index
}

/** Where a "play next" insert lands; "add to queue" appends after the cursor. */
fun insertPosition(queueLength: Int, index: Int, mode: InsertMode): Int =
    when (mode) {
        InsertMode.NEXT -> minOf(index + 1, queueLength)
        InsertMode.END -> queueLength
    }

enum class InsertMode { NEXT, END }
