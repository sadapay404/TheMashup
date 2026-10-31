package local.themashup.music.core.player

/**
 * Bound a run of failed tracks, including shuffle. A successful play or an
 * explicit user action resets the set. Never revisit a failed queue position
 * indefinitely when every available track is broken.
 */
object FailureSkipPolicy {
    fun nextIndex(snapshot: PlayerSnapshot, failed: Set<Int>, rng: () -> Double): Int? {
        if (snapshot.queue.isEmpty()) return null
        val size = snapshot.queue.size
        val choices = if (snapshot.shuffle) {
            snapshot.queue.indices.filter { it !in failed && it != snapshot.cursor }
        } else {
            // Wrap around with repeat ALL: try cursor+1..end, then 0..cursor.
            (snapshot.cursor + 1 until size).filter { it !in failed } +
                (0 until snapshot.cursor).filter { it !in failed }
        }
        if (choices.isEmpty()) return null
        if (!snapshot.shuffle) return choices.first()
        return choices[(rng().coerceIn(0.0, 0.999999) * choices.size).toInt()]
    }
}
