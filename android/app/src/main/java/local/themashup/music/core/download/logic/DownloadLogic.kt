package local.themashup.music.core.download.logic

import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.domain.heightFromLabel

/**
 * Pure download decisions — mirrors the resolver's transcode contract
 * (`services/resolver/app/downloads.py`) and the gateway quality matrix
 * (`apps/api/src/routes/downloads.ts`). Everything here is sandbox-tested;
 * Process/MediaStore/OkHttp live in the Android layer around it.
 */

/** Quality → target height (resolver `_VIDEO_HEIGHT`: "4k" = 2160). */
fun heightTarget(quality: String): Int = when (quality) {
    "360p" -> 360
    "720p" -> 720
    "1080p" -> 1080
    "4k" -> 2160
    else -> quality.filter { it.isDigit() }.toIntOrNull() ?: 1080
}

/** Effective pixel height of a candidate (explicit field, else video label). */
fun candidateHeight(candidate: StreamCandidate): Int? =
    candidate.height?.takeIf { it > 0 }
        ?: if (candidate.hasVideo) heightFromLabel(candidate.quality) else null

/** Highest-bitrate audio candidate — null kbps sorts last (resolver desc order). */
fun pickAudio(candidates: List<StreamCandidate>): StreamCandidate? =
    candidates.filter { !it.hasVideo }
        .maxByOrNull { it.bitrateKbps ?: -1 }

/** Muxed single file vs adaptive split (videoOnly needs an audio pair). */
data class VideoPlan(
    val video: StreamCandidate,
    val audio: StreamCandidate?,
) {
    val isSplit: Boolean get() = audio != null
}

/**
 * Strict height cap ≤ target (web `bv*[height<=h]`; QualityPicker disables
 * chips above the manifest max). Muxed first, then videoOnly + best audio.
 * null → no stream fits — caller surfaces "not available".
 */
fun pickVideo(candidates: List<StreamCandidate>, quality: String): VideoPlan? {
    val target = heightTarget(quality)
    val videoStreams = candidates.filter { it.hasVideo }
    val fits = videoStreams.filter { c -> candidateHeight(c)?.let { it in 1..target } == true }
    fits.filter { !it.videoOnly }
        .maxByOrNull { candidateHeight(it) ?: 0 }
        ?.let { return VideoPlan(video = it, audio = null) }
    val videoOnly = fits.filter { it.videoOnly }
        .maxByOrNull { candidateHeight(it) ?: 0 }
        ?: return null
    val audio = pickAudio(candidates) ?: return null
    return VideoPlan(video = videoOnly, audio = audio)
}

/** Distinct playable heights (ascending) — QualityPicker manifest (maxHeight). */
fun availableVideoHeights(candidates: List<StreamCandidate>): List<Int> =
    candidates.filter { it.hasVideo }
        .mapNotNull { candidateHeight(it) }
        .distinct()
        .sorted()

/** Container → MIME (MediaStore insert). */
fun mimeTypeFor(container: String): String = when (container) {
    "mp3" -> "audio/mpeg"
    "flac" -> "audio/flac"
    "opus" -> "audio/ogg"
    "mp4" -> "video/mp4"
    else -> "application/octet-stream"
}

/** Container → file extension (matrix containers all keep their name). */
fun extensionFor(container: String): String = when (container) {
    "mp3", "flac", "opus", "mp4" -> container
    else -> "bin"
}

/**
 * ffmpeg argv candidates — FIRST is the cheap attempt, LATER entries are
 * fallbacks when it exits non-zero. Codec lines are copied from the resolver
 * (`-codec:a libmp3lame -b:a <q>` / `flac` / `libopus 160k`).
 * [inputs] = [source] or [video, audio] for a split mp4 plan.
 */
fun buildTranscodeCommands(
    ffmpeg: String,
    inputs: List<String>,
    outPath: String,
    container: String,
    quality: String,
): List<List<String>> {
    val head = mutableListOf(ffmpeg, "-y", "-hide_banner", "-loglevel", "error")
    inputs.forEachIndexed { i, src -> head += listOf("-i", src) }
    return when (container) {
        "mp3" -> {
            val bitrate = if (quality == "320k") "320k" else "128k"
            listOf(head + listOf("-vn", "-codec:a", "libmp3lame", "-b:a", bitrate, outPath))
        }
        "flac" -> listOf(head + listOf("-vn", "-codec:a", "flac", outPath))
        "opus" -> listOf(head + listOf("-vn", "-codec:a", "libopus", "-b:a", "160k", outPath))
        "mp4" -> if (inputs.size >= 2) {
            val map = listOf("-map", "0:v:0", "-map", "1:a:0")
            listOf(
                head + map + listOf("-c", "copy", outPath),
                head + map + listOf(
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
                ),
            )
        } else {
            listOf(
                head + listOf("-c", "copy", outPath),
                head + listOf(
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
                ),
            )
        }
        else -> listOf(head + listOf("-vn", "-c", "copy", outPath))
    }
}

/** Illegal-for-filesystem chars → "_", collapse whitespace, cap 120 chars. */
fun sanitizeFilename(title: String): String {
    val cleaned = title
        .replace(Regex("""[\\/:*?"<>|]"""), "_")
        .replace(Regex("""[\p{Cntrl}]"""), " ")
        .replace(Regex("""\s+"""), " ")
        .trim()
        .trim('.', ' ')
        .take(120)
        .trim()
    return cleaned.ifEmpty { "download" }
}

/** Display name written into MediaStore — `${title}.${ext}`. */
fun outputFilename(title: String, container: String): String =
    "${sanitizeFilename(title)}.${extensionFor(container)}"

/**
 * "song.mp3" + taken{"song.mp3"} → "song (2).mp3" (… up to 99) — mirrors
 * how downloads folders uniquify copies; keeps extension last.
 */
fun dedupeFilename(name: String, taken: Set<String>): String {
    if (name !in taken) return name
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    for (i in 2..999) {
        val candidate = "$stem ($i)$ext"
        if (candidate !in taken) return candidate
    }
    return name // taken exhaustively — caller falls back to MediaStore defaults
}

/**
 * Download-phase percent — 0..98 (99 = processing, 100 = done; resolver
 * holds yt-dlp at 99 while postprocessing). Unknown total → caller passes -1.
 */
fun downloadPercent(got: Long, total: Long): Int =
    if (total <= 0) -1 else ((got.toDouble() / total.toDouble()) * 98.0).toInt().coerceIn(0, 98)

/** Remaining seconds from bytes left / speed (null speed or total → null). */
fun etaSeconds(got: Long, total: Long, bytesPerSec: Long): Long? {
    if (total <= 0 || bytesPerSec <= 0 || got >= total) return null
    return ((total - got) / bytesPerSec).coerceAtLeast(1)
}
