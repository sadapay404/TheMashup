package local.themashup.music.core.domain

/**
 * Quality matrix — port of the gateway's `QUALITY_BY_CONTAINER`
 * (`apps/api/src/routes/downloads.ts`) + shared constants.
 */

val AUDIO_QUALITIES = listOf("128k", "320k", "best")
val VIDEO_QUALITIES = listOf("360p", "720p", "1080p", "4k")

/** Ordered fallback policy (web parity): extraction primary → Piped → Invidious. */
val RESOLVER_PRIORITY = listOf("ytdlp", "piped", "invidious")

val QUALITY_BY_CONTAINER: Map<String, List<String>> = mapOf(
    "mp3" to listOf("128k", "320k"),
    "flac" to listOf("best"),
    "opus" to listOf("best"),
    "mp4" to listOf("360p", "720p", "1080p", "4k"),
)

/** null = valid; otherwise the gateway-style validation message. */
fun validateDownloadQuality(container: String, quality: String): String? {
    val allowed = QUALITY_BY_CONTAINER[container]
        ?: return "container '$container' invalid (allowed: ${QUALITY_BY_CONTAINER.keys.joinToString(", ")})"
    if (quality !in allowed) {
        return "quality '$quality' invalid for $container (allowed: ${allowed.joinToString(", ")})"
    }
    return null
}
