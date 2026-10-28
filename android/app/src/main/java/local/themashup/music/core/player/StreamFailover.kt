package local.themashup.music.core.player

import local.themashup.music.core.domain.StreamCandidate

/**
 * Candidate walk for one track — port of `apps/web/src/engine/audioEngine.ts`
 * failover (activeIndex advance on error, "All stream candidates failed" on
 * exhaustion) plus ONE silent re-resolve allowance (native URLs expire; the
 * web got fresh candidates from its gateway instead).
 */
data class FailoverState(
    val candidates: List<StreamCandidate> = emptyList(),
    val activeIndex: Int = 0,
    /** Refreshes already requested for this track (cap: [Failover.MAX_REFRESHES]). */
    val refreshesUsed: Int = 0,
) {
    val active: StreamCandidate? get() = candidates.getOrNull(activeIndex)
    val activeNumber: Int get() = activeIndex + 1
    val total: Int get() = candidates.size
}

sealed interface FailoverDecision {
    /** Load `state.active` (after a resolve or a deliberate index move). */
    data class LoadActive(val state: FailoverState) : FailoverDecision

    /** Current candidate died → advance to the next one. */
    data class Advance(val state: FailoverState) : FailoverDecision

    /** No candidates left but a fresh resolve may still help (≤ MAX_REFRESHES). */
    data class RefreshNeeded(val state: FailoverState) : FailoverDecision

    /** Terminal: give up exactly like the web ("All stream candidates failed"). */
    data class Exhausted(val message: String) : FailoverDecision
}

object Failover {
    const val MAX_REFRESHES = 1
    const val NO_CANDIDATES_MSG = "No playable stream candidates"
    const val ALL_FAILED_MSG = "All stream candidates failed"

    /** Empty resolve result → web's `load()` error, else a loadable state. */
    fun ensureCandidates(candidates: List<StreamCandidate>): String? =
        if (candidates.isEmpty()) NO_CANDIDATES_MSG else null

    fun loaded(candidates: List<StreamCandidate>, refreshesUsed: Int = 0): FailoverState =
        FailoverState(candidates = candidates, activeIndex = 0, refreshesUsed = refreshesUsed)

    /** Media error on the active candidate (web `advanceCandidate`). */
    fun onCandidateError(state: FailoverState): FailoverDecision {
        val next = state.activeIndex + 1
        return when {
            next < state.candidates.size -> FailoverDecision.Advance(state.copy(activeIndex = next))
            state.refreshesUsed < MAX_REFRESHES ->
                FailoverDecision.RefreshNeeded(state.copy(refreshesUsed = state.refreshesUsed + 1))
            else -> FailoverDecision.Exhausted(ALL_FAILED_MSG)
        }
    }

    /** Fresh candidates from a refresh; empty result → null (give up). */
    fun onRefreshed(state: FailoverState, fresh: List<StreamCandidate>): FailoverState? =
        if (fresh.isEmpty()) null
        else loaded(fresh, refreshesUsed = state.refreshesUsed)
}
