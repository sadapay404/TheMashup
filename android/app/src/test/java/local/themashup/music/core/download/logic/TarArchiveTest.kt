package local.themashup.music.core.download.logic

import java.io.ByteArrayInputStream
import java.io.File
import org.junit.Assert
import org.junit.Test

class TarArchiveTest {

    /** Builds one ustar header + payload (checksum computed like GNU tar). */
    private fun entry(name: String, payload: ByteArray, type: Char = '0', prefix: String = ""): ByteArray {
        val header = ByteArray(512)
        fun put(offset: Int, length: Int, value: String) {
            val bytes = value.toByteArray()
            for (i in 0 until minOf(length, bytes.size)) header[offset + i] = bytes[i]
        }
        put(0, 100, name)
        put(100, 8, "0000644\u0000")
        put(108, 8, "0000000\u0000")
        put(116, 8, "0000000\u0000")
        put(124, 12, payload.size.toString(8).padStart(11, '0') + "\u0000")
        put(136, 12, "00000000000\u0000")
        for (i in 148 until 156) header[i] = 0x20 // checksum field = spaces first
        header[156] = type.code.toByte()
        put(257, 6, "ustar\u0000")
        put(263, 2, "00")
        put(345, 155, prefix)
        var sum = 0L
        for (b in header) sum += (b.toInt() and 0xff).toLong()
        val chk = sum.toString(8).padStart(6, '0') + "\u0000 "
        for (i in chk.indices) header[148 + i] = chk[i].code.toByte()
        val pad = (512 - (payload.size % 512)) % 512
        return header + payload + ByteArray(pad)
    }

    private fun sampleTar(): ByteArray =
        entry("ffmpeg-bin/", ByteArray(0), type = '5') +
            entry("ffmpeg-bin/README.txt", "not me".toByteArray()) +
            entry("ffmpeg-bin/bin/ffmpeg", byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)) +
            entry("ffmpeg-bin/LICENSE", "license".toByteArray())

    @Test
    fun extractsMemberMatchingSuffix() {
        val dest = File.createTempFile("tar-test", ".bin")
        dest.delete()
        val ok = TarArchive.extract(ByteArrayInputStream(sampleTar()), dest, "bin/ffmpeg")
        Assert.assertTrue(ok)
        Assert.assertTrue(
            byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10).contentEquals(dest.readBytes()),
        )
        dest.delete()
    }

    @Test
    fun missingSuffixReturnsFalseAndWritesNothing() {
        val dest = File.createTempFile("tar-test-missing", ".bin")
        dest.delete()
        val ok = TarArchive.extract(ByteArrayInputStream(sampleTar()), dest, "bin/ffmpeg-static")
        Assert.assertFalse(ok)
        Assert.assertFalse(dest.exists())
    }

    @Test
    fun nonBlockAlignedPayloadSurvives() {
        // 7-byte + 5-byte members force different padding offsets.
        val tar = entry("a/x.bin", byteArrayOf(10, 20, 30)) +
            entry("a/deep/path/bin/ffmpeg", "hello-ffmpeg".toByteArray()) +
            entry("a/after.txt", "after".toByteArray())
        val dest = File.createTempFile("tar-test-aligned", ".bin")
        dest.delete()
        Assert.assertTrue(TarArchive.extract(ByteArrayInputStream(tar), dest, "bin/ffmpeg"))
        Assert.assertEquals("hello-ffmpeg", dest.readBytes().decodeToString())
        dest.delete()
    }

    @Test
    fun prefixSplitNamesResolve() {
        val tar = entry("file.bin", "prefix-work".toByteArray(), prefix = "long-directory-name")
        val dest = File.createTempFile("tar-test-prefix", ".bin")
        dest.delete()
        val ok = TarArchive.extract(ByteArrayInputStream(tar), dest, "file.bin")
        Assert.assertTrue(ok)
        Assert.assertEquals("prefix-work", dest.readBytes().decodeToString())
        dest.delete()
    }

    @Test
    fun junkHeaderDoesNotLoopForever() {
        val junk = ByteArray(512) { 0x41 } // 'A' everywhere — corrupt checksum
        val dest = File.createTempFile("tar-test-junk", ".bin")
        dest.delete()
        Assert.assertFalse(TarArchive.extract(ByteArrayInputStream(junk), dest, "bin/ffmpeg"))
        Assert.assertFalse(dest.exists())
    }
}
