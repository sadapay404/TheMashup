package local.themashup.music.core.domain

import org.junit.Assert
import org.junit.Test

class QualityTest {

    @Test
    fun matrixMatchesGatewayValidation() {
        Assert.assertNull(validateDownloadQuality("mp3", "128k"))
        Assert.assertNull(validateDownloadQuality("mp3", "320k"))
        Assert.assertNull(validateDownloadQuality("flac", "best"))
        Assert.assertNull(validateDownloadQuality("opus", "best"))
        Assert.assertNull(validateDownloadQuality("mp4", "4k"))

        Assert.assertEquals(
            "quality 'mp3_320' invalid for mp3 (allowed: 128k, 320k)",
            validateDownloadQuality("mp3", "mp3_320"),
        )
        Assert.assertEquals(
            "quality 'best' invalid for mp3 (allowed: 128k, 320k)",
            validateDownloadQuality("mp3", "best"),
        )
        Assert.assertEquals(
            "quality '320k' invalid for flac (allowed: best)",
            validateDownloadQuality("flac", "320k"),
        )
        Assert.assertTrue(validateDownloadQuality("wav", "best")!!.startsWith("container 'wav' invalid"))
    }

    @Test
    fun constantsMatchSharedConstants() {
        Assert.assertEquals(listOf("128k", "320k", "best"), AUDIO_QUALITIES)
        Assert.assertEquals(listOf("360p", "720p", "1080p", "4k"), VIDEO_QUALITIES)
        Assert.assertEquals(listOf("ytdlp", "piped", "invidious"), RESOLVER_PRIORITY)
    }
}
