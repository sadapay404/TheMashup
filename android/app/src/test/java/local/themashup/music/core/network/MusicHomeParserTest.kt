package local.themashup.music.core.network

import org.junit.Assert
import org.junit.Test

class MusicHomeParserTest {
    @Test fun extractsPlayableRecommendationsWithoutTurningPlaylistsIntoTracks() {
        val body = """{"contents":{"musicCarouselShelfRenderer":{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"Your picks"}]}}},"contents":[{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Jhol"}]},"subtitle":{"runs":[{"text":"Artist"}]},"navigationEndpoint":{"watchEndpoint":{"videoId":"abc123def45"}},"thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://example.com/a"}]}}}}},{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Playlist"}]},"navigationEndpoint":{"browseEndpoint":{"browseId":"VL123"}}}}]}}}"""
        val shelves = MusicHomeParser.parse(body)
        Assert.assertEquals(1, shelves.size)
        Assert.assertEquals("Your picks", shelves[0].title)
        Assert.assertEquals(1, shelves[0].tracks.size)
        Assert.assertEquals("abc123def45", shelves[0].tracks[0].id)
        Assert.assertEquals("Jhol", shelves[0].tracks[0].title)
    }
    @Test fun emptyResponseDoesNotInventRecommendations() {
        Assert.assertTrue(MusicHomeParser.parse("{}").isEmpty())
    }
}
