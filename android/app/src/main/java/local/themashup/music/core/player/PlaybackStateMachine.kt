package local.themashup.music.core.player

import local.themashup.music.core.domain.InsertMode
import local.themashup.music.core.domain.QueueSnapshot
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.MoveResult
import local.themashup.music.core.domain.EnqueueResult
import local.themashup.music.core.domain.RemoveResult
import local.themashup.music.core.domain.RepeatMode
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.enqueue
import local.themashup.music.core.domain.moveItem
import local.themashup.music.core.domain.nextIndex
import local.themashup.music.core.domain.prevIndex
import local.themashup.music.core.domain.removeAt

/**
 * Pure player state machine — the deterministic core the ExoPlayer shell
 * ([PlaybackEngine]) and the UI both drive. Statuses mirror the web engine's
 * `EngineStatus` (idle | loading | playing | paused | error). Every transition
 * returns the next [PlayerSnapshot] plus the [PlayerEffect]s the shell must
 * perform (resolve streams, load a candidate, play/pause/seek/stop/fail).
 */
enum class PlayStatus { IDLE, LOADING, PLAYING, PAUSED, ERROR }

data class PlayerSnapshot(
    val queue: List<Track> = emptyList(),
    val cursor: Int = -1,
    val repeat: RepeatMode = RepeatMode.OFF,
    val shuffle: Boolean = false,
    val status: PlayStatus = PlayStatus.IDLE,
    val error: String? = null,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val failover: FailoverState? = null,
    val source: String? = null,
    /** Play context label (web `contextLabel`: "home" | "radio" | "search" …). */
    val contextLabel: String? = null,
    val warnings: List<String> = emptyList(),
) {
    val current: Track? get() = queue.getOrNull(cursor)
    val isEmpty: Boolean get() = queue.isEmpty()
}

sealed interface PlayerEffect {
    /** Resolve stream candidates for [track] (IO shell). */
    data class Resolve(val track: Track, val startAtMs: Long = 0, val isRefresh: Boolean = false) : PlayerEffect

    /** Push a candidate into ExoPlayer, prepare, play (and seek if startAt > 0). */
    data class LoadCandidate(val candidate: StreamCandidate, val startAtMs: Long) : PlayerEffect

    data object Play : PlayerEffect
    data object Pause : PlayerEffect
    data class Seek(val positionMs: Long) : PlayerEffect
    data object Stop : PlayerEffect

    /** Terminal failure already reflected in the snapshot (toast/log hook). */
    data class Fail(val message: String) : PlayerEffect
}

object PlaybackStateMachine {

    /* ── starting ───────────────────────────────────────────────────────── */

    /** Replace queue and start resolving [tracks[startIndex]] (web `load()`). */
    fun playQueue(
        snapshot: PlayerSnapshot,
        tracks: List<Track>,
        startIndex: Int,
        startAtMs: Long = 0,
        context: String? = null,
    ): Pair<PlayerSnapshot, PlayerEffect?> {
        if (tracks.isEmpty()) return snapshot to null
        val cursor = startIndex.coerceIn(0, tracks.size - 1)
        val next = snapshot.copy(
            queue = tracks,
            cursor = cursor,
            status = PlayStatus.LOADING,
            error = null,
            positionMs = startAtMs,
            durationMs = 0,
            failover = null,
            source = null,
            contextLabel = context,
        )
        return next to PlayerEffect.Resolve(tracks[cursor], startAtMs)
    }

    /** Play the chosen track now, preserving the current track immediately after it. */
    fun playNow(snapshot: PlayerSnapshot, track: Track, context: String? = null): Pair<PlayerSnapshot, PlayerEffect?> {
        val index = snapshot.cursor.takeIf { it in snapshot.queue.indices } ?: 0
        val queue = snapshot.queue.toMutableList().apply { add(index, track) }
        return playQueue(snapshot, queue, index, context = context)
    }

