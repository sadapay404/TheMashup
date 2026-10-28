package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class FormatTest {

    @Test
    fun formatDurationRendersMssAndHmmss() {
        Assert.assertEquals("0:00", formatDuration(0))
        Assert.assertEquals("1:05", formatDuration(65))
        Assert.assertEquals("1:01:01", formatDuration(3661))
        Assert.assertEquals("0:00", formatDuration(null))
    }

    @Test
    fun parseLrcHandlesTimestampsMetadataAndSorting() {
        val lrc = listOf(
            "[ar:Artist]",
            "[00:12.50]first line",
            "[00:03.1]early line",
            "[01:02:50]bad tag ignored? no — hh:mm:ss not matched",
            "[00:20.00][00:40.00]chorus",
        ).joinToString("\n")
        val lines = parseLrc(lrc)
        Assert.assertEquals("early line", lines[0].text)
        Assert.assertEquals(3.1, lines[0].time, 1e-9)
        Assert.assertEquals("first line", lines[1].text)
        Assert.assertEquals(12.5, lines[1].time, 1e-9)
        val chorus = lines.filter { it.text == "chorus" }
        Assert.assertEquals("multi-tag lines expand", 2, chorus.size)
        for (i in 1 until lines.size) {
            Assert.assertTrue(lines[i].time >= lines[i - 1].time)
        }
    }

    @Test
    fun formatBytesRendersHumanStrings() {
        Assert.assertEquals("—", formatBytes(null))
        Assert.assertEquals("—", formatBytes(-5))
        Assert.assertEquals("0 B", formatBytes(0))
        Assert.assertEquals("512 B", formatBytes(512))
        Assert.assertEquals("1.5 KB", formatBytes(1536))
        Assert.assertEquals("2.0 MB", formatBytes(2L * 1024 * 1024))
        // >=100 renders with no decimals (JS toFixed(0) parity)
        Assert.assertEquals("103 KB", formatBytes(105_000))
    }

    @Test
    fun formatSpeedAndEtaLines() {
        Assert.assertEquals("—", formatSpeed(null))
        Assert.assertEquals("—", formatSpeed(0))
        Assert.assertEquals("1.5 KB/s", formatSpeed(1536))
        Assert.assertEquals("42s left", formatTimeLeft(42.0))
        Assert.assertEquals("3m 12s left", formatTimeLeft(192.0))
        Assert.assertEquals("1h 5m left", formatTimeLeft(3900.0))
        Assert.assertEquals("", formatTimeLeft(null))
        Assert.assertEquals("", formatTimeLeft(-1.0))
    }
}
