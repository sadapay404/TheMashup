package local.themashup.music.core.network.logic

import java.security.MessageDigest
import java.time.Instant
import local.themashup.music.core.domain.StreamCandidate

/**
 * Stream-candidate construction shared by the HTTP fallbacks — ports of
 * `piped_source.py` / `invidious_source.py` candidate mapping plus the
 * resolver's `expires_iso`.
 */
object StreamNormalize {

    private val EXPIRE = Regex("""[?&]expire=(\d+)""")

    /** ISO-8601 instant from `expire=` param, else null (invalid ts → null). */
    fun expiresIso(url: String?): String? {
        val m = EXPIRE.find(url ?: "") ?: return null
        return try {
            Instant.ofEpochSecond(m.groupValues[1].toLong()).toString()
        } catch (_: Exception) {
            null
        }
    }

    /** mp4 container → m4a, webm → webm, else `audio` (resolver rule). */
    fun extFromMimeOrType(mimeOrType: String): String = when {
        "mp4" in mimeOrType -> "m4a"
        "webm" in mimeOrType -> "webm"
        else -> "audio"
    }

    /** bits-per-second → integer kbps (resolver: `int(bitrate // 1000)`). */
    fun kbpsFromBits(bps: Long?): Int? =
        bps?.takeIf { it > 0 }?.div(1000)?.takeIf { it > 0 }?.toInt()

    /** `quality` || `"{kbps}k"` || ext (resolver fallback chain). */
    fun qualityLabel(explicit: String?, kbps: Int?, ext: String): String =
        explicit?.takeIf { it.isNotBlank() }
            ?: kbps?.let { "${it}k" }
            ?: ext

    /** digits-only contentLength/size → bytes; otherwise null. */
    fun sizeFrom(value: String?): Long? =
        value?.takeIf { s -> s.isNotEmpty() && s.all { it.isDigit() } }?.toLongOrNull()

    /** Upstream headers some CDNs require (resolver constant). */
    val YOUTUBE_HEADERS: Map<String, String> = mapOf(
        "User-Agent" to "Mozilla/5.0 (TheMashup)",
        "Referer" to "https://www.youtube.com/",
    )

    /** Builds one candidate from raw field values; null [url] → null. */
    fun candidate(
        source: String,
        url: String?,
        mime: String,
        quality: String?,
        bitrateBps: Long?,
        sizeValue: String?,
    ): StreamCandidate? {
        if (url.isNullOrBlank()) return null
        val kbps = kbpsFromBits(bitrateBps)
        val ext = extFromMimeOrType(mime)
        return StreamCandidate(
            id = "${source}:${sha1(url).take(16)}",
            source = source,
            url = url,
            mime = mime,
            ext = ext,
            quality = qualityLabel(quality, kbps, ext),
            bitrateKbps = kbps,
            hasVideo = false,
            sizeBytes = sizeFrom(sizeValue),
            expiresAt = expiresIso(url),
            httpHeaders = YOUTUBE_HEADERS,
        )
    }

    /**
     * NewPipe AudioStream bitrate: prefer digits in a "…128kbps…" quality
     * string; else averageBitrate which may be bits/s (>10_000) or already
     * kbps — heuristic keeps both conventions sane. UNKNOWN_BITRATE (-1) → null.
     */
    fun kbpsFromNewPipe(quality: String?, averageBitrate: Int?): Int? {
        Regex("""(\d+)\s*kbps""").find(quality ?: "")?.groupValues?.get(1)
            ?.toIntOrNull()?.let { return it }
        val v = averageBitrate ?: return null
        if (v <= 0) return null
        return if (v > 10_000) v / 1000 else v
    }

    /** Highest bitrate first — null kbps sorts last (resolver sorts desc). */
    fun sortCandidates(candidates: List<StreamCandidate>): List<StreamCandidate> =
        candidates.sortedByDescending { it.bitrateKbps ?: 0 }

    /** Piped: `mimeType` (default audio/webm) + its quality/bitrate/contentLength. */
    fun fromPipedAudio(
        url: String?,
        mimeType: String?,
        quality: String?,
        bitrateBps: Long?,
        contentLength: String?,
    ): StreamCandidate? = candidate(
        source = "piped",
        url = url,
        mime = mimeType ?: "audio/webm",
        quality = quality,
        bitrateBps = bitrateBps,
        sizeValue = contentLength,
    )

    /** Invidious: adaptiveFormat `type` serves as mime; `audioQuality` label. */
    fun fromInvidiousAudio(
        url: String?,
        type: String?,
        audioQuality: String?,
        bitrateBps: Long?,
        size: String?,
    ): StreamCandidate? = candidate(
        source = "invidious",
        url = url,
        mime = type ?: "audio/webm",
        quality = audioQuality,
        bitrateBps = bitrateBps,
        sizeValue = size,
    )

    /** mp4 mime → "mp4", webm → "webm", else "video" (video container ext). */
    fun videoExtFromMime(mime: String): String = when {
        "mp4" in mime -> "mp4"
        "webm" in mime -> "webm"
        else -> "video"
    }

    /**
     * Video stream candidate (N7 downloads). [height] may be null — the
     * quality label ("1080p60") is kept and parsed downstream.
     * [videoOnly] marks adaptive streams that need an audio merge.
     */
    fun videoCandidate(
        source: String,
        url: String?,
        mime: String,
        quality: String?,
        width: Int?,
        height: Int?,
        videoOnly: Boolean,
        sizeValue: String?,
    ): StreamCandidate? {
        if (url.isNullOrBlank()) return null
        val ext = videoExtFromMime(mime)
        return StreamCandidate(
            id = "${source}:${sha1(url).take(16)}",
            source = source,
            url = url,
            mime = mime,
            ext = ext,
            quality = quality?.takeIf { it.isNotBlank() }
                ?: height?.let { "${it}p" }
                ?: ext,
            width = width?.takeIf { it > 0 },
            height = height?.takeIf { it > 0 },
            hasVideo = true,
            videoOnly = videoOnly,
            sizeBytes = sizeFrom(sizeValue),
            expiresAt = expiresIso(url),
            httpHeaders = YOUTUBE_HEADERS,
        )
    }

    /** SHA-1 hex of [input], stable across processes (unlike String.hashCode()). */
    private fun sha1(input: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
        return digest.digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
