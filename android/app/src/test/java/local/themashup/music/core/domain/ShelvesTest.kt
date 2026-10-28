package local.themashup.music.core.domain

import java.time.Instant
import org.junit.Assert
import org.junit.Test

/** Home-shelf composition — port of `apps/api/src/routes/radio.ts` behavior. */
class ShelvesTest {

    private val now: Long = Instant.parse("2026-10-27T12:00:00Z").toEpochMilli()
    private val day = 86_400_000L

    private fun t(id: String, artist: String = "Artist", pop: Int = 50) = Track(
        id = id,
        source = "ytmusic",
        externalId = id,
        title = "Song $id",
        artists = listOf(ArtistRef(artist)),
        artistNames = artist,
        popularity = pop,
    )

    private fun heard(track: Track, daysAgo: Double): HeardEntry =
        HeardEntry(track, Instant.ofEpochMilli(now - (daysAgo * day).toLong()).toString())

    private fun charts(n: Int): List<Track> = (1..n).map { t("c$it", "Chart$it") }

    @Test
    fun authedOrderMatchesWeb() {
        Assert.assertEquals(
            listOf("listen_again", "quick", "discover", "trending"),
            Shelves.AUTHED_ORDER,
        )
        Assert.assertEquals(listOf("quick", "discover", "trending"), Shelves.ANON_ORDER)
    }

    @Test
    fun quickTakesTwentyFourAndIsNotPersonalized() {
        val shelf = Shelves.forKind("quick", emptyList(), emptyList(), charts(40), now)!!
        Assert.assertEquals("Quick picks", shelf.title)
        Assert.assertEquals(24, shelf.tracks.size)
        Assert.assertFalse(shelf.personalized)
        Assert.assertEquals("c1", shelf.tracks[0].id)
    }

    @Test
    fun trendingKeepsWholeChartAndTitle() {
        val shelf = Shelves.forKind("trending", emptyList(), emptyList(), charts(10), now)!!
        Assert.assertEquals("Trending now", shelf.title)
        Assert.assertEquals(10, shelf.tracks.size)
        Assert.assertFalse(shelf.personalized)
    }

    @Test
    fun listenAgainIsPersonalizedFromLibrary() {
        val fresh = t("fresh", "Alpha")
        val history = listOf(heard(fresh, 1.0), heard(fresh, 2.0))
        val shelf = Shelves.forKind("listen_again", history, listOf(t("fav")), emptyList(), now)!!
        Assert.assertEquals("Listen again", shelf.title)
        Assert.assertTrue(shelf.personalized)
        Assert.assertTrue(shelf.tracks.isNotEmpty())
    }

    @Test
    fun listenAgainWithNoHistoryIsFilteredOut() {
        Assert.assertNull(Shelves.forKind("listen_again", emptyList(), emptyList(), charts(5), now))
    }

    @Test
    fun discoverPersonalizedTitleWhenLibrarySignalExists() {
        val history = listOf(heard(t("fresh"), 1.0))
        val shelf = Shelves.forKind("discover", history, emptyList(), charts(30), now)!!
        Assert.assertEquals("Discover weekly", shelf.title)
        Assert.assertTrue(shelf.personalized)
        Assert.assertTrue(shelf.tracks.isNotEmpty())
    }

    @Test
    fun discoverFallsBackToRadioWithoutLibrarySignal() {
        val shelf = Shelves.forKind("discover", emptyList(), emptyList(), charts(30), now)!!
        Assert.assertEquals("Discover", shelf.title)
        Assert.assertFalse(shelf.personalized)
        Assert.assertTrue(shelf.tracks.isNotEmpty())
        // Radio queue is chart-derived.
        Assert.assertTrue(shelf.tracks.all { it.id.startsWith("c") })
    }

    @Test
    fun emptyChartsYieldNoChartShelves() {
        Assert.assertNull(Shelves.forKind("quick", emptyList(), emptyList(), emptyList(), now))
        Assert.assertNull(Shelves.forKind("trending", emptyList(), emptyList(), emptyList(), now))
        Assert.assertNull(Shelves.forKind("discover", emptyList(), emptyList(), emptyList(), now))
    }

    @Test
    fun buildDropsEmptiesAndKeepsOrder() {
        val history = listOf(heard(t("fresh"), 1.0))
        val shelves = Shelves.build(
            kinds = Shelves.AUTHED_ORDER,
            history = history,
            likes = emptyList(),
            charts = charts(30),
            nowMs = now,
        )
        // listen_again, quick, discover, trending — all present with signal.
        Assert.assertEquals(listOf("listen_again", "quick", "discover", "trending"), shelves.map { it.kind })
    }

    @Test
    fun buildWithoutHistorySkipsListenAgainOnly() {
        val shelves = Shelves.build(
            kinds = Shelves.AUTHED_ORDER,
            history = emptyList(),
            likes = emptyList(),
            charts = charts(8),
            nowMs = now,
        )
        Assert.assertEquals(listOf("quick", "discover", "trending"), shelves.map { it.kind })
    }
}
