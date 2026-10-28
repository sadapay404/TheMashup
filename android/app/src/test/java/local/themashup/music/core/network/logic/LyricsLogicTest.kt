package local.themashup.music.core.network.logic

import org.junit.Assert
import org.junit.Test

class LyricsLogicTest {

    /** The exact FIXTURE_LYRICS records from apps/api/src/services/lyrics.ts. */
    private val nova = LrclibRecord(
        id = 900001,
        trackName = "Midnight Mirage",
        artistName = "Nova Arcade",
        albumName = "Chrome Gardens",
        duration = 214,
        plainLyrics = "City hums in ultraviolet\nSignals fold into the night\nEvery shadow keeps a secret\nEvery street becomes a light",
        syncedLyrics = "[00:00.00]City hums in ultraviolet\n[00:07.50]Signals fold into the night\n[00:15.00]Every shadow keeps a secret\n[00:23.00]Every street becomes a light\n",
    )
    private val crowns = LrclibRecord(
        id = 900002,
        trackName = "Paper Crowns",
        artistName = "Elder & Vine",
        albumName = "Quiet Riot Season",
        duration = 187,
        plainLyrics = "We wore paper crowns\nAnd swore they were gold",
        syncedLyrics = "[00:04.00]We wore paper crowns\n[00:11.00]And swore they were gold\n[00:19.00]The rain had other plans\n",
    )
    private val tide = LrclibRecord(
        id = 900003,
        trackName = "Neon Tide",
        artistName = "Kite Society",
        albumName = "Afterglow Club",
        duration = 231,
        plainLyrics = "Ride the neon tide\nHold the current close",
        syncedLyrics = "[00:02.00]Ride the neon tide\n[00:10.00]Hold the current close\n[00:18.00]Nothing here is borrowed\n",
    )
    private val fixtures = listOf(nova, crowns, tide)

    /* ── URLs ───────────────────────────────────────────────────────────── */

    @Test
    fun urlBuildersMatchWebContract() {
        Assert.assertEquals(
            "https://lrclib.net/api/search?q=blinding+lights",
            LyricsLogic.searchUrl("blinding lights"),
        )
        Assert.assertEquals(
            "https://lrclib.net/api/get?track_name=Song&artist_name=Artist",
            LyricsLogic.getUrl("Song", "Artist", durationSec = null),
        )
        Assert.assertEquals(
            "https://lrclib.net/api/get?track_name=My+Song&artist_name=Some+Artist&duration=214",
            LyricsLogic.getUrl("My Song", "Some Artist", durationSec = 214),
        )
        // duration omitted when absent/negative (web: only set when truthy).
        Assert.assertFalse(LyricsLogic.getUrl("A", "B", durationSec = 0).contains("duration"))
    }

    /* ── bestLine ───────────────────────────────────────────────────────── */

    @Test
    fun bestLinePicksMostSimilarLineFromPlainLyrics() {
        val line = LyricsLogic.bestLine(nova, "city hums in ultraviolet")
        Assert.assertEquals("City hums in ultraviolet", line)
    }

    @Test
    fun bestLineStripsLrcTagsWhenPlainIsAbsent() {
        val line = LyricsLogic.bestLine(tide, "ride the neon tide")
        Assert.assertEquals("Ride the neon tide", line)
    }

    @Test
    fun bestLineBelowThresholdIsUndefined() {
        Assert.assertNull(LyricsLogic.bestLine(nova, "quantum fermion zebra"))
        Assert.assertNull(LyricsLogic.bestLine(crowns.copy(plainLyrics = null, syncedLyrics = null), "anything"))
    }

    /* ── recordToMatch ──────────────────────────────────────────────────── */

    @Test
    fun recordToMatchUsesMaxOfMetadataAndBodyScores() {
        // Metadata query: title/artist dominates.
        val meta = LyricsLogic.recordToMatch(nova, "midnight mirage nova arcade")
        Assert.assertEquals("Midnight Mirage", meta.trackName)
        Assert.assertEquals(900001L, meta.lrclibId)
        Assert.assertTrue("synced/plain flags", meta.synced && meta.plain)
        Assert.assertTrue(meta.similarity > 0.5)
        // Lyric-body query: plain-text similarity dominates (Dice over the
        // whole 4-line body — exact TS value ≈ 0.36, above match threshold).
        val body = LyricsLogic.recordToMatch(nova, "every street becomes a light")
        Assert.assertNotNull(body.snippet)
        Assert.assertTrue("body score ${body.similarity}", body.similarity > 0.3)
        Assert.assertTrue(body.similarity > 0.0)
    }

