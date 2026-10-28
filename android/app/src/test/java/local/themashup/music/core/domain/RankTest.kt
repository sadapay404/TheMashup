package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class RankTest {

    private fun track(id: String, title: String, artist: String, popularity: Int = 50) = Track(
        id = id,
        source = "ytmusic",
        externalId = id,
        title = title,
        artists = listOf(ArtistRef(artist)),
        artistNames = artist,
        popularity = popularity,
    )

    @Test
    fun exactTitleMatchesOutrankFuzzyOnes() {
        val tracks = listOf(
            track("a", "Shape of You", "Ed Sheeran"),
            track("b", "Shape of You (Remix)", "Various"),
            track("c", "Perfect", "Ed Sheeran", 99),
        )
        val ranked = rankSearchResults(tracks, "shape of you")
        Assert.assertEquals("a", ranked[0].track.id)
    }

    @Test
    fun lyricDerivedSimilarityBoostsRanking() {
        val tracks = listOf(
            track("a", "Mystery Song", "Nobody", 10),
            track("b", "Levitating", "Dua Lipa"),
        )
        val lyricIds = mapOf("b" to LyricHit(similarity = 0.95, snippet = "text"))
        val ranked = rankSearchResults(tracks, "i got levi tating in the dark for you", lyricIds)
        Assert.assertEquals("b", ranked[0].track.id)
        Assert.assertEquals("text", ranked[0].matchedLyric)
    }

    @Test
    fun scoresAreBoundedAndSortedDescending() {
        val tracks = listOf(
            track("a", "Song A", "X"),
            track("b", "Totally Different", "Y"),
        )
        val ranked = rankSearchResults(tracks, "song a")
        for (r in ranked) {
            Assert.assertTrue(r.rankScore in 0.0..1.0)
        }
        Assert.assertTrue(ranked[0].rankScore >= ranked[1].rankScore)
    }
}
