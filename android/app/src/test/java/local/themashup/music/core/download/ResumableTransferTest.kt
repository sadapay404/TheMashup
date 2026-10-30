package local.themashup.music.core.download

import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import local.themashup.music.core.domain.StreamCandidate
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert
import org.junit.Before
import org.junit.Test

/** Real local HTTP responses, including broken connections; no Android-only server API. */
class ResumableTransferTest {
    private lateinit var server: ServerSocket
    private lateinit var dir: File
    private val executor = Executors.newCachedThreadPool()
    private val requests = Collections.synchronizedList(mutableListOf<String>())
    private val original = ByteArray(256 * 1024) { ((it * 19) % 251).toByte() }
    @Volatile private var bytes = original
    @Volatile private var tag = "\"version-1\""
    @Volatile private var interrupt = false
    @Volatile private var ignoreRanges = false
    @Volatile private var stall = false
    private val rangeStarted = CountDownLatch(1)

    @Before fun setup() {
        dir = kotlin.io.path.createTempDirectory("download-test").toFile()
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        executor.execute {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                executor.execute { serve(socket) }
            }
        }
    }

    @After fun cleanup() {
        server.close()
        executor.shutdownNow()
        dir.deleteRecursively()
    }

    private fun serve(socket: Socket) {
        try {
            socket.use { peer ->
                val reader = BufferedReader(InputStreamReader(peer.getInputStream(), Charsets.ISO_8859_1))
                if (reader.readLine() == null) return
                var range: String? = null
                while (true) {
                    val line = reader.readLine() ?: return
                    if (line.isEmpty()) break
                    if (line.startsWith("Range:", ignoreCase = true)) range = line.substringAfter(':').trim()
                }
                requests.add(range ?: "full")
                val data = bytes
                val currentTag = tag
                val output = peer.getOutputStream()
                if (range == null || ignoreRanges) {
                    val headers = "HTTP/1.1 200 OK\r\nContent-Length: ${data.size}\r\nETag: $currentTag\r\nConnection: close\r\n\r\n"
                    output.write(headers.toByteArray(Charsets.ISO_8859_1))
                    output.write(data)
                    output.flush()
                    return
                }
                val bounds = range.removePrefix("bytes=").split("-")
                val start = bounds[0].toInt()
                val end = bounds[1].toInt()
                val length = end - start + 1
                val headers = "HTTP/1.1 206 Partial Content\r\nContent-Length: $length\r\n" +
                    "Content-Range: bytes $start-$end/${data.size}\r\nETag: $currentTag\r\nConnection: close\r\n\r\n"
                output.write(headers.toByteArray(Charsets.ISO_8859_1))
                output.flush()
                if (stall && end > start) {
                    rangeStarted.countDown()
                    Thread.sleep(10_000)
                }
                val count = if (interrupt && end > start) minOf(4096, length) else length
                output.write(data, start, count)
                output.flush()
                // Closing before Content-Length has been sent emulates a dropped connection.
            }
        } catch (_: Exception) {
            // A client may cancel or close the probe before reading the response body.
        }
    }

    private fun candidate() = StreamCandidate(
        id = "audio", source = "test", url = "http://127.0.0.1:${server.localPort}/media",
        mime = "audio/mp4", ext = "m4a", quality = "128k",
    )

    @Test fun interruptedRangesResumeWithoutRedownloadingCompletedBytes() = runBlocking {
        interrupt = true
        val file = File(dir, "song")
        val first = runCatching { ResumableTransfer(OkHttpClient()).download(candidate(), "video", file) { _, _, _ -> } }
        Assert.assertTrue("first transfer should be interrupted", first.isFailure)
        val partials = dir.listFiles().orEmpty().filter { ".part" in it.name }.sumOf { it.length() }
        Assert.assertTrue("some data should be retained", partials > 0)
        interrupt = false
        requests.clear()
        ResumableTransfer(OkHttpClient()).download(candidate(), "video", file) { _, _, _ -> }
        Assert.assertArrayEquals(original, file.readBytes())
        Assert.assertTrue("resume must request at least one non-boundary offset", requests.any {
            val start = it.removePrefix("bytes=").substringBefore('-').toIntOrNull() ?: 0
            start > 0 && start % (original.size / 4) != 0
        })
    }

    @Test fun changedValidatorDiscardsOldParts() = runBlocking {
        interrupt = true
        val file = File(dir, "song")
        runCatching { ResumableTransfer(OkHttpClient()).download(candidate(), "video", file) { _, _, _ -> } }
        bytes = ByteArray(original.size) { (it % 101).toByte() }
        tag = "\"version-2\""
        interrupt = false
        ResumableTransfer(OkHttpClient()).download(candidate(), "video", file) { _, _, _ -> }
        Assert.assertArrayEquals(bytes, file.readBytes())
    }

    @Test fun cancellationClosesActiveRangeConnections() = runBlocking {
        stall = true
        val transfer = ResumableTransfer(OkHttpClient())
        val job = launch(Dispatchers.IO) { transfer.download(candidate(), "video", File(dir, "song")) { _, _, _ -> } }
        Assert.assertTrue("range request never started", rangeStarted.await(5, TimeUnit.SECONDS))
        job.cancel()
        transfer.cancel()
        withTimeout(3_000) { job.join() }
        Assert.assertTrue(job.isCancelled)
    }

    @Test fun serverIgnoringRangesFallsBackToWholeFile() = runBlocking {
        ignoreRanges = true
        val file = File(dir, "song")
        ResumableTransfer(OkHttpClient()).download(candidate(), "video", file) { _, _, _ -> }
        Assert.assertArrayEquals(original, file.readBytes())
        Assert.assertTrue(requests.contains("full"))
    }
}