    @Test
    fun recordToMatchSimilarityNeverExceedsOne() {
        for (r in fixtures) {
            val m = LyricsLogic.recordToMatch(r, "the")
            Assert.assertTrue(m.similarity in 0.0..1.0)
        }
    }

    /* ── pickBest / forTrack ────────────────────────────────────────────── */

    @Test
    fun pickBestRewardsDurationWindowAndSynced() {
        val near = crowns.copy(id = 1, duration = 214, trackName = "Midnight Mirage", artistName = "Nova Arcade")
        val far = nova.copy(id = 2, duration = 300)
        val got = LyricsLogic.pickBest(listOf(far, near), "Midnight Mirage", "Nova Arcade", duration = 214)
        Assert.assertEquals("near match wins on +duration(+synced)", 1L, got?.id)
    }

    @Test
    fun forTrackPrefersDirectRecordElseSearchFallback() {
        // Direct (/api/get hit).
        val direct = LyricsLogic.forTrack(nova, emptyList(), "Midnight Mirage", "Nova Arcade", 214)
        Assert.assertEquals(900001L, direct?.id)
        // Fallback via search + pickBest.
        val fallback = LyricsLogic.forTrack(null, fixtures, "Midnight Mirage", "Nova Arcade", 214)
        Assert.assertEquals(900001L, fallback?.id)
        // Nothing anywhere.
        Assert.assertNull(LyricsLogic.forTrack(null, emptyList(), "X", "Y", null))
    }

    /* ── match pipeline ─────────────────────────────────────────────────── */

    @Test
    fun matchFiltersThresholdsSortsAndCapsAtEight() {
        val ranked = LyricsLogic.match(fixtures, "city hums in ultraviolet")
        Assert.assertTrue("top hit first", ranked.isNotEmpty())
        Assert.assertEquals(900001L, ranked[0].lrclibId)
        // Sorted descending.
        for (i in 1 until ranked.size) {
            Assert.assertTrue(ranked[i - 1].similarity >= ranked[i].similarity)
        }
        // Threshold: unrelated query → no matches.
        Assert.assertTrue(LyricsLogic.match(fixtures, "zzzz qqqq").isEmpty())
        // Cap at 8 even with 10 qualifying near-duplicates.
        val ten = (1L..10L).map { nova.copy(id = it) }
        Assert.assertEquals(LyricsLogic.MATCH_LIMIT, LyricsLogic.match(ten, "city hums in ultraviolet").size)
        // Web also slices input at 20.
        val huge = (1L..30L).map { nova.copy(id = it) }
        Assert.assertTrue(huge.drop(LyricsLogic.SEARCH_SLICE).none { rec ->
            LyricsLogic.match(huge, "city hums in ultraviolet").any { it.lrclibId == rec.id }
        })
    }

    /* ── toLyrics ───────────────────────────────────────────────────────── */

    @Test
    fun toLyricsParsesSyncedAndKeepsMetadata() {
        val l = LyricsLogic.toLyrics(nova)
        Assert.assertEquals("lrclib", l.provider)
        Assert.assertEquals("City hums in ultraviolet\nSignals fold into the night\nEvery shadow keeps a secret\nEvery street becomes a light", l.plain)
        Assert.assertEquals(4, l.synced.size)
        Assert.assertEquals(0.0, l.synced[0].time, 0.0001)
        Assert.assertEquals("Signals fold into the night", l.synced[1].text)
        Assert.assertFalse(l.instrumental)
        val inst = LyricsLogic.toLyrics(nova.copy(plainLyrics = null, syncedLyrics = null, instrumental = true), "mock")
        Assert.assertEquals("mock", inst.provider)
        Assert.assertTrue(inst.instrumental)
        Assert.assertTrue(inst.synced.isEmpty())
        Assert.assertNull(inst.plain)
    }
}
