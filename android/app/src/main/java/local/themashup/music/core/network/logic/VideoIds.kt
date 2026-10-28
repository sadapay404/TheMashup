package local.themashup.music.core.network.logic

/**
 * YouTube URL/id helpers shared by all sources (NewPipe, Piped, Invidious) —
 * port of the resolver's `_video_id` behaviour plus common URL shapes.
 */
object VideoIds {
    private val WATCH_V = Regex("""[?&]v=([A-Za-z0-9_-]{11})""")
    private val RAW_ID = Regex("""^[A-Za-z0-9_-]{11}$""")

    /** Extracts an 11-char video id from any common YouTube URL, or null. */
    fun fromUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val u = url.trim()

        // Raw id passthrough.
        if (RAW_ID.matches(u)) return u

        // /watch?v=ID (with or without params) — resolver's primary shape.
        if (u.contains("/watch?v=")) {
            val tail = u.substringAfter("/watch?v=")
            return extractIdCandidate(tail)
        }
        // "watch?v=ID" (relative, Piped style).
        if (u.startsWith("watch?v=")) {
            return extractIdCandidate(u.substringAfter("="))
        }
        // youtu.be/ID, /shorts/ID, /embed/ID, /live/ID.
        for (marker in listOf("youtu.be/", "/shorts/", "/embed/", "/live/")) {
            if (u.contains(marker)) {
                return extractIdCandidate(u.substringAfter(marker))
            }
        }
        // Bare "v=ID" anywhere.
        WATCH_V.find(u)?.let { return it.groupValues[1] }
        return null
    }

    fun watchUrl(videoId: String): String = "https://www.youtube.com/watch?v=$videoId"

    private fun extractIdCandidate(tail: String): String? {
        val raw = tail.substringBefore('&').substringBefore('?').substringBefore('#')
        return raw.takeIf { RAW_ID.matches(it) }
    }
}