    /** Resolve finished with candidates → arm failover and load the first. */
    fun onCandidatesResolved(
        snapshot: PlayerSnapshot,
        candidates: List<StreamCandidate>,
        startAtMs: Long,
        isRefresh: Boolean,
    ): Pair<PlayerSnapshot, PlayerEffect?> {
        val emptyMsg = Failover.ensureCandidates(candidates)
        if (emptyMsg != null) {
            // A refresh that yields nothing means the track's streams died,
            // not that the user asked for a track with no streams.
            val msg = if (isRefresh) Failover.ALL_FAILED_MSG else emptyMsg
            return onResolveFailed(snapshot, msg, snapshot.warnings)
        }

        val base = snapshot.failover ?: Failover.loaded(candidates)
        val failover = if (isRefresh) {
            Failover.onRefreshed(base, candidates) ?: return onResolveFailed(
                snapshot,
                Failover.ALL_FAILED_MSG,
                snapshot.warnings,
            )
        } else {
            base.copy(candidates = candidates, activeIndex = 0)
        }
        val first = failover.active ?: return onResolveFailed(snapshot, Failover.NO_CANDIDATES_MSG, snapshot.warnings)
        return snapshot.copy(
            status = PlayStatus.LOADING,
            error = null,
            failover = failover,
            source = first.source,
        ) to PlayerEffect.LoadCandidate(first, startAtMs)
    }

    fun onResolveFailed(
        snapshot: PlayerSnapshot,
        message: String,
        warnings: List<String>,
    ): Pair<PlayerSnapshot, PlayerEffect?> {
        val next = snapshot.copy(
            status = PlayStatus.ERROR,
            error = message,
            warnings = warnings,
            positionMs = 0,
            durationMs = 0,
        )
        return next to PlayerEffect.Fail(message)
    }

    /* ── candidate failover (web audioEngine.advanceCandidate) ──────────── */

    fun onCandidateFailed(snapshot: PlayerSnapshot): Pair<PlayerSnapshot, PlayerEffect?> {
        val failover = snapshot.failover ?: return onResolveFailed(
            snapshot,
            Failover.NO_CANDIDATES_MSG,
            snapshot.warnings,
        )
        val track = snapshot.current ?: return onResolveFailed(snapshot, Failover.NO_CANDIDATES_MSG, snapshot.warnings)
        return when (val decision = Failover.onCandidateError(failover)) {
            is FailoverDecision.Advance -> {
                val cand = decision.state.active!!
                snapshot.copy(failover = decision.state, source = cand.source, status = PlayStatus.LOADING) to
                    PlayerEffect.LoadCandidate(cand, 0)
            }
            is FailoverDecision.RefreshNeeded -> snapshot.copy(
                failover = decision.state,
                status = PlayStatus.LOADING,
            ) to PlayerEffect.Resolve(track, startAtMs = snapshot.positionMs, isRefresh = true)
            is FailoverDecision.Exhausted -> onResolveFailed(snapshot, decision.message, snapshot.warnings)
            is FailoverDecision.LoadActive -> snapshot.copy(failover = decision.state) to null
        }
    }

    /* ── transport ──────────────────────────────────────────────────────── */

    fun toggle(snapshot: PlayerSnapshot): Pair<PlayerSnapshot, PlayerEffect?> = when (snapshot.status) {
        PlayStatus.PLAYING -> snapshot to PlayerEffect.Pause
        PlayStatus.PAUSED -> snapshot to PlayerEffect.Play
        PlayStatus.IDLE, PlayStatus.ERROR -> {
            val idx = if (snapshot.cursor >= 0) snapshot.cursor else 0
            val track = snapshot.queue.getOrNull(idx)
            if (track == null) {
                snapshot to null
            } else {
                val base = if (snapshot.cursor != idx) snapshot.copy(cursor = idx) else snapshot
                base.copy(status = PlayStatus.LOADING, error = null) to PlayerEffect.Resolve(track)
            }
        }
        PlayStatus.LOADING -> snapshot to null
    }

    fun next(
        snapshot: PlayerSnapshot,
        rng: () -> Double,
        manual: Boolean = true,
    ): Pair<PlayerSnapshot, PlayerEffect?> {
        val q = QueueSnapshot(snapshot.cursor, snapshot.queue.size, snapshot.shuffle, snapshot.repeat)
        val target = nextIndex(q, manual = manual, rng = rng) ?: return stopAtEnd(snapshot)
        if (target == snapshot.cursor && !manual && snapshot.repeat == RepeatMode.ONE) {
            // Repeat ONE: replay current track from the top.
            val next = snapshot.copy(status = PlayStatus.LOADING, error = null, positionMs = 0, durationMs = 0, failover = null)
            return next to PlayerEffect.Resolve(snapshot.queue[target], 0)
        }
        return goto(snapshot, target)
    }

    fun prev(snapshot: PlayerSnapshot, rng: () -> Double): Pair<PlayerSnapshot, PlayerEffect?> {
        if (snapshot.cursor < 0 || snapshot.queue.isEmpty()) return snapshot to null
        val q = QueueSnapshot(snapshot.cursor, snapshot.queue.size, snapshot.shuffle, snapshot.repeat)
        val target = prevIndex(q, rng = rng) ?: return snapshot to null
        return goto(snapshot, target)
    }

