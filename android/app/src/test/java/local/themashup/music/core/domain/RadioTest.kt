package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class RadioTest {

    private fun track(id: String, title: String, artist: String) = Track(
        id = id,
        source = "ytmusic",
        externalId = id,
        title = title,
        artists = listOf(ArtistRef(artist)),
        artistNames = artist,
    )

    private val seed = track("seed", "Blinding Lights", "The Weeknd")
    private val pool: List<Track> = listOf(
        track("seed", "Blinding Lights", "The Weeknd"), // same id as seed → excluded
        track("t2", "Starboy", "The Weeknd"),
        track("t3", "Save Your Tears", "The Weeknd"),
        track("t4", "Levitating", "Dua Lipa"),
        track("t5", "Don't Start Now", "Dua Lipa"),
        track("t6", "As It Was", "Harry Styles"),
        track("t7", "Flowers", "Miley Cyrus"),
        track("t8", "Cruel Summer", "Taylor Swift"),
    )

    /** Deterministic cycling RNG, fresh per test (mirrors the TS fixtures). */
    private fun cyclicRng(): () -> Double {
        var i = 0
        return { (i++ % 7) / 7.0 }
    }

    @Test
    fun excludesSeedAndDedupesById() {
        val rng = cyclicRng()
        val q = buildRadioQueue(seed, pool + pool, RadioOptions(limit = 20, rng = rng))
        val ids = q.map { it.id }
        Assert.assertFalse("seed excluded", "seed" in ids)
        Assert.assertEquals("no duplicates allowed", ids.size, ids.toSet().size)
    }

    @Test
    fun respectsTheRequestedLimit() {
        val q = buildRadioQueue(seed, pool, RadioOptions(limit = 3, rng = cyclicRng()))
        Assert.assertEquals(3, q.size)
    }

    @Test
    fun neverRepeatsTheSameArtistBackToBackWhenPoolAllows() {
        // Zero jitter → pure MMR scores: the property must hold structurally,
        // not by RNG luck (the TS suite's shared counter made it order-bound).
        val q = buildRadioQueue(seed, pool, RadioOptions(limit = 8, rng = { 0.0 }))
        for (k in 1 until q.size) {
            Assert.assertNotEquals(
                "adjacent same-artist tracks at $k: ${q[k].title} after ${q[k - 1].title}",
                q[k - 1].artistNames,
                q[k].artistNames,
            )
        }
    }

    @Test
    fun handlesEmptyPoolAndNoSeed() {
        Assert.assertTrue(buildRadioQueue(seed, emptyList(), RadioOptions(rng = cyclicRng())).isEmpty())
        val q = buildRadioQueue(null, pool, RadioOptions(limit = 4, rng = cyclicRng()))
        Assert.assertEquals(4, q.size)
        Assert.assertEquals(4, q.map { it.id }.toSet().size)
    }
}
