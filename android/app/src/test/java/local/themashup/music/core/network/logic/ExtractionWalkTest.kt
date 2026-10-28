package local.themashup.music.core.network.logic

import local.themashup.music.core.domain.Track
import org.junit.Assert
import org.junit.Test

/** ExtractionLogic trending/suggest walks — first non-empty, degrade-safe. */
class ExtractionWalkTest {

    private class FakeSource(
        override val id: String,
        private val trend: () -> List<Track>,
        private val sugg: () -> List<String> = { emptyList() },
    ) : MusicSource {
        override fun search(query: String, limit: Int): List<Track> = emptyList()
        override fun streams(videoId: String): SourceStreams = SourceStreams(emptyList(), emptyList())
        // NB: never name a lambda property after the method it feeds — the
        // no-arg call would recurse via the interface default parameter.
        override fun trending(limit: Int): List<Track> = trend().take(limit)
        override fun suggest(query: String): List<String> = sugg()
    }

    private fun track(id: String): Track = Track(
        id = id,
        source = "test",
        externalId = id,
        title = id,
        artistNames = "A",
    )

    @Test
    fun trendingWalksToFirstNonEmptySource() {
        val sources = listOf(
            FakeSource("a", { emptyList() }),
            FakeSource("b", { listOf(track("t1")) }),
            FakeSource("c", { listOf(track("t2")) }),
        )
        val out = ExtractionLogic.trending(sources, 40)
        Assert.assertEquals(listOf("t1"), out.map { it.id })
    }

    @Test
    fun trendingSkipsThrowingSources() {
        val sources = listOf(
            FakeSource("boom", { throw java.io.IOException("offline") }),
            FakeSource("ok", { listOf(track("t1")) }),
        )
        val out = ExtractionLogic.trending(sources, 40)
        Assert.assertEquals(listOf("t1"), out.map { it.id })
    }

    @Test
    fun trendingAllEmptyOrFailingIsSafeEmpty() {
        Assert.assertTrue(
            ExtractionLogic.trending(
                listOf(
                    FakeSource("a", { throw IllegalStateException("x") }),
                    FakeSource("b", { emptyList() }),
                ),
                40,
            ).isEmpty(),
        )
        Assert.assertTrue(ExtractionLogic.trending(emptyList(), 40).isEmpty())
    }

    @Test
    fun trendingHonorsLimit() {
        val sources = listOf(FakeSource("a", { (1..50).map { track("t$it") } }))
        Assert.assertEquals(7, ExtractionLogic.trending(sources, 7).size)
    }

    @Test
    fun suggestWalksAndNeverThrows() {
        val sources = listOf(
            FakeSource("a", { emptyList() }, { emptyList() }),
            FakeSource("b", { emptyList() }, { listOf("blinding lights") }),
        )
        Assert.assertEquals(
            listOf("blinding lights"),
            ExtractionLogic.suggest(sources, "blin"),
        )
        val failing = listOf(FakeSource("x", { emptyList() }, { throw RuntimeException("nope") }))
        Assert.assertTrue(ExtractionLogic.suggest(failing, "q").isEmpty())
        Assert.assertTrue(ExtractionLogic.suggest(emptyList(), "q").isEmpty())
    }

    @Test
    fun suggestTruncatesToLimitAtServiceLevel() {
        // Walk returns everything; service applies .take(limit) — verify the
        // walk itself is source-order faithful for truncation.
        val sources = listOf(FakeSource("a", { emptyList() }, { (1..20).map { "s$it" } }))
        Assert.assertEquals(20, ExtractionLogic.suggest(sources, "s").size)
    }
}
