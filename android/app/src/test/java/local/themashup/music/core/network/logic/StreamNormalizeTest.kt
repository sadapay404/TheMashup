package local.themashup.music.core.network.logic

import org.junit.Assert
import org.junit.Test

class StreamNormalizeTest {

    @Test
    fun expiresIsoParsesExpireParam() {
        Assert.assertEquals(
            "2023-11-14T22:13:20Z",
            StreamNormalize.expiresIso("https://cdn.example/videoplayback?expire=1700000000&ei=x"),
        )
        Assert.assertNull(StreamNormalize.expiresIso("https://cdn.example/videoplayback?itag=251"))
        Assert.assertNull(StreamNormalize.expiresIso(null))
        Assert.assertNull(StreamNormalize.expiresIso("https://x/?expire=abc"))
    }

    @Test
    fun extFromMimeFollowsResolverRules() {
        Assert.assertEquals("m4a", StreamNormalize.extFromMimeOrType("audio/mp4; codecs=\"mp4a.40.2\""))
        Assert.assertEquals("webm", StreamNormalize.extFromMimeOrType("audio/webm; codecs=\"opus\""))
        Assert.assertEquals("audio", StreamNormalize.extFromMimeOrType("application/octet-stream"))
    }

    @Test
    fun bitrateAndSizeConversions() {
        Assert.assertEquals(128, StreamNormalize.kbpsFromBits(128_000L))
        Assert.assertEquals(256, StreamNormalize.kbpsFromBits(256_512L))
        Assert.assertNull(StreamNormalize.kbpsFromBits(null))
        Assert.assertNull(StreamNormalize.kbpsFromBits(0L))
        Assert.assertEquals(4_000_000L, StreamNormalize.sizeFrom("4000000"))
        Assert.assertNull(StreamNormalize.sizeFrom(""))
        Assert.assertNull(StreamNormalize.sizeFrom("4.1MB"))
        Assert.assertNull(StreamNormalize.sizeFrom(null))
    }

    @Test
    fun qualityLabelFallbackChain() {
        Assert.assertEquals("128kbps", StreamNormalize.qualityLabel("128kbps", 192, "webm"))
        Assert.assertEquals("256k", StreamNormalize.qualityLabel(null, 256, "webm"))
        Assert.assertEquals("m4a", StreamNormalize.qualityLabel(null, null, "m4a"))
        Assert.assertEquals("webm", StreamNormalize.qualityLabel("  ", null, "webm"))
    }

    @Test
    fun pipedCandidateMapping() {
        val c = StreamNormalize.fromPipedAudio(
            url = "https://cdn/videoplayback?expire=1700000000&itag=251",
            mimeType = "audio/webm; codecs=\"opus\"",
            quality = null,
            bitrateBps = 160_000L,
            contentLength = "1234567",
        )
        Assert.assertNotNull(c)
        c!!
        Assert.assertEquals("piped", c.source)
        Assert.assertEquals("webm", c.ext)
        Assert.assertEquals(160, c.bitrateKbps)
        Assert.assertEquals("160k", c.quality)
        Assert.assertFalse(c.hasVideo)
        Assert.assertEquals(1_234_567L, c.sizeBytes)
        Assert.assertEquals("2023-11-14T22:13:20Z", c.expiresAt)
        Assert.assertEquals("https://www.youtube.com/", c.httpHeaders["Referer"])
        // Default mime when missing.
        val d = StreamNormalize.fromPipedAudio("https://cdn/x", null, "low", null, "nope")
        Assert.assertEquals("audio/webm", d!!.mime)
        Assert.assertEquals("low", d.quality)
        Assert.assertNull(d.sizeBytes)
        // Null url → no candidate.
        Assert.assertNull(StreamNormalize.fromPipedAudio(null, null, null, null, null))
    }

    @Test
    fun invidiousCandidateMappingUsesTypeAsMime() {
        val c = StreamNormalize.fromInvidiousAudio(
            url = "https://cdn/audio.mp4",
            type = "audio/mp4; codecs=\"mp4a.40.2\"",
            audioQuality = "medium",
            bitrateBps = 128_000L,
            size = "999",
        )
        Assert.assertNotNull(c)
        c!!
        Assert.assertEquals("invidious", c.source)
        Assert.assertEquals("m4a", c.ext)
        Assert.assertEquals("audio/mp4; codecs=\"mp4a.40.2\"", c.mime)
        Assert.assertEquals("medium", c.quality)
        Assert.assertEquals(128, c.bitrateKbps)
        Assert.assertEquals(999L, c.sizeBytes)
    }

    @Test
    fun newPipeBitrateHeuristicHandlesBothUnits() {
        // Quality string wins.
        Assert.assertEquals(128, StreamNormalize.kbpsFromNewPipe("128kbps", -1))
        Assert.assertEquals(160, StreamNormalize.kbpsFromNewPipe("160kbps", 160043))
        // Bits/s (typical) → /1000.
        Assert.assertEquals(128, StreamNormalize.kbpsFromNewPipe(null, 128_044))
        Assert.assertEquals(128, StreamNormalize.kbpsFromNewPipe("high", 128_044))
        // Already-kbps small values pass through.
        Assert.assertEquals(96, StreamNormalize.kbpsFromNewPipe(null, 96))
        // UNKNOWN_BITRATE (-1) / absent → null.
        Assert.assertNull(StreamNormalize.kbpsFromNewPipe(null, -1))
        Assert.assertNull(StreamNormalize.kbpsFromNewPipe(null, null))
        Assert.assertNull(StreamNormalize.kbpsFromNewPipe("auto", -1))
    }

    @Test
    fun sortIsBitrateDescendingWithNullsLast() {
        val mk = { kbps: Int? ->
            StreamNormalize.candidate("piped", "https://cdn/$kbps", "audio/webm", null, null, null)
                .let { it!!.copy(bitrateKbps = kbps) }
        }
        val sorted = StreamNormalize.sortCandidates(listOf(mk(128), mk(null), mk(320), mk(64)))
        Assert.assertEquals(listOf(320, 128, 64, null), sorted.map { it.bitrateKbps })
    }
}
