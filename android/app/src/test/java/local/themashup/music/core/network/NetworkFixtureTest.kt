package local.themashup.music.core.network

import local.themashup.music.core.network.logic.LyricsLogic
import local.themashup.music.core.network.parsing.InvidiousParsing
import local.themashup.music.core.network.parsing.LrclibParsing
import local.themashup.music.core.network.parsing.PipedParsing
import org.junit.Assert
import org.junit.Test

/**
 * Fixture-driven parsing tests (real JSON shapes from Piped/Invidious/LRCLIB).
 * Gradle/JVM-only: needs the kotlinx-serialization runtime. The pure mapping
 * rules these feed into are additionally covered in-sandbox under
 * `network/logic/` (see scripts/test-kotlin-domain.sh).
 */
class NetworkFixtureTest {

    private fun fixture(name: String): String =
        requireNotNull(javaClass.getResourceAsStream("/fixtures/$name")) { "missing fixture $name" }
            .bufferedReader().use { it.readText() }

    /* ── Piped ──────────────────────────────────────────────────────────── */

    @Test
    fun pipedSearchMapsItemsAndDropsIdless() {
        val tracks = PipedParsing.search(fixture("piped_search.json"), limit = 20)
        Assert.assertEquals(2, tracks.size)

        val rick = tracks[0]
        Assert.assertEquals("dQw4w9WgXcQ", rick.id)
        Assert.assertEquals("Never Gonna Give You Up", rick.title)
        Assert.assertEquals("Rick Astley", rick.artistNames)
        Assert.assertEquals("piped", rick.source)
        Assert.assertEquals(213, rick.durationSec)
        Assert.assertEquals("song", rick.category)
        Assert.assertEquals(
            "largest thumb wins",
            "https://i.ytimg.com/sb/abc/hq720.jpg",
            rick.artwork,
        )

        val despacito = tracks[1]
        Assert.assertEquals("kJQP7kiw5Fk", despacito.id)
        Assert.assertEquals("Luis Fonsi", despacito.artistNames)
        Assert.assertEquals(282, despacito.durationSec)
        Assert.assertEquals("https://i.ytimg.com/vi/kJQP7kiw5Fk/hq720.jpg", despacito.artwork)
    }

    @Test
    fun pipedSearchHonoursLimit() {
        val tracks = PipedParsing.search(fixture("piped_search.json"), limit = 1)
        Assert.assertEquals(1, tracks.size)
    }

    @Test
    fun pipedStreamsMapCandidatesSortedAndRelatedVideoCategory() {
        val (candidates, related) = PipedParsing.streams(fixture("piped_streams.json"))
        Assert.assertEquals("null-url stream dropped", 2, candidates.size)
        // 160kbps first.
        Assert.assertEquals(160, candidates[0].bitrateKbps)
        Assert.assertEquals("webm", candidates[0].ext)
        Assert.assertEquals(8_461_234L, candidates[0].sizeBytes)
        Assert.assertEquals("2023-11-14T22:13:20Z", candidates[0].expiresAt)
        Assert.assertEquals(128, candidates[1].bitrateKbps)
        Assert.assertEquals("m4a", candidates[1].ext)
        Assert.assertEquals("number contentLength parsed", 7_123_456L, candidates[1].sizeBytes)
        Assert.assertTrue(candidates.none { it.hasVideo })

        Assert.assertEquals(1, related.size)
        Assert.assertEquals("9bZkp7q19f0", related[0].id)
        Assert.assertEquals("video", related[0].category)
    }

    @Test
    fun pipedSuggestionsSlice() {
        Assert.assertEquals(3, PipedParsing.suggestions(fixture("piped_suggest.json"), limit = 3).size)
        Assert.assertEquals(4, PipedParsing.suggestions(fixture("piped_suggest.json"), limit = 8).size)
    }

    /* ── Invidious ──────────────────────────────────────────────────────── */

