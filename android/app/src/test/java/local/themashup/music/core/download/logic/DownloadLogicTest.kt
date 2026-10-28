package local.themashup.music.core.download.logic

import local.themashup.music.core.domain.StreamCandidate
import org.junit.Assert
import org.junit.Test

class DownloadLogicTest {

    private fun audio(kbps: Int?, quality: String = "128k") = StreamCandidate(
        id = "a:$kbps:$quality",
        source = "piped",
        url = "https://cdn/audio-$kbps",
        mime = "audio/webm",
        ext = "webm",
        quality = quality,
        bitrateKbps = kbps,
    )

    private fun video(
        height: Int,
        videoOnly: Boolean,
        quality: String = "${height}p",
        kbps: Int? = null,
    ) = StreamCandidate(
        id = "v:$height:$videoOnly",
        source = "newpipe",
        url = "https://cdn/video-$height-$videoOnly",
        mime = "video/mp4",
        ext = "mp4",
        quality = quality,
        bitrateKbps = kbps,
        height = height,
        hasVideo = true,
        videoOnly = videoOnly,
    )

    @Test
    fun heightTargetMatchesResolverTable() {
        Assert.assertEquals(360, heightTarget("360p"))
        Assert.assertEquals(720, heightTarget("720p"))
        Assert.assertEquals(1080, heightTarget("1080p"))
        Assert.assertEquals(2160, heightTarget("4k"))
    }

    @Test
    fun candidateHeightFallsBackToLabel() {
        Assert.assertEquals(720, candidateHeight(video(720, false)))
        Assert.assertEquals(1080, candidateHeight(video(0, false, quality = "1080p60").copy(height = null)))
        Assert.assertNull(candidateHeight(audio(128)))
    }

    @Test
    fun pickAudioTakesHighestBitrate() {
        val list = listOf(audio(128), audio(320, "320k"), audio(null))
        Assert.assertEquals("320kBitrate", 320, pickAudio(list)?.bitrateKbps)
        Assert.assertNull(pickAudio(listOf(video(720, false))))
        Assert.assertEquals("nullKbpsLast", audio(null).id, pickAudio(listOf(audio(null)))?.id)
    }

    @Test
    fun pickVideoPrefersMuxedWithinTarget() {
        val list = listOf(
            video(1080, videoOnly = false),
            video(720, videoOnly = false),
            video(1080, videoOnly = true),
            audio(320, "320k"),
        )
        val plan = pickVideo(list, "720p")!!
        Assert.assertEquals(false, plan.isSplit)
        Assert.assertEquals(720, candidateHeight(plan.video))
    }

    @Test
    fun pickVideoSplitsWhenOnlyAdaptiveFits() {
        val list = listOf(
            video(1080, videoOnly = false),
            video(720, videoOnly = true),
            audio(128),
            audio(320, "320k"),
        )
        val plan = pickVideo(list, "720p")!!
        Assert.assertTrue(plan.isSplit)
        Assert.assertEquals(720, candidateHeight(plan.video))
        Assert.assertEquals(320, plan.audio?.bitrateKbps)
    }

    @Test
    fun pickVideoIsStrictAboutTargetCap() {
        // Web disables chips above manifest max — selection never overshoots.
        Assert.assertNull(pickVideo(listOf(video(1080, false), audio(320)), "720p"))
        Assert.assertNull(pickVideo(listOf(audio(320)), "720p"))
        Assert.assertNotNull(pickVideo(listOf(video(2160, false)), "4k"))
    }

    @Test
    fun availableHeightsAreSortedDistinct() {
        val list = listOf(video(720, true), video(1080, false), video(720, false), audio(320))
        Assert.assertEquals(listOf(720, 1080), availableVideoHeights(list))
    }

    @Test
    fun containerMimeAndExtensionMatrix() {
        Assert.assertEquals("audio/mpeg", mimeTypeFor("mp3"))
        Assert.assertEquals("audio/flac", mimeTypeFor("flac"))
        Assert.assertEquals("audio/ogg", mimeTypeFor("opus"))
        Assert.assertEquals("video/mp4", mimeTypeFor("mp4"))
        Assert.assertEquals("mp3", extensionFor("mp3"))
        Assert.assertEquals("mp4", extensionFor("mp4"))
    }

