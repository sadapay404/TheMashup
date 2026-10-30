package local.themashup.music.core.network

import org.junit.Assert
import org.junit.Test

class MusicHomeParserTest {
    @Test fun extractsPlayableRecommendationsWithoutTurningPlaylistsIntoTracks() {
        val body = """{"contents":{"musicCarouselShelfRenderer":{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"Your picks"}]}}},"contents":[{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Jhol"}]},"subtitle":{"runs":[{"text":"Artist"}]},"navigationEndpoint":{"watchEndpoint":{"videoId":"abc123def45"}},"thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://example.com/a"}]}}}}},{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Playlist"}]},"navigationEndpoint":{"browseEndpoint":{"browseId":"VL123"}}}}]}}}"""
        val shelves = MusicHomeParser.parse(body)
        Assert.assertEquals(1, shelves.size)
        Assert.assertEquals("Your picks", shelves[0].title)
        Assert.assertEquals(2, shelves[0].items.size)
        val track = (shelves[0].items[0] as MusicHomeItem.Song).track
        Assert.assertEquals("abc123def45", track.id)
        Assert.assertEquals("Jhol", track.title)
        Assert.assertEquals("VL123", (shelves[0].items[1] as MusicHomeItem.Collection).browseId)
    }
    @Test fun playlistMenuWatchIdIsNotTreatedAsSong() {
        val body = """{"musicCarouselShelfRenderer":{"contents":[{"musicTwoRowItemRenderer":{"title":{"simpleText":"Playlist"},"navigationEndpoint":{"browseEndpoint":{"browseId":"VLabc"}},"menu":{"watchEndpoint":{"videoId":"abc123def45"}}}}]}}"""
        Assert.assertTrue(MusicHomeParser.parse(body)[0].items.single() is MusicHomeItem.Collection)
    }
    @Test fun responsivePlaylistItemsArePlayableSongs() {
        val body = """{"musicPlaylistShelfRenderer":{"contents":[{"musicResponsiveListItemRenderer":{"flexColumns":[{"text":{"runs":[{"text":"A song"}]}},{"text":{"runs":[{"text":"An artist"}]}}],"playlistItemData":{"videoId":"abc123def45"}}}]}}"""
        val result = MusicHomeParser.parseCollection(kotlinx.serialization.json.Json.parseToJsonElement(body))
        Assert.assertEquals("A song", result.single().title)
        Assert.assertEquals("An artist", result.single().artistNames)
    }
    @Test fun albumTracksInheritAlbumArtworkAndArtist() {
        val body = """{"musicResponsiveHeaderRenderer":{"title":{"runs":[{"text":"Album title"}]},"subtitle":{"runs":[{"text":"Album"}]},"straplineTextOne":{"runs":[{"text":"Album artist"}]},"thumbnail":{"thumbnails":[{"url":"https://example.com/album"}]}},"musicPlaylistShelfRenderer":{"contents":[{"musicResponsiveListItemRenderer":{"flexColumns":[{"text":{"runs":[{"text":"Song"}]}}],"playlistItemData":{"videoId":"abc123def45"}}}]}}"""
        val track = MusicHomeParser.parseCollection(kotlinx.serialization.json.Json.parseToJsonElement(body)).single()
        Assert.assertEquals("Album artist", track.artistNames)
        Assert.assertEquals("Album title", track.album)
        Assert.assertEquals("https://example.com/album", track.artwork)
    }

    @Test fun quickPicksCanUseTitleRunWatchEndpoint() {
        val body = """{"musicCarouselShelfRenderer":{"contents":[{"musicResponsiveListItemRenderer":{"flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Quick pick","navigationEndpoint":{"watchEndpoint":{"videoId":"abc123def45"}}}]}}}]}}]}}"""
        val song = MusicHomeParser.parse(body).single().items.single() as MusicHomeItem.Song
        Assert.assertEquals("abc123def45", song.track.id)
    }
    @Test fun emptyResponseDoesNotInventRecommendations() {
        Assert.assertTrue(MusicHomeParser.parse("{}").isEmpty())
    }
}
