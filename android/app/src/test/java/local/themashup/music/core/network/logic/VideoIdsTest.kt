package local.themashup.music.core.network.logic

import org.junit.Assert
import org.junit.Test

class VideoIdsTest {

    @Test
    fun extractsFromCommonShapes() {
        Assert.assertEquals(
            "dQw4w9WgXcQ",
            VideoIds.fromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        )
        Assert.assertEquals(
            "dQw4w9WgXcQ",
            VideoIds.fromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123"),
        )
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("watch?v=dQw4w9WgXcQ"))
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("https://youtu.be/dQw4w9WgXcQ?t=10"))
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"))
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("https://www.youtube.com/live/dQw4w9WgXcQ"))
        Assert.assertEquals("dQw4w9WgXcQ", VideoIds.fromUrl("dQw4w9WgXcQ"))
    }

    @Test
    fun rejectsBadInput() {
        Assert.assertNull(VideoIds.fromUrl(null))
        Assert.assertNull(VideoIds.fromUrl(""))
        Assert.assertNull(VideoIds.fromUrl("   "))
        Assert.assertNull(VideoIds.fromUrl("https://example.com/watch?v=nope"))
        Assert.assertNull(VideoIds.fromUrl("tooshort"))
        Assert.assertNull(VideoIds.fromUrl("https://www.youtube.com/watch"))
    }

    @Test
    fun buildsWatchUrl() {
        Assert.assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            VideoIds.watchUrl("dQw4w9WgXcQ"),
        )
    }
}
