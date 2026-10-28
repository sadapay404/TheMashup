package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class HybridTest {

    private fun track(id: String, title: String, artist: String, pop: Int = 60) = Track(
        id = id,
        source = "ytmusic",
        externalId = id,
        title = title,
        artists = listOf(ArtistRef(artist)),
        artistNames = artist,
        popularity = pop,
    )

    private fun match(id: Long, trackName: String, artistName: String, similarity: Double) =
        LyricMatchRow(
            trackName = trackName,
            artistName = artistName,
            similarity = similarity,
            synced = true,
            plain = true,
            lrclibId = id,
        )

    @Test
    fun mergesAndInterleavesTrackAndLyricRowsByScore() {
        val rows = mergeHybrid(
            listOf(track("a", "Blinding Lights", "The Weeknd")),
            listOf(match(1, "Mystery Tune", "Nobody", 0.9)),
            "city hums in ultraviolet",
        )
        Assert.assertEquals(2, rows.size)
        Assert.assertTrue(rows[0].rankScore >= rows[1].rankScore)
        Assert.assertTrue(rows.any { it is HybridRow.TrackRow })
        Assert.assertTrue(rows.any { it is HybridRow.LyricRow })
    }

    @Test
    fun dropsLyricRowsDuplicatingAnExistingTrack() {
        val rows = mergeHybrid(
            listOf(track("a", "Blinding Lights", "The Weeknd")),
            listOf(match(1, "blinding lights", "the weeknd", 0.95)),
            "blinding lights",
        )
        Assert.assertTrue(rows.all { it is HybridRow.TrackRow })
        Assert.assertEquals(1, rows.size)
    }

    @Test
    fun lowSimilarityLyricMatchesAreFilteredOut() {
        val rows = mergeHybrid(emptyList(), listOf(match(1, "Random Song", "Someone", 0.18)), "totally different")
        Assert.assertEquals(0, rows.size)
    }

    @Test
    fun exactMetadataQueryRanksTheTrackFirst() {
        val rows = mergeHybrid(
            listOf(track("a", "Levitating", "Dua Lipa"), track("b", "Levitating Remix", "Other", 99)),
            emptyList(),
            "levitating",
        )
        Assert.assertTrue(rows[0] is HybridRow.TrackRow)
        Assert.assertEquals("a", (rows[0] as HybridRow.TrackRow).track.track.id)
    }

    @Test
    fun keysAreStableAndUnique() {
        val rows = mergeHybrid(
            listOf(track("a", "Song A", "X"), track("b", "Song B", "Y")),
            listOf(match(7, "Other Song", "Z", 0.7)),
            "q",
        )
        val keys = rows.map { it.key }
        Assert.assertEquals(keys.size, keys.toSet().size)
        Assert.assertEquals(hybridIndexBounds(rows), rows.size - 1)
    }
}
