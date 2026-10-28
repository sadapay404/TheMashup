package local.themashup.music.core.domain

/**
 * Home-shelf composition — port of `apps/api/src/routes/radio.ts`
 * recommendationsRouter: listen_again (personal), quick/discover/trending
 * (chart-based), with the discover taste-vector / radio fallback.
 * Pure: charts + history + likes in, RecShelf list out.
 */
object Shelves {

    const val LISTEN_AGAIN_LIMIT = 24
    const val CHART_LIMIT = 24
    const val DISCOVER_RADIO_LAMBDA = 0.5

    /** Web AUTHED_KINDS order (local profile counts as identified). */
    val AUTHED_ORDER = listOf("listen_again", "quick", "discover", "trending")
    val ANON_ORDER = listOf("quick", "discover", "trending")

    fun titles(kind: String, personalized: Boolean): String = when (kind) {
        "listen_again" -> "Listen again"
        "quick" -> "Quick picks"
        "discover" -> if (personalized) "Discover weekly" else "Discover"
        "trending" -> "Trending now"
        else -> kind
    }

    /** One shelf; null when it has no tracks (web filters empties out). */
    fun forKind(
        kind: String,
        history: List<HeardEntry>,
        likes: List<Track>,
        charts: List<Track>,
        nowMs: Long,
    ): RecShelf? {
        val likedIds = likes.mapTo(mutableSetOf()) { it.id }
        var personalized = false
        val tracks: List<Track> = when (kind) {
            "listen_again" -> listenAgainWithLikes(history, likes, LISTEN_AGAIN_LIMIT, nowMs)
                .also { personalized = true }
            "quick" -> charts.take(CHART_LIMIT)
            "discover" -> {
                if (history.isNotEmpty() || likedIds.isNotEmpty()) {
                    val mix = discoverMix(history, likedIds, charts, CHART_LIMIT, nowMs)
                    if (mix.isNotEmpty()) {
                        personalized = true
                        mix
                    } else if (charts.isNotEmpty()) {
                        buildRadioQueue(charts[0], charts, RadioOptions(limit = CHART_LIMIT, lambda = DISCOVER_RADIO_LAMBDA))
                    } else {
                        emptyList()
                    }
                } else if (charts.isNotEmpty()) {
                    buildRadioQueue(charts[0], charts, RadioOptions(limit = CHART_LIMIT, lambda = DISCOVER_RADIO_LAMBDA))
                } else {
                    emptyList()
                }
            }
            "trending" -> charts
            else -> emptyList()
        }
        if (tracks.isEmpty()) return null
        return RecShelf(kind = kind, title = titles(kind, personalized), tracks = tracks, personalized = personalized)
    }

    /** Full shelf list for the given kind order; empties dropped (web parity). */
    fun build(
        kinds: List<String>,
        history: List<HeardEntry>,
        likes: List<Track>,
        charts: List<Track>,
        nowMs: Long,
    ): List<RecShelf> =
        kinds.mapNotNull { forKind(it, history, likes, charts, nowMs) }
}
