package local.themashup.music.core.network.logic

import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.Track
import org.junit.Assert
import org.junit.Test

class ExtractionLogicTest {

    private fun track(id: String, title: String, artist: String) = Track(
        id = id,
        source = "newpipe",
        externalId = id,
        title = title,
        artistNames = artist,
    )

    private class FakeSource(
        override val id: String,
        private val tracks: List<Track> = emptyList(),
        private val streams: SourceStreams? = null,
        private val error: String? = null,
    ) : MusicSource {
        override fun search(query: String, limit: Int): List<Track> {
            error?.let { throw RuntimeException(it) }
            return tracks.take(limit)
        }

        override fun streams(videoId: String): SourceStreams {
            error?.let { throw RuntimeException(it) }
            return streams ?: SourceStreams()
        }
    }

    /* ── InstancePool (resolver base.py port) ───────────────────────────── */

    @Test
    fun poolRotatesAndCoolsDown() {
        var now = 1L // resolver's monotonic clock is always > 0
        val pool = InstancePool(
            listOf("https://a.example", "https://b.example/"),
            nowMs = { now },
        )
        Assert.assertEquals(listOf("https://a.example", "https://b.example"), pool.all)
        // Initial order preserved (trailing slashes stripped).
        Assert.assertEquals(pool.all, pool.ordered())

        pool.markDown("https://a.example")
        Assert.assertEquals(listOf("https://b.example"), pool.ordered())

        // Cooldown elapses → instance returns.
        now += InstancePool.DEFAULT_COOLDOWN_MS + 1
        Assert.assertEquals(pool.all, pool.ordered())

        // Everything cooling off → retry all anyway (resolver behaviour).
        pool.markDown("https://a.example")
        pool.markDown("https://b.example")
        Assert.assertEquals(pool.all, pool.ordered())
    }

    /* ── priority constant ──────────────────────────────────────────────── */

    @Test
    fun sourcePrioritiesMatchContracts() {
        Assert.assertEquals(listOf("newpipe", "piped", "invidious"), SourcePriority.NATIVE)
        Assert.assertEquals(listOf("ytdlp", "piped", "invidious"), SourcePriority.RESOLVER)
    }

    @Test
    fun fallbackHostsMirrorResolverDefaults() {
        Assert.assertEquals(3, FallbackHosts.PIPED.size)
        Assert.assertEquals(3, FallbackHosts.INVIDIOUS.size)
        Assert.assertTrue(FallbackHosts.PIPED.all { it.startsWith("https://") })
        Assert.assertTrue(FallbackHosts.INVIDIOUS.all { it.startsWith("https://") })
        Assert.assertEquals(8L, FallbackHosts.REQUEST_TIMEOUT_SECONDS)
    }

    /* ── search walk ────────────────────────────────────────────────────── */

    @Test
    fun searchUsesPrimaryFirstWithoutWarnings() {
        val out = ExtractionLogic.search(
            listOf(FakeSource("newpipe", listOf(track("a", "A", "X"))), FakeSource("piped", listOf(track("b", "B", "Y")))),
            "query",
        )
        Assert.assertEquals("newpipe", out.source)
        Assert.assertFalse(out.degraded)
        Assert.assertTrue(out.warnings.isEmpty())
        Assert.assertEquals(listOf("a"), out.tracks.map { it.id })
    }

    @Test
    fun searchFallsBackOnlyAfterPrimaryFailure() {
        val out = ExtractionLogic.search(
            listOf(
                FakeSource("newpipe", error = "boom"),
                FakeSource("piped", listOf(track("b", "B", "Y"))),
                FakeSource("invidious", listOf(track("c", "C", "Z"))),
            ),
            "query",
        )
        Assert.assertEquals("piped", out.source)
        Assert.assertTrue("primary failed → degraded", out.degraded)
        Assert.assertEquals(1, out.warnings.size)
        Assert.assertTrue(out.warnings[0].startsWith("newpipe:"))
        Assert.assertEquals(listOf("b"), out.tracks.map { it.id })
    }

    @Test
    fun searchTreatsEmptyResultsAsFailureAndSkipsAhead() {
        val out = ExtractionLogic.search(
            listOf(
                FakeSource("newpipe", emptyList()),
                FakeSource("piped", listOf(track("c", "C", "Z"))),
            ),
            "query",
        )
        Assert.assertEquals("piped", out.source)
        Assert.assertTrue(out.degraded)
        Assert.assertEquals("newpipe: no results", out.warnings[0])
    }

    @Test
    fun searchTotalFailureIsDegradedEmpty() {
        val out = ExtractionLogic.search(
            listOf(FakeSource("newpipe", error = "a"), FakeSource("piped", error = "b"), FakeSource("invidious", error = "c")),
            "query",
        )
        Assert.assertEquals("none", out.source)
        Assert.assertTrue(out.degraded)
        Assert.assertTrue(out.tracks.isEmpty())
        Assert.assertEquals(3, out.warnings.size)
    }

    /* ── streams walk ───────────────────────────────────────────────────── */

    private fun cand(id: String) = StreamCandidate(
        id = id, source = "newpipe", url = "https://cdn/$id",
        mime = "audio/mp4", ext = "m4a", quality = "128k", bitrateKbps = 128,
    )

    @Test
    fun streamsPreserveCandidateOrderAndDegradeOnFallback() {
        val primary = FakeSource("newpipe", error = "extractor 403")
        val backup = FakeSource(
            "piped",
            streams = SourceStreams(
                candidates = listOf(cand("c1"), cand("c2")),
                related = listOf(track("r1", "Related", "W")),
            ),
        )
        val out = ExtractionLogic.streams(listOf(primary, backup), "vid12345678")
        Assert.assertTrue(out.degraded)
        Assert.assertEquals("piped", out.source)
        Assert.assertEquals(listOf("c1", "c2"), out.candidates.map { it.id })
        Assert.assertEquals(1, out.related.size)
        Assert.assertTrue(out.resolutionMs >= 0)
        Assert.assertTrue(out.warnings[0].startsWith("newpipe:"))
    }

    @Test
    fun streamsTotalFailureReturnsEmptyDegraded() {
        val out = ExtractionLogic.streams(
            listOf(FakeSource("newpipe", error = "x"), FakeSource("piped", streams = SourceStreams())),
            "vid12345678",
        )
        Assert.assertTrue(out.degraded)
        Assert.assertEquals("none", out.source)
        Assert.assertTrue(out.candidates.isEmpty())
        Assert.assertTrue(out.warnings.isNotEmpty())
    }
}
