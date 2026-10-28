package local.themashup.music.core.download.logic

import java.io.File
import java.io.InputStream

/**
 * Minimal ustar/POSIX tar reader — extracts ONE member (the ffmpeg binary)
 * straight to disk without holding the ~80 MB payload in memory.
 * Pure JVM (java.io) so the sandbox can test it against synthetic archives.
 */
object TarArchive {

    private const val BLOCK = 512

    /**
     * Streams [tar] looking for a file member whose path ends with
     * [pathSuffix] (BtbN archives root everything under a versioned folder).
     * Returns true when a member matched. The stream is NOT closed here.
     */
    fun extract(tar: InputStream, dest: File, pathSuffix: String): Boolean {
        var found = false
        val header = ByteArray(BLOCK)
        while (true) {
            val read = readFully(tar, header) ?: break
            if (read < BLOCK) break
            if (isZeroBlock(header)) break // EOF marker
            if (isCorrupt(header)) break
            val name = entryName(header)
            val size = octal(header, 124, 12) ?: 0L
            val type = header[156].toInt().toChar()
            val dataBlocks = (size + BLOCK - 1) / BLOCK
            val isFile = type == '0' || type == '\u0000' || type == '7'
            if (isFile && size > 0 && name.isNotEmpty() && name.endsWith(pathSuffix)) {
                dest.parentFile?.mkdirs()
                writeMember(tar, dest, size)
                found = true
                drain(tar, dataBlocks * BLOCK - size) // pad to block boundary
            } else {
                drain(tar, dataBlocks * BLOCK)
            }
        }
        return found
    }

    private fun writeMember(tar: InputStream, dest: File, size: Long) {
        dest.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            var left = size
            while (left > 0) {
                val n = tar.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (n < 0) break
                out.write(buf, 0, n)
                left -= n
            }
        }
    }

    private fun drain(tar: InputStream, bytes: Long) {
        var left = bytes
        while (left > 0) {
            val skipped = tar.skip(left)
            if (skipped > 0) {
                left -= skipped
            } else if (tar.read() < 0) {
                break
            } else {
                left--
            }
        }
    }

    /** Exactly [buf.size] bytes; null on immediate EOF. */
    private fun readFully(tar: InputStream, buf: ByteArray): Int? {
        var off = 0
        while (off < buf.size) {
            val n = tar.read(buf, off, buf.size - off)
            if (n < 0) return if (off == 0) null else off
            off += n
        }
        return off
    }

    private fun isZeroBlock(header: ByteArray): Boolean =
        header.all { it.toInt() == 0 }

    /** ustar name + prefix (prefix only when magic says ustar). */
    private fun entryName(header: ByteArray): String {
        val name = cstr(header, 0, 100)
        val magic = cstr(header, 257, 6)
        val prefix = if (magic.startsWith("ustar")) cstr(header, 345, 155) else ""
        return if (prefix.isNotEmpty()) "$prefix/$name" else name
    }

    private fun cstr(bytes: ByteArray, off: Int, len: Int): String =
        bytes.copyOfRange(off, off + len)
            .decodeToString()
            .substringBefore('\u0000')
            .trim()

    /** Octal size field → bytes; malformed → null. */
    private fun octal(bytes: ByteArray, off: Int, len: Int): Long? {
        val raw = cstr(bytes, off, len).trim().ifEmpty { return null }
        return raw.toLongOrNull(8)
    }

    /** Header checksum check — both candidate sums must disagree to call it junk. */
    private fun isCorrupt(header: ByteArray): Boolean {
        val stored = octal(header, 148, 8) ?: return false
        var withSpaces = 0L
        var asIs = 0L
        for (i in header.indices) {
            val b = header[i].toInt() and 0xff
            asIs += b.toLong()
            withSpaces += if (i in 148..155) 0x20L else b.toLong()
        }
        return withSpaces != stored && asIs != stored
    }
}
