package local.themashup.music.core.domain

import java.util.Locale
import kotlin.math.floor
import kotlin.math.round

/**
 * Formatting + LRC parsing — port of `packages/shared/src/utils/format.ts`.
 */

/** Duration in seconds → "m:ss" (or "h:mm:ss"). */
fun formatDuration(totalSec: Int?): String {
    if (totalSec == null || totalSec < 0) return "0:00"
    val s = totalSec % 60
    val m = (totalSec / 60) % 60
    val h = totalSec / 3600
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.US, "%d:%02d", m, s)
}

private val BYTE_UNITS = arrayOf("B", "KB", "MB", "GB", "TB")

/** Bytes → human string (downloads UI). */
fun formatBytes(bytes: Long?): String {
    if (bytes == null || bytes < 0) return "—"
    var v = bytes.toDouble()
    var i = 0
    while (v >= 1024 && i < BYTE_UNITS.lastIndex) {
        v /= 1024
        i++
    }
    val value = if (v >= 100 || i == 0) String.format(Locale.US, "%.0f", v)
    else String.format(Locale.US, "%.1f", v)
    return "$value ${BYTE_UNITS[i]}"
}

/** Bits/s-style throughput → "1.2 MB/s". */
fun formatSpeed(bytesPerSec: Long?): String {
    if (bytesPerSec == null || bytesPerSec <= 0) return "—"
    return "${formatBytes(bytesPerSec)}/s"
}

/** Parse LRC text into timed lines (skips metadata tags). */
fun parseLrc(lrc: String): List<LyricLine> {
    val lines = mutableListOf<LyricLine>()
    val tagRe = Regex("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?]")
    for (raw in lrc.split(Regex("\\r?\\n"))) {
        val line = raw.trim()
        if (line.isEmpty()) continue
        val tags = tagRe.findAll(line).toList()
        if (tags.isEmpty()) continue // [ar:], [ti:] metadata etc.
        val text = line.replace(Regex("\\[[^]]*]"), "").trim()
        for (m in tags) {
            val min = m.groupValues[1].toInt()
            val sec = m.groupValues[2].toInt()
            val fracRaw = m.groupValues[3].ifEmpty { "0" }
            val frac = fracRaw.toInt() / Math.pow(10.0, fracRaw.length.toDouble())
            lines.add(LyricLine(min * 60 + sec + frac, text))
        }
    }
    return lines.sortedBy { it.time }
}

private val HEIGHT_IN_LABEL = Regex("""(\d{3,4})p?""")

/**
 * Quality label → pixel height: "1080p60" / "720p" / "hd720" → 1080 / 720 /
 * 720; blank or unparseable → null. (Downloads manifest + video selection.)
 */
fun heightFromLabel(label: String?): Int? {
    if (label.isNullOrBlank()) return null
    HEIGHT_IN_LABEL.find(label)?.groupValues?.get(1)?.toIntOrNull()?.let { return it }
    return label.filter { it.isDigit() }.takeIf { it.length in 3..4 }?.toIntOrNull()
}

/** ETA line for download rows: "42s left", "3m 12s left", "1h 5m left". */
fun formatTimeLeft(seconds: Double?): String {
    if (seconds == null || seconds.isNaN() || seconds < 0) return ""
    val total = round(seconds).toInt()
    if (total < 60) return "${total}s left"
    val m = total / 60
    val sec = total % 60
    if (m < 60) return "${m}m ${sec}s left"
    val h = m / 60
    return "${h}h ${m % 60}m left"
}

/** Unused-import guard for floor (kept out of release lint noise). */
@Suppress("unused")
private val floorFn: (Double) -> Double = { floor(it) }
