package local.themashup.music.core.player

import local.themashup.music.core.domain.InsertMode
import local.themashup.music.core.domain.RepeatMode
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.Track
import org.junit.Assert
import org.junit.Test

class PlaybackStateMachineTest {

    private fun track(id: String, artist: String = "Artist") = Track(
        id = id,
        source = "newpipe",
        externalId = id,
        title = "Song $id",
        artistNames = artist,
    )

    private fun cand(id: String, source: String = "newpipe") = StreamCandidate(
        id = id,
        source = source,
        url = "https://cdn/$id",
        mime = "audio/mp4",
        ext = "m4a",
        quality = "128k",
        bitrateKbps = 128,
    )

    private val q3 = listOf(track("a"), track("b"), track("c"))
    private fun rng(value: Double = 0.99): () -> Double = { value }

    /* ── start & resolve ────────────────────────────────────────────────── */

    @Test
    fun playNowKeepsCurrentAndExistingQueueBehindChosenSong() {
        val before = PlayerSnapshot(queue = q3, cursor = 1, status = PlayStatus.PLAYING)
        val (after, effect) = PlaybackStateMachine.playNow(before, track("new"), "search")
        Assert.assertEquals(listOf("a", "new", "b", "c"), after.queue.map { it.id })
        Assert.assertEquals(1, after.cursor)
        Assert.assertEquals("new", (effect as PlayerEffect.Resolve).track.id)
        val (empty, _) = PlaybackStateMachine.playNow(PlayerSnapshot(), track("first"))
        Assert.assertEquals(listOf("first"), empty.queue.map { it.id })
        Assert.assertEquals(0, empty.cursor)
    }

    @Test
    fun manualQueueAndPlayNowDoNotAddSearchResults() {
        val (jhol, _) = PlaybackStateMachine.playNow(PlayerSnapshot(), track("jhol"), "search")
        val queued = PlaybackStateMachine.enqueue(jhol, track("later"), InsertMode.END)
        Assert.assertEquals(listOf("jhol", "later"), queued.queue.map { it.id })
        Assert.assertEquals("jhol", queued.current?.id)
        val (galSun, effect) = PlaybackStateMachine.playNow(queued, track("gal-sun"), "search")
        Assert.assertEquals(listOf("gal-sun", "jhol", "later"), galSun.queue.map { it.id })
        Assert.assertEquals("gal-sun", (effect as PlayerEffect.Resolve).track.id)
        Assert.assertEquals(PlayStatus.LOADING, galSun.status)
    }

