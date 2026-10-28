package local.themashup.music.ui.logic

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import local.themashup.music.core.domain.LyricLine

/**
 * Pure lyric-sync + history-time helpers.
 * - [activeLineIndex]: web `LyricsPanel` activeIdx — last line whose time is
 *   within `position + 0.05`, else -1 (binary-search-free linear scan parity).
 * - [relativeTime]: web `LibraryPage.relativeTime` ("just now", "5m ago", …).
 */
fun activeLineIndex(lines: List<LyricLine>, positionSec: Double, tolerance: Double = 0.05): Int {
    if (lines.isEmpty()) return -1
    var lo = -1
    for (i in lines.indices) {
        if (lines[i].time <= positionSec + tolerance) lo = i
        else break
    }
    return lo
}

fun relativeTime(iso: String, nowMs: Long): String {
    val at = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return ""
    val diffMin = (nowMs - at) / 60_000
    if (diffMin < 1) return "just now"
    if (diffMin < 60) return "${diffMin}m ago"
    val hours = diffMin / 60
    if (hours < 24) return "${hours}h ago"
    val days = hours / 24
    if (days < 7) return "${days}d ago"
    val zoned = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault())
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
        .withLocale(Locale.getDefault())
        .format(zoned)
}