    fun onTrackCompleted(snapshot: PlayerSnapshot, rng: () -> Double): Pair<PlayerSnapshot, PlayerEffect?> =
        next(snapshot, rng, manual = false)

    private fun goto(snapshot: PlayerSnapshot, index: Int): Pair<PlayerSnapshot, PlayerEffect?> {
        val track = snapshot.queue.getOrNull(index) ?: return stopAtEnd(snapshot)
        val next = snapshot.copy(
            cursor = index,
            status = PlayStatus.LOADING,
            error = null,
            positionMs = 0,
            durationMs = 0,
            failover = null,
            source = null,
        )
        return next to PlayerEffect.Resolve(track, 0)
    }

    private fun stopAtEnd(snapshot: PlayerSnapshot): Pair<PlayerSnapshot, PlayerEffect?> =
        snapshot.copy(
            status = PlayStatus.IDLE,
            error = null,
            positionMs = 0,
            failover = null,
            source = null,
        ) to PlayerEffect.Stop

    fun seek(snapshot: PlayerSnapshot, positionMs: Long): Pair<PlayerSnapshot, PlayerEffect?> {
        val max = snapshot.durationMs
        val clamped = if (max > 0) positionMs.coerceIn(0, max) else positionMs.coerceAtLeast(0)
        return snapshot.copy(positionMs = clamped) to PlayerEffect.Seek(clamped)
    }

    fun onPlayingChanged(snapshot: PlayerSnapshot, playing: Boolean): PlayerSnapshot = when {
        playing -> snapshot.copy(status = PlayStatus.PLAYING, error = null)
        snapshot.status == PlayStatus.PLAYING -> snapshot.copy(status = PlayStatus.PAUSED)
        else -> snapshot
    }

    fun onBuffering(snapshot: PlayerSnapshot): PlayerSnapshot =
        if (snapshot.status == PlayStatus.PLAYING) snapshot.copy(status = PlayStatus.LOADING) else snapshot

    fun onPosition(snapshot: PlayerSnapshot, positionMs: Long, durationMs: Long): PlayerSnapshot = snapshot.copy(
        positionMs = positionMs.coerceAtLeast(0),
        durationMs = if (durationMs > 0) durationMs else snapshot.durationMs,
    )

    /* ── repeat / shuffle ───────────────────────────────────────────────── */

    fun setRepeat(snapshot: PlayerSnapshot, mode: RepeatMode): PlayerSnapshot =
        snapshot.copy(repeat = mode)

    fun setShuffle(snapshot: PlayerSnapshot, on: Boolean): PlayerSnapshot =
        snapshot.copy(shuffle = on)

    fun cycleRepeat(snapshot: PlayerSnapshot): PlayerSnapshot = snapshot.copy(
        repeat = when (snapshot.repeat) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        },
    )

    /* ── queue mutations (web queue store parity) ───────────────────────── */

    fun enqueue(snapshot: PlayerSnapshot, item: Track, mode: InsertMode): PlayerSnapshot {
        val r: EnqueueResult<Track> = enqueue(snapshot.queue, snapshot.cursor, item, mode)
        return snapshot.copy(queue = r.queue, cursor = r.cursor)
    }

    fun remove(snapshot: PlayerSnapshot, index: Int): Pair<PlayerSnapshot, PlayerEffect?> {
        val r: RemoveResult<Track> = removeAt(snapshot.queue, snapshot.cursor, index)
        val next = snapshot.copy(queue = r.queue, cursor = r.cursor)
        return if (r.removedCurrent) {
            next.copy(status = PlayStatus.IDLE, error = null, positionMs = 0, failover = null, source = null) to
                PlayerEffect.Stop
        } else {
            next to null
        }
    }

    fun move(snapshot: PlayerSnapshot, from: Int, to: Int): PlayerSnapshot {
        val r: MoveResult<Track> = moveItem(snapshot.queue, from, to, snapshot.cursor)
        return snapshot.copy(queue = r.queue, cursor = r.cursor)
    }

    fun clear(snapshot: PlayerSnapshot): Pair<PlayerSnapshot, PlayerEffect?> =
        snapshot.copy(
            queue = emptyList(),
            cursor = -1,
            status = PlayStatus.IDLE,
            error = null,
            positionMs = 0,
            durationMs = 0,
            failover = null,
            source = null,
        ) to PlayerEffect.Stop
}