    @Test
    fun playQueueStartsResolvingAtRequestedIndex() {
        val (s, e) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, startIndex = 1, startAtMs = 1234)
        Assert.assertEquals(PlayStatus.LOADING, s.status)
        Assert.assertEquals(1, s.cursor)
        Assert.assertNull(s.error)
        val resolve = e as PlayerEffect.Resolve
        Assert.assertEquals("b", resolve.track.id)
        Assert.assertEquals(1234L, resolve.startAtMs)
        Assert.assertFalse(resolve.isRefresh)
    }

    @Test
    fun playQueueClampsIndexAndIgnoresEmptyTrackList() {
        val (s1, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, startIndex = 99)
        Assert.assertEquals(2, s1.cursor)
        val (s2, e2) = PlaybackStateMachine.playQueue(PlayerSnapshot(), emptyList(), 0)
        Assert.assertEquals(PlayerSnapshot(), s2)
        Assert.assertNull(e2)
    }

    @Test
    fun onCandidatesResolvedArmsFailoverAndLoadsFirst() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        val (s, e) = PlaybackStateMachine.onCandidatesResolved(
            loading,
            listOf(cand("c1", "newpipe"), cand("c2", "piped")),
            startAtMs = 0,
            isRefresh = false,
        )
        Assert.assertEquals(PlayStatus.LOADING, s.status)
        Assert.assertEquals("newpipe", s.source)
        Assert.assertEquals(2, s.failover?.total)
        val load = e as PlayerEffect.LoadCandidate
        Assert.assertEquals("c1", load.candidate.id)
    }

    @Test
    fun onCandidatesResolvedWithEmptyListErrorsWithWebMessage() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        val (s, e) = PlaybackStateMachine.onCandidatesResolved(loading, emptyList(), 0, isRefresh = false)
        Assert.assertEquals(PlayStatus.ERROR, s.status)
        Assert.assertEquals(Failover.NO_CANDIDATES_MSG, s.error)
        Assert.assertEquals(Failover.NO_CANDIDATES_MSG, (e as PlayerEffect.Fail).message)
    }

    @Test
    fun onResolveFailedRecordsWarnings() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        val (s, e) = PlaybackStateMachine.onResolveFailed(loading, "network down", listOf("newpipe: boom"))
        Assert.assertEquals(PlayStatus.ERROR, s.status)
        Assert.assertEquals("network down", s.error)
        Assert.assertEquals(listOf("newpipe: boom"), s.warnings)
        Assert.assertTrue(e is PlayerEffect.Fail)
    }

    /* ── candidate failover ─────────────────────────────────────────────── */

    @Test
    fun candidateErrorLoadsNextCandidate() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        val (resolved, _) = PlaybackStateMachine.onCandidatesResolved(
            loading, listOf(cand("x1"), cand("x2")), 0, false,
        )
        val (s, e) = PlaybackStateMachine.onCandidateFailed(resolved)
        Assert.assertEquals(1, s.failover?.activeIndex)
        Assert.assertEquals("x2", (e as PlayerEffect.LoadCandidate).candidate.id)
        Assert.assertEquals(PlayStatus.LOADING, s.status)
    }

    @Test
    fun candidateExhaustionAfterRefreshBudgetIsTerminal() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        var (s, e) = PlaybackStateMachine.onCandidatesResolved(loading, listOf(cand("only")), 0, false)
        // 1st error → refresh request (Resolve with isRefresh + position kept).
        val (s2, e2) = PlaybackStateMachine.onCandidateFailed(s)
        Assert.assertEquals(PlayStatus.LOADING, s2.status)
        val refresh = e2 as PlayerEffect.Resolve
        Assert.assertTrue(refresh.isRefresh)
        // Refresh comes back empty → terminal web error.
        val (s3, e3) = PlaybackStateMachine.onCandidatesResolved(s2, emptyList(), 0, isRefresh = true)
        Assert.assertEquals(PlayStatus.ERROR, s3.status)
        Assert.assertEquals(Failover.ALL_FAILED_MSG, s3.error)
        Assert.assertTrue(e3 is PlayerEffect.Fail)
    }

    @Test
    fun refreshFailureViaResolveFailedIsTerminal() {
        val (loading, _) = PlaybackStateMachine.playQueue(PlayerSnapshot(), q3, 0)
        val (s, _) = PlaybackStateMachine.onCandidateFailed(loading.copy(failover = Failover.loaded(listOf(cand("a")))))
        val (s2, e2) = PlaybackStateMachine.onResolveFailed(s, "HTTP 403", emptyList())
        Assert.assertEquals(PlayStatus.ERROR, s2.status)
        Assert.assertTrue(e2 is PlayerEffect.Fail)
    }

    /* ── transport & next/prev semantics (domain parity) ────────────────── */

    @Test
    fun nextManualWrapsAroundEndWithRepeatOff() {
        val base = PlayerSnapshot(queue = q3, cursor = 2, status = PlayStatus.PLAYING)
        val (s, e) = PlaybackStateMachine.next(base, rng())
        Assert.assertEquals(0, s.cursor)
        Assert.assertEquals(PlayStatus.LOADING, s.status)
        Assert.assertEquals("a", (e as PlayerEffect.Resolve).track.id)
    }

    @Test
    fun autoEndWithRepeatOffStops() {
        val base = PlayerSnapshot(queue = q3, cursor = 2, status = PlayStatus.PLAYING)
        val (s, e) = PlaybackStateMachine.onTrackCompleted(base, rng())
        Assert.assertEquals(PlayStatus.IDLE, s.status)
        Assert.assertEquals(0L, s.positionMs)
        Assert.assertNull(s.failover)
        Assert.assertTrue(e is PlayerEffect.Stop)
    }

    @Test
    fun autoEndWithRepeatAllWrapsToFirst() {
        val base = PlayerSnapshot(queue = q3, cursor = 2, repeat = RepeatMode.ALL, status = PlayStatus.PLAYING)
        val (s, e) = PlaybackStateMachine.onTrackCompleted(base, rng())
        Assert.assertEquals(0, s.cursor)
        Assert.assertEquals("a", (e as PlayerEffect.Resolve).track.id)
    }

    @Test
    fun autoEndWithRepeatOneReplaysSameTrack() {
        val base = PlayerSnapshot(queue = q3, cursor = 1, repeat = RepeatMode.ONE, status = PlayStatus.PLAYING)
        val (s, e) = PlaybackStateMachine.onTrackCompleted(base, rng())
        Assert.assertEquals(1, s.cursor)
        Assert.assertEquals(0L, s.positionMs)
        Assert.assertEquals("b", (e as PlayerEffect.Resolve).track.id)
    }

    @Test
    fun shuffleNextPicksADifferentTrack() {
        val base = PlayerSnapshot(queue = q3, cursor = 0, shuffle = true, status = PlayStatus.PLAYING)
        val (s, _) = PlaybackStateMachine.next(base, rng(0.99))
        Assert.assertNotEquals(0, s.cursor)
        Assert.assertEquals(2, s.cursor) // (0.99 * 3).toInt()
    }

    @Test
    fun prevStepsBackAndRestartsAtStartWithRepeatOff() {
        val mid = PlayerSnapshot(queue = q3, cursor = 1, status = PlayStatus.PLAYING)
        val (s1, e1) = PlaybackStateMachine.prev(mid, rng())
        Assert.assertEquals(0, s1.cursor)
        Assert.assertEquals("a", (e1 as PlayerEffect.Resolve).track.id)

        val start = PlayerSnapshot(queue = q3, cursor = 0, status = PlayStatus.PLAYING)
        val (s2, e2) = PlaybackStateMachine.prev(start, rng())
        // Domain: repeat OFF at start → hold current → machine restarts it.
        Assert.assertEquals(0, s2.cursor)
        Assert.assertTrue(e2 is PlayerEffect.Resolve)
    }

    @Test
    fun prevAtStartWithRepeatAllWrapsToLast() {
        val start = PlayerSnapshot(queue = q3, cursor = 0, repeat = RepeatMode.ALL, status = PlayStatus.PLAYING)
        val (s, e) = PlaybackStateMachine.prev(start, rng())
        Assert.assertEquals(2, s.cursor)
        Assert.assertEquals("c", (e as PlayerEffect.Resolve).track.id)
    }

    @Test
    fun toggleTransitionsAndStartsFromIdleQueue() {
        // Empty → no-op.
        Assert.assertNull(PlaybackStateMachine.toggle(PlayerSnapshot()).second)
        // Playing → pause, paused → play.
        val playing = PlayerSnapshot(status = PlayStatus.PLAYING)
        Assert.assertTrue(PlaybackStateMachine.toggle(playing).second is PlayerEffect.Pause)
        Assert.assertTrue(PlaybackStateMachine.toggle(playing.copy(status = PlayStatus.PAUSED)).second is PlayerEffect.Play)
        // Loading → no-op (deterministic resolve window).
        Assert.assertNull(PlaybackStateMachine.toggle(playing.copy(status = PlayStatus.LOADING)).second)
        // Idle with queued-but-never-loaded tracks → loads index 0.
        val (s, e) = PlaybackStateMachine.toggle(PlayerSnapshot(queue = q3, cursor = -1))
        Assert.assertEquals(0, s.cursor)
        Assert.assertEquals(PlayStatus.LOADING, s.status)
        Assert.assertEquals("a", (e as PlayerEffect.Resolve).track.id)
        // Error → retry current.
        val (s2, e2) = PlaybackStateMachine.toggle(
            PlayerSnapshot(queue = q3, cursor = 1, status = PlayStatus.ERROR, error = "x"),
        )
        Assert.assertEquals(1, s2.cursor)
        Assert.assertNull(s2.error)
        Assert.assertEquals("b", (e2 as PlayerEffect.Resolve).track.id)
    }

    /* ── seek / position / playing ──────────────────────────────────────── */

    @Test
    fun seekClampsAgainstKnownDuration() {
        val s = PlayerSnapshot(durationMs = 10_000)
        val (s1, e1) = PlaybackStateMachine.seek(s, 99_999)
        Assert.assertEquals(10_000L, s1.positionMs)
        Assert.assertEquals(10_000L, (e1 as PlayerEffect.Seek).positionMs)
        val (s2, _) = PlaybackStateMachine.seek(s, -50)
        Assert.assertEquals(0L, s2.positionMs)
    }

    @Test
    fun playingAndBufferingCallbacksAreGuarded() {
        val loading = PlayerSnapshot(status = PlayStatus.LOADING)
        Assert.assertEquals(
            PlayStatus.LOADING,
            PlaybackStateMachine.onPlayingChanged(loading, false).status,
        )
        Assert.assertEquals(
            PlayStatus.PLAYING,
            PlaybackStateMachine.onPlayingChanged(loading, true).status,
        )
        val playing = PlayerSnapshot(status = PlayStatus.PLAYING)
        Assert.assertEquals(
            PlayStatus.PAUSED,
            PlaybackStateMachine.onPlayingChanged(playing, false).status,
        )
        // BUFFERING while playing → LOADING; while idle → untouched.
        Assert.assertEquals(PlayStatus.LOADING, PlaybackStateMachine.onBuffering(playing).status)
        Assert.assertEquals(
            PlayStatus.IDLE,
            PlaybackStateMachine.onBuffering(PlayerSnapshot(status = PlayStatus.IDLE)).status,
        )
    }

    @Test
    fun onPositionKeepsLastKnownDuration() {
        val s = PlaybackStateMachine.onPosition(PlayerSnapshot(), positionMs = 500, durationMs = 0)
        Assert.assertEquals(500L, s.positionMs)
        Assert.assertEquals(0L, s.durationMs)
        val s2 = PlaybackStateMachine.onPosition(s, positionMs = 600, durationMs = 213_000)
        Assert.assertEquals(213_000L, s2.durationMs)
        val s3 = PlaybackStateMachine.onPosition(s2, positionMs = -10, durationMs = 0)
        Assert.assertEquals(0L, s3.positionMs)
        Assert.assertEquals(213_000L, s3.durationMs)
    }

    /* ── repeat / shuffle ───────────────────────────────────────────────── */

    @Test
    fun repeatCyclesOffAllOneAndShuffleSets() {
        var s = PlayerSnapshot()
        s = PlaybackStateMachine.cycleRepeat(s)
        Assert.assertEquals(RepeatMode.ALL, s.repeat)
        s = PlaybackStateMachine.cycleRepeat(s)
        Assert.assertEquals(RepeatMode.ONE, s.repeat)
        s = PlaybackStateMachine.cycleRepeat(s)
        Assert.assertEquals(RepeatMode.OFF, s.repeat)
        Assert.assertTrue(PlaybackStateMachine.setShuffle(s, true).shuffle)
        Assert.assertFalse(PlaybackStateMachine.setShuffle(s, true).let { PlaybackStateMachine.setShuffle(it, false) }.shuffle)
        Assert.assertEquals(RepeatMode.ONE, PlaybackStateMachine.setRepeat(s, RepeatMode.ONE).repeat)
    }

    /* ── queue mutations ────────────────────────────────────────────────── */

    @Test
    fun enqueueInsertsNextAndEnd() {
        var s = PlayerSnapshot(queue = listOf(q3[0]), cursor = 0)
        s = PlaybackStateMachine.enqueue(s, q3[1], InsertMode.NEXT)
        Assert.assertEquals(listOf("a", "b"), s.queue.map { it.id })
        Assert.assertEquals(0, s.cursor)
        s = PlaybackStateMachine.enqueue(s, q3[2], InsertMode.END)
        Assert.assertEquals(listOf("a", "b", "c"), s.queue.map { it.id })
        Assert.assertEquals(0, s.cursor)
    }

    @Test
    fun removingCurrentStopsAndFollowCursorRules() {
        val playing = PlayerSnapshot(queue = q3, cursor = 1, status = PlayStatus.PLAYING, positionMs = 500)
        val (s1, e1) = PlaybackStateMachine.remove(playing, 1)
        Assert.assertEquals(listOf("a", "c"), s1.queue.map { it.id })
        Assert.assertEquals(1, s1.cursor) // clamped onto "c"
        Assert.assertEquals(PlayStatus.IDLE, s1.status)
        Assert.assertTrue(e1 is PlayerEffect.Stop)

        // Removing before the cursor shifts it; no stop.
        val (s2, e2) = PlaybackStateMachine.remove(playing, 0)
        Assert.assertEquals(listOf("b", "c"), s2.queue.map { it.id })
        Assert.assertEquals(0, s2.cursor)
        Assert.assertNull(e2)
        Assert.assertEquals(PlayStatus.PLAYING, s2.status)

        // Out-of-range is a no-op.
        val (s3, e3) = PlaybackStateMachine.remove(playing, 42)
        Assert.assertEquals(playing.queue, s3.queue)
        Assert.assertNull(e3)
    }

    @Test
    fun movingItemsFollowsTheCursor() {
        val base = PlayerSnapshot(queue = q3, cursor = 1, status = PlayStatus.PLAYING)
        // Move current item → cursor follows the same track.
        val s1 = PlaybackStateMachine.move(base, from = 1, to = 2)
        Assert.assertEquals(listOf("a", "c", "b"), s1.queue.map { it.id })
        Assert.assertEquals(2, s1.cursor)
        Assert.assertEquals("b", s1.queue[s1.cursor].id)
        // Move an item across the cursor → cursor shifts to keep the same track.
        val s2 = PlaybackStateMachine.move(base, from = 2, to = 0)
        Assert.assertEquals(listOf("c", "a", "b"), s2.queue.map { it.id })
        // from(2) > cursor(1) && to(0) <= cursor → cursor+1 keeps pointing at "b".
        Assert.assertEquals(2, s2.cursor)
        Assert.assertEquals("b", s2.queue[s2.cursor].id)
        // No-op move.
        val s3 = PlaybackStateMachine.move(base, from = 1, to = 1)
        Assert.assertEquals(base.queue, s3.queue)
        Assert.assertEquals(1, s3.cursor)
    }

    @Test
    fun clearResetsEverythingAndStops() {
        val base = PlayerSnapshot(
            queue = q3, cursor = 1, status = PlayStatus.PLAYING,
            failover = Failover.loaded(listOf(cand("x"))), source = "newpipe", positionMs = 100,
        )
        val (s, e) = PlaybackStateMachine.clear(base)
        Assert.assertEquals(PlayerSnapshot(), s)
        Assert.assertTrue(e is PlayerEffect.Stop)
    }

    @Test
    fun playQueueCarriesContextLabel() {
        val radio = PlaybackStateMachine.playQueue(
            PlayerSnapshot(),
            listOf(track("a")),
            0,
            context = "radio",
        )
        Assert.assertEquals("radio", radio.first.contextLabel)
        val swapped = PlaybackStateMachine.playQueue(
            radio.first,
            listOf(track("b")),
            0,
            context = "home",
        )
        Assert.assertEquals("home", swapped.first.contextLabel)
        val none = PlaybackStateMachine.playQueue(PlayerSnapshot(), listOf(track("a")), 0)
        Assert.assertNull(none.first.contextLabel)
        // Empty queue leaves the snapshot (and its label) untouched.
        val untouched = PlaybackStateMachine.playQueue(radio.first, emptyList(), 0)
        Assert.assertEquals("radio", untouched.first.contextLabel)
    }

}
