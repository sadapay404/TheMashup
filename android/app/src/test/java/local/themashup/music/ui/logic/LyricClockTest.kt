package local.themashup.music.ui.logic

import local.themashup.music.core.domain.LyricLine
import org.junit.Assert
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

class LyricClockTest {

    private fun lines(vararg times: Double) = times.mapIndexed { i, t -> LyricLine(t, "line$i") }

    @Test
    fun emptyLinesYieldMinusOne() {
        Assert.assertEquals(-1, activeLineIndex(emptyList(), 10.0))
    }

    @Test
    fun beforeFirstLineIsMinusOne() {
        Assert.assertEquals(-1, activeLineIndex(lines(1.0, 5.0), 0.5))
    }

    @Test
    fun exactHitSelectsThatLine() {
        Assert.assertEquals(1, activeLineIndex(lines(1.0, 5.0, 9.0), 5.0))
    }

    @Test
    fun betweenLinesSelectsLastPassed() {
        // 4.94 + 0.05 = 4.99 < 5.0 → still line 0 (web +0.05 tolerance).
        Assert.assertEquals(0, activeLineIndex(lines(1.0, 5.0, 9.0), 4.94))
        // 4.96 + 0.05 = 5.01 ≥ 5.0 → line 1 already active.
        Assert.assertEquals(1, activeLineIndex(lines(1.0, 5.0, 9.0), 4.96))
        Assert.assertEquals(1, activeLineIndex(lines(1.0, 5.0, 9.0), 5.2))
        Assert.assertEquals(2, activeLineIndex(lines(1.0, 5.0, 9.0), 100.0))
    }

    @Test
    fun tolerancePlusFiveHundredthsCountsAsActive() {
        val l = lines(1.0, 5.0)
        // 4.96 + 0.05 = 5.01 >= 5.0 → line 1 active (web position + 0.05).
        Assert.assertEquals(1, activeLineIndex(l, 4.96))
        Assert.assertEquals(0, activeLineIndex(l, 4.90))
    }

    @Test
    fun customTolerance() {
        Assert.assertEquals(1, activeLineIndex(lines(1.0, 5.0), 4.8, tolerance = 0.5))
        Assert.assertEquals(0, activeLineIndex(lines(1.0, 5.0), 4.4, tolerance = 0.5))
    }

    private val now = Instant.parse("2026-10-27T12:00:00Z").toEpochMilli()
    private val min = 60_000L

    @Test
    fun relativeTimeBuckets() {
        Assert.assertEquals("just now", relativeTime(iso(now), now))
        Assert.assertEquals("just now", relativeTime(iso(now - 59 * 1000), now))
        Assert.assertEquals("5m ago", relativeTime(iso(now - 5 * min), now))
        Assert.assertEquals("59m ago", relativeTime(iso(now - 59 * min), now))
        Assert.assertEquals("2h ago", relativeTime(iso(now - 120 * min), now))
        Assert.assertEquals("23h ago", relativeTime(iso(now - 23 * 60 * min), now))
        Assert.assertEquals("3d ago", relativeTime(iso(now - 3 * 24 * 60 * min), now))
        Assert.assertEquals("6d ago", relativeTime(iso(now - 6 * 24 * 60 * min), now))
    }

    @Test
    fun relativeTimeOlderThanWeekFallsBackToDate() {
        val tenDaysAgo = now - 10L * 24 * 60 * min
        val out = relativeTime(iso(tenDaysAgo), now)
        // Locale-dependent formatting — assert it is a real date, not a bucket.
        Assert.assertFalse(out.endsWith("ago"))
        Assert.assertTrue(out.isNotBlank())
    }

    @Test
    fun relativeTimeInvalidInputIsEmpty() {
        Assert.assertEquals("", relativeTime("not-a-date", now))
        Assert.assertEquals("", relativeTime("", now))
    }

    private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()
}
