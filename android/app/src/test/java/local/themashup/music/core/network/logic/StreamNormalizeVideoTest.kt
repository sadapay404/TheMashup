package local.themashup.music.core.network.logic

import org.junit.Assert
import org.junit.Test

class StreamNormalizeVideoTest {

    @Test
    fun pipedVideoCandidateMapsMuxedAndAdaptive() {
        val muxed = StreamNormalize.videoCandidate(
            source = "piped",
            url = "https://cdn/videoplayback?expire=1700000000&itag=22",
            mime = "video/mp4; codecs=\"avc1.64001F, mp4a.40.2\"",
            quality = "720p",
            width = 1280,
            height = 720,
            videoOnly = false,
            sizeValue = "1048576",
        )
        Assert.assertNotNull(muxed)
        Assert.assertTrue(muxed!!.hasVideo)
        Assert.assertFalse(muxed.videoOnly)
        Assert.assertEquals(720, muxed.height)
        Assert.assertEquals("mp4", muxed.ext)
        Assert.assertEquals(1_048_576L, muxed.sizeBytes)
        Assert.assertEquals("2023-11-14T22:13:20Z", muxed.expiresAt)

        val adaptive = StreamNormalize.videoCandidate(
            source = "piped",
            url = "https://cdn/videoplayback?itag=137",
            mime = "video/webm; codecs=\"vp9\"",
            quality = "1080p",
            width = null,
            height = null,
            videoOnly = true,
            sizeValue = null,
        )!!
        Assert.assertTrue(adaptive.videoOnly)
        Assert.assertEquals("webm", adaptive.ext)
        Assert.assertEquals("1080p", adaptive.quality)
    }

    @Test
    fun videoCandidateRejectsBlankUrlAndKeepsHeaders() {
        Assert.assertNull(
            StreamNormalize.videoCandidate(
                source = "piped", url = null, mime = "video/mp4",
                quality = "720p", width = 1, height = 1, videoOnly = false, sizeValue = null,
            ),
        )
        val c = StreamNormalize.videoCandidate(
            source = "newpipe", url = "https://cdn/x?expire=1700000000", mime = "video/mp4",
            quality = null, width = null, height = 480, videoOnly = false, sizeValue = null,
        )!!
        Assert.assertEquals("480p", c.quality) // label synthesized from height
        Assert.assertEquals(StreamNormalize.YOUTUBE_HEADERS, c.httpHeaders)
        Assert.assertNull(c.width)
    }

    @Test
    fun videoExtFromMimeRules() {
        Assert.assertEquals("mp4", StreamNormalize.videoExtFromMime("video/mp4; codecs=\"avc1\""))
        Assert.assertEquals("webm", StreamNormalize.videoExtFromMime("video/webm"))
        Assert.assertEquals("video", StreamNormalize.videoExtFromMime("application/octet-stream"))
    }
}
