package local.themashup.music.core.network.logic

import local.themashup.music.core.domain.ArtistRef
import local.themashup.music.core.domain.Track

/**
 * Ports of `services/resolver/app/normalize.py` (track / parse_duration /
 * best_thumb) — pure Kotlin, shared by NewPipe/Piped/Invidious mapping.
 */
object TrackNormalize {

    /** Accepts 214, "214", "3:34", "1:02:03"; 0/garbage → null. */
    fun parseDuration(value: Any?): Int? {
        when (value) {
            null -> return null
            is Number -> return value.toInt().takeIf { it > 0 }
            else -> {}
        }
        val s = value.toString().trim()
        if (s.isEmpty()) return null
        if (s.all { it.isDigit() }) return s.toIntOrNull()?.takeIf { it > 0 }
        val parts = s.split(":")
        if (parts.size in 2..3 && parts.all { p -> p.isNotBlank() && p.all { it.isDigit() } }) {
            var total = 0
            for (p in parts) {
                val n = p.trim().toIntOrNull() ?: return null
                total = total * 60 + n
            }
            return total.takeIf { it > 0 }
        }
        return null
    }

    /** Largest area thumbnail wins (`pick = "max"`); no width/height → first url. */
    fun bestThumb(thumbnails: List<Map<String, Any?>>?, pick: String = "max"): String? {
        if (thumbnails.isNullOrEmpty()) return null
        val urls = thumbnails.mapNotNull { it["url"] as? String }
        if (urls.isEmpty()) return null
        if (pick == "min") return urls.first()
        fun area(u: String): Int {
            val t = thumbnails.firstOrNull { it["url"] == u } ?: return 0
            val w = (t["width"] as? Number)?.toInt() ?: 0
            val h = (t["height"] as? Number)?.toInt() ?: 0
            return w * h
        }
        return urls.maxByOrNull { area(it) }
    }

    /**
     * Builds the shared Track shape (resolver `track()`), including the
     * "Unknown title" / "Unknown artist" fallbacks and artwork=artwork_best.
     */
    fun track(
        videoId: String,
        title: String,
        artists: List<Map<String, Any?>>,
        source: String,
        duration: Any? = null,
        artwork: String? = null,
        album: String? = null,
        popularity: Int? = null,
        category: String = "song",
        explicit: Boolean = false,
    ): Track {
        val cleanArtists = artists.mapNotNull { a ->
            val name = a["name"] as? String
            if (name.isNullOrBlank()) null
            else ArtistRef(
                name = name,
                channelId = a["channel_id"] as? String,
                url = a["url"] as? String,
            )
        }
        return Track(
            id = videoId,
            source = source,
            externalId = videoId,
            title = title.ifEmpty { "Unknown title" },
            artists = cleanArtists,
            artistNames = cleanArtists.joinToString(", ") { it.name }.ifEmpty { "Unknown artist" },
            album = album,
            durationSec = parseDuration(duration),
            artwork = artwork,
            artworkBest = artwork,
            popularity = popularity,
            explicit = explicit,
            category = category,
        )
    }
}
