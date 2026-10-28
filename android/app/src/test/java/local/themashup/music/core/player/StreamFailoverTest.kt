package local.themashup.music.core.player

import local.themashup.music.core.domain.StreamCandidate
import org.junit.Assert
import org.junit.Test

class StreamFailoverTest {

    private fun cand(id: String) = StreamCandidate(
        id = id,
        source = "newpipe",
        url = "https://cdn/$id",
        mime = "audio/mp4",
        ext = "m4a",
        quality = "128k",
        bitrateKbps = 128,
    )

    @Test
    fun emptyCandidatesFlaggedWithWebMessage() {
        Assert.assertEquals(Failover.NO_CANDIDATES_MSG, Failover.ensureCandidates(emptyList()))
        Assert.assertNull(Failover.ensureCandidates(listOf(cand("a"))))
    }

    @Test
    fun loadsFirstCandidateAfterResolve() {
        val s = Failover.loaded(listOf(cand("a"), cand("b"), cand("c")))
        Assert.assertEquals(0, s.activeIndex)
        Assert.assertEquals("a", s.active?.id)
        Assert.assertEquals(1, s.activeNumber)
        Assert.assertEquals(3, s.total)
        Assert.assertEquals(0, s.refreshesUsed)
    }

    @Test
    fun errorAdvancesThroughCandidates() {
        var s = Failover.loaded(listOf(cand("a"), cand("b"), cand("c")))
        val d1 = Failover.onCandidateError(s)
        Assert.assertTrue(d1 is FailoverDecision.Advance)
        s = (d1 as FailoverDecision.Advance).state
        Assert.assertEquals("b", s.active?.id)

        val d2 = Failover.onCandidateError(s)
        s = (d2 as FailoverDecision.Advance).state
        Assert.assertEquals("c", s.active?.id)
    }

    @Test
    fun exhaustionOffersOneRefreshThenGivesUpLikeTheWeb() {
        var s = Failover.loaded(listOf(cand("a")))
        // First exhaustion → one silent re-resolve allowed.
        val d1 = Failover.onCandidateError(s)
        Assert.assertTrue(d1 is FailoverDecision.RefreshNeeded)
        s = (d1 as FailoverDecision.RefreshNeeded).state
        Assert.assertEquals(1, s.refreshesUsed)

        // Refresh yields new candidates → walk them from index 0.
        val fresh = Failover.onRefreshed(s, listOf(cand("x"), cand("y")))
        Assert.assertNotNull(fresh)
        Assert.assertEquals("x", fresh!!.active?.id)
        Assert.assertEquals(1, fresh.refreshesUsed)

        // Exhaust the refreshed set → refresh budget spent → web's terminal error.
        s = fresh.copy(activeIndex = 1)
        val d2 = Failover.onCandidateError(s)
        Assert.assertTrue(d2 is FailoverDecision.Exhausted)
        Assert.assertEquals(Failover.ALL_FAILED_MSG, (d2 as FailoverDecision.Exhausted).message)
    }

    @Test
    fun refreshWithEmptyResultIsTerminal() {
        val s = FailoverState(candidates = listOf(cand("a")), activeIndex = 0, refreshesUsed = 1)
        Assert.assertNull(Failover.onRefreshed(s, emptyList()))
    }

    @Test
    fun singleCandidateStuckInRefreshLoopIsCapped() {
        // error → RefreshNeeded → refreshed identical list → error → Exhausted.
        var s = Failover.loaded(listOf(cand("only")))
        s = (Failover.onCandidateError(s) as FailoverDecision.RefreshNeeded).state
        s = Failover.onRefreshed(s, listOf(cand("only")))!!
        val d = Failover.onCandidateError(s)
        Assert.assertTrue(d is FailoverDecision.Exhausted)
    }
}
