package local.themashup.music.core.network.logic

import org.junit.Assert
import org.junit.Test

class TrackNormalizeTest {

    /* ── parse_duration (normalize.py) ──────────────────────────────────── */

    @Test
    fun parseDurationAcceptsNumbersStringsAndClockFormats() {
        Assert.assertEquals(214, TrackNormalize.parseDuration(214))
        Assert.assertEquals(214, TrackNormalize.parseDuration(214.7))
        Assert.assertEquals(214, TrackNormalize.parseDuration("214"))
        Assert.assertEquals(214, TrackNormalize.parseDuration("3:34"))
        Assert.assertEquals(3723, TrackNormalize.parseDuration("1:02:03"))
        Assert.assertEquals(62, TrackNormalize.parseDuration("1:02"))
        Assert.assertEquals(42, TrackNormalize.parseDuration("  42 "))
    }

    @Test
    fun parseDurationRejectsNullZeroAndGarbage() {
        Assert.assertNull(TrackNormalize.parseDuration(null))
        Assert.assertNull(TrackNormalize.parseDuration(0))
        Assert.assertNull(TrackNormalize.parseDuration(-5))
        Assert.assertNull(TrackNormalize.parseDuration(""))
        Assert.assertNull(TrackNormalize.parseDuration("abc"))
        Assert.assertNull(TrackNormalize.parseDuration("1:2x"))
        Assert.assertNull(TrackNormalize.parseDuration("0:00"))
        Assert.assertNull(TrackNormalize.parseDuration("1:60:00:01"))
    }

    /* ── best_thumb ─────────────────────────────────────────────────────── */

    @Test
    fun bestThumbPicksLargestArea() {
        val thumbs = listOf(
            mapOf("url" to "small", "width" to 120, "height" to 90),
            mapOf("url" to "big", "width" to 1280, "height" to 720),
            mapOf("url" to "mid", "width" to 480, "height" to 360),
        )
        Assert.assertEquals("big", TrackNormalize.bestThumb(thumbs))
        Assert.assertEquals("small", TrackNormalize.bestThumb(thumbs, pick = "min"))
    }

    @Test
    fun bestThumbEdgeCases() {
        Assert.assertNull(TrackNormalize.bestThumb(null))
        Assert.assertNull(TrackNormalize.bestThumb(emptyList()))
        Assert.assertNull(TrackNormalize.bestThumb(listOf(mapOf("width" to 10))))
        // No dimensions → first url wins.
        Assert.assertEquals(
            "u1",
            TrackNormalize.bestThumb(listOf(mapOf("url" to "u1"), mapOf("url" to "u2"))),
        )
    }

    /* ── track() builder ────────────────────────────────────────────────── */

    @Test
    fun trackCleansArtistsAndAppliesFallbacks() {
        val t = TrackNormalize.track(
            videoId = "abc123abc00",
            title = "",
            artists = listOf(
                mapOf("name" to "Artist A", "channel_id" to "UC1"),
                mapOf("name" to "Artist B"),
                mapOf("name" to "", "channel_id" to "UC2"),
            ),
            source = "piped",
            duration = "3:34",
            artwork = "cover.jpg",
            category = "song",
        )
        Assert.assertEquals("Unknown title", t.title)
        Assert.assertEquals("Artist A, Artist B", t.artistNames)
        Assert.assertEquals(2, t.artists.size)
        Assert.assertEquals("UC1", t.artists[0].channelId)
        Assert.assertEquals(214, t.durationSec)
        Assert.assertEquals("cover.jpg", t.artwork)
        Assert.assertEquals("cover.jpg", t.artworkBest)
        Assert.assertEquals("piped", t.source)
        Assert.assertEquals("abc123abc00", t.externalId)
        Assert.assertEquals("song", t.category)
    }

    @Test
    fun trackFallsBackToUnknownArtist() {
        val t = TrackNormalize.track(
            videoId = "x0000000001",
            title = "T",
            artists = emptyList(),
            source = "invidious",
        )
        Assert.assertEquals("Unknown artist", t.artistNames)
        Assert.assertTrue(t.artists.isEmpty())
        Assert.assertNull(t.durationSec)
    }
}