    @Test
    fun invidiousSearchSupportsArrayAndIdFallback() {
        val tracks = InvidiousParsing.search(fixture("invidious_search.json"), limit = 20)
        Assert.assertEquals(2, tracks.size)
        Assert.assertEquals("JGwWNGJdvx8", tracks[0].id)
        Assert.assertEquals("Ed Sheeran", tracks[0].artistNames)
        Assert.assertEquals("UC4eYXhJI4-75SW3Vw-z5SRA", tracks[0].artists[0].channelId)
        Assert.assertEquals("OPf0YbXqDm0", tracks[1].id)
        Assert.assertEquals("Mark Ronson", tracks[1].artistNames)
        Assert.assertEquals(270, tracks[1].durationSec)
        Assert.assertTrue(tracks.all { it.source == "invidious" && it.category == "video" })
    }

    @Test
    fun invidiousStreamsFilterAudioSortAndPreferRecommended() {
        val (candidates, related) = InvidiousParsing.streams(fixture("invidious_video.json"))
        Assert.assertEquals("audio-only, url-required", 2, candidates.size)
        Assert.assertEquals(160, candidates[0].bitrateKbps) // 160k > 128k
        Assert.assertEquals("webm", candidates[0].ext)
        Assert.assertEquals(8_400_000L, candidates[0].sizeBytes) // from `size`
        Assert.assertEquals(128, candidates[1].bitrateKbps)
        Assert.assertEquals("m4a", candidates[1].ext)
        Assert.assertEquals("AUDIO_QUALITY_MEDIUM", candidates[1].quality)
        Assert.assertEquals(7_100_000L, candidates[1].sizeBytes)

        Assert.assertEquals(1, related.size)
        Assert.assertEquals("OPf0YbXqDm0", related[0].id)
        Assert.assertEquals("recommendedVideos wins over recommendations", "video", related[0].category)
    }

    @Test
    fun invidiousStreamsFallBackToRecommendationsKey() {
        val body = """
            {"adaptiveFormats":[],
             "recommendations":[{"videoId":"abc123def45","title":"T","author":"A","lengthSeconds":12}]}
        """.trimIndent()
        val (candidates, related) = InvidiousParsing.streams(body)
        Assert.assertTrue(candidates.isEmpty())
        Assert.assertEquals(1, related.size)
        Assert.assertEquals("abc123def45", related[0].id)
    }

    /* ── LRCLIB ─────────────────────────────────────────────────────────── */

    @Test
    fun lrclibSearchParsesRecordsIgnoringUnknownFields() {
        val records = LrclibParsing.search(fixture("lrclib_search.json"))
        Assert.assertEquals(2, records.size)
        Assert.assertEquals(900001L, records[0].id)
        Assert.assertEquals("Midnight Mirage", records[0].trackName)
        Assert.assertEquals(214, records[0].duration)
        Assert.assertNotNull(records[0].syncedLyrics)
        Assert.assertFalse(records[0].instrumental)
        Assert.assertEquals(900002L, records[1].id)
        Assert.assertNull(records[1].instrumental) // absent → false default
    }

    @Test
    fun lrclibGetParsesSingleRecord() {
        val r = LrclibParsing.get(fixture("lrclib_get.json"))
        Assert.assertEquals(900003L, r.id)
        Assert.assertEquals("Neon Tide", r.trackName)
        Assert.assertEquals("Kite Society", r.artistName)
        Assert.assertEquals(231, r.duration)
    }

    @Test
    fun parseThenMatchPipelineEndToEnd() {
        val records = LrclibParsing.search(fixture("lrclib_search.json"))
        val ranked = LyricsLogic.match(records, "city hums in ultraviolet")
        Assert.assertEquals(1, ranked.size)
        Assert.assertEquals(900001L, ranked[0].lrclibId)
        Assert.assertNotNull(ranked[0].snippet)

        val lyrics = LyricsLogic.toLyrics(LrclibParsing.get(fixture("lrclib_get.json")))
        Assert.assertEquals(3, lyrics.synced.size)
        Assert.assertEquals("lrclib", lyrics.provider)
    }
}