    @Test
    fun mp3CommandMatchesResolverCodecLine() {
        val cmds = buildTranscodeCommands("/data/app/ffmpeg", listOf("/tmp/in"), "/tmp/out.mp3", "mp3", "320k")
        Assert.assertEquals(1, cmds.size)
        Assert.assertEquals(
            listOf(
                "/data/app/ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", "/tmp/in", "-vn",
                "-codec:a", "libmp3lame", "-b:a", "320k", "/tmp/out.mp3",
            ),
            cmds[0],
        )
        val low = buildTranscodeCommands("ff", listOf("in"), "out.mp3", "mp3", "128k")
        Assert.assertTrue(low[0].containsAll(listOf("-b:a", "128k")))
    }

    @Test
    fun flacAndOpusCodecLinesMatchResolver() {
        val flac = buildTranscodeCommands("ff", listOf("in"), "out.flac", "flac", "best")[0]
        Assert.assertEquals(listOf("-vn", "-codec:a", "flac"), flac.subList(flac.size - 4, flac.size - 1))
        val opus = buildTranscodeCommands("ff", listOf("in"), "out.opus", "opus", "best")[0]
        Assert.assertTrue(opus.containsAll(listOf("libopus", "160k")))
    }

    @Test
    fun mp4SingleInputCopiesThenFallsBackToEncode() {
        val cmds = buildTranscodeCommands("ff", listOf("in.mp4"), "out.mp4", "mp4", "720p")
        Assert.assertEquals(2, cmds.size)
        Assert.assertTrue(cmds[0].contains("-c") && cmds[0].contains("copy"))
        Assert.assertTrue(cmds[1].containsAll(listOf("libx264", "aac")))
        Assert.assertFalse(cmds[0].contains("libx264"))
    }

    @Test
    fun mp4SplitMapsVideoAndAudioTracks() {
        val cmds = buildTranscodeCommands("ff", listOf("v.mp4", "a.webm"), "out.mp4", "mp4", "1080p")
        Assert.assertEquals(2, cmds.size)
        val primary = cmds[0]
        Assert.assertEquals("-map", primary[primary.indexOf("-map")])
        Assert.assertTrue(primary.containsAll(listOf("0:v:0", "1:a:0")))
        Assert.assertTrue(primary.contains("copy"))
        Assert.assertTrue(cmds[1].containsAll(listOf("-map", "0:v:0", "1:a:0", "libx264", "aac")))
    }

    @Test
    fun sanitizeFilenameStripsIllegalCharsAndCaps() {
        Assert.assertEquals("My Song_ Live _ 2024", sanitizeFilename("My Song: Live / 2024"))
        Assert.assertEquals("download", sanitizeFilename("   "))
        Assert.assertEquals("download", sanitizeFilename("..."))
        Assert.assertEquals("report.pdf", sanitizeFilename("report.pdf."))
        Assert.assertEquals(120, sanitizeFilename("x".repeat(300)).length)
        Assert.assertFalse(sanitizeFilename("a<b>c").contains("<"))
        Assert.assertEquals("Title.mp3", outputFilename("Title", "mp3"))
        Assert.assertEquals("Title.mp4", outputFilename("Title", "mp4"))
    }

    @Test
    fun downloadPercentCapsAtProcessingMarker() {
        Assert.assertEquals(49, downloadPercent(50, 100)) // 50% of the 98-phase
        Assert.assertEquals(98, downloadPercent(100, 100))
        Assert.assertEquals(0, downloadPercent(0, 100))
        Assert.assertEquals(-1, downloadPercent(10, 0)) // unknown total → indeterminate
        Assert.assertEquals(98, downloadPercent(200, 100))
    }

    @Test
    fun etaSecondsUsesBytesLeftOverSpeed() {
        Assert.assertEquals(5L, etaSeconds(500, 1000, 100))
        Assert.assertNull(etaSeconds(500, 1000, 0))
        Assert.assertNull(etaSeconds(500, 0, 100))
        Assert.assertNull(etaSeconds(1000, 1000, 100))
        Assert.assertEquals(1L, etaSeconds(999, 1000, 1)) // never 0 while pending
    }

    @Test
    fun dedupeFilenameAppendsCounterBeforeExtension() {
        Assert.assertEquals("song.mp3", dedupeFilename("song.mp3", emptySet()))
        Assert.assertEquals(
            "song (2).mp3",
            dedupeFilename("song.mp3", setOf("song.mp3")),
        )
        Assert.assertEquals(
            "song (3).mp3",
            dedupeFilename("song.mp3", setOf("song.mp3", "song (2).mp3")),
        )
        Assert.assertEquals(
            "clips (2).mp4",
            dedupeFilename("clips.mp4", setOf("clips.mp4")),
        )
        Assert.assertEquals("clip.mp4", dedupeFilename("clip.mp4", setOf("other.mp4")))
    }
}
