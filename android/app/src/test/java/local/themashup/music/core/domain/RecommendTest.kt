package local.themashup.music.core.domain

import java.time.Instant
import org.junit.Assert
import org.junit.Test

class RecommendTest {

    private val now: Long = Instant.parse("2026-10-27T12:00:00Z").toEpochMilli()
    private val day = 86_400_000L

    private fun t(id: String, artist: String, pop: Int = 50) = Track(
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

    @Test
    fun listenAgainPrefersRecentOverOldDedupesLikedBoost() {
        val fresh = t("fresh", "Alpha")
        val old = t("old", "Beta")
        val liked = t("liked", "Gamma")
        val out = listenAgain(
            listOf(heard(old, 30.0), heard(fresh, 1.0), heard(liked, 10.0), heard(fresh, 0.2)),
            setOf("liked"),
            10,
            now,
        )
        Assert.assertEquals("recent favorite (liked boost) leads", "liked", out[0].id)
        val ids = out.map { it.id }
        Assert.assertTrue(
            "recent plain play outranks a stale one",
            ids.indexOf("fresh") < ids.indexOf("old"),
        )
        Assert.assertEquals("no duplicates", ids.size, ids.toSet().size)
        Assert.assertTrue("old plays still appear", "old" in ids)
    }

    @Test
    fun listenAgainCapsAtLimit() {
        val many = (0 until 40).map { heard(t("t$it", "A${it % 5}"), it.toDouble()) }
        Assert.assertEquals(12, listenAgain(many, emptySet(), 12, now).size)
    }

    @Test
    fun listenAgainWithLikesInjectsUnplayedFavorites() {
        val played = heard(t("p1", "Alpha"), 1.0)
        val fav = t("fav", "Zeta")
        val out = listenAgainWithLikes(listOf(played), listOf(t("p1", "Alpha"), fav), 10, now)
        Assert.assertTrue("unplayed like included", out.any { it.id == "fav" })
        Assert.assertEquals("still deduped", out.size, out.map { it.id }.toSet().size)
    }

    @Test
    fun tasteVectorWeightsLikedArtistsHigher() {
        val v = tasteVector(
            listOf(heard(t("a1", "Alpha"), 1.0), heard(t("b1", "Beta"), 1.0), heard(t("a2", "Alpha"), 2.0)),
            setOf("a1"),
            now,
        )
        Assert.assertTrue((v["alpha"] ?: 0.0) > (v["beta"] ?: 0.0))
    }

    @Test
    fun discoverMixExcludesRecentlyHeardWhenPoolAllows() {
        val heardTrack = t("h1", "Alpha")
        val out = discoverMix(
            history = listOf(heard(heardTrack, 1.0)),
            likedIds = emptySet(),
            candidates = listOf(heardTrack, t("f1", "Beta"), t("f2", "Gamma")),
            limit = 2,
            nowMs = now,
        )
        Assert.assertTrue(out.none { it.id == "h1" })
        Assert.assertEquals(2, out.size)
    }

    @Test
    fun discoverMixRelaxesExclusionForThinPools() {
        val only = t("only", "Solo")
        val out = discoverMix(
            history = listOf(heard(only, 1.0)),
            likedIds = emptySet(),
            candidates = listOf(only),
            limit = 5,
            nowMs = now,
        )
        Assert.assertEquals("thin pool still yields the track", 1, out.size)
    }

    @Test
    fun discoverMixRespectsTasteAffinityWhenDataExists() {
        val favArtist = t("fa", "FavArtist", 30)
        val other = t("ot", "Other", 95)
        val out = discoverMix(
            history = listOf(heard(t("x", "FavArtist"), 1.0), heard(t("y", "FavArtist"), 2.0)),
            likedIds = setOf("x"),
            candidates = listOf(other, favArtist),
            limit = 2,
            nowMs = now,
        )
        Assert.assertEquals("taste beats raw popularity", "fa", out[0].id)
    }

    @Test
    fun diversifyNeverLeavesAdjacentSameArtistWhenAvoidable() {
        val list = listOf(t("1", "A"), t("2", "A"), t("3", "B"), t("4", "A"), t("5", "C"))
        val out = diversify(list)
        for (i in 1 until out.size) {
            if (out[i].artistNames == out[i - 1].artistNames) {
                // allowed only if every remaining candidate shares the artist
                val remaining = out.subList(i, out.size)
                Assert.assertTrue(remaining.all { it.artistNames == out[i].artistNames })
            }
        }
        Assert.assertEquals("diversify keeps all items", list.size, out.size)
    }
}
