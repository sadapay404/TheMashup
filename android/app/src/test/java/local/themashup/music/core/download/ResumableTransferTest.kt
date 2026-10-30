package local.themashup.music.core.download

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.runBlocking
import local.themashup.music.core.domain.StreamCandidate
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert
import org.junit.Before
import org.junit.Test

class ResumableTransferTest {
    private lateinit var server: HttpServer
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
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = executor
        server.createContext("/media") { exchange -> serve(exchange) }
        server.start()
    }

    @After fun cleanup() { server.stop(0); executor.shutdownNow(); dir.deleteRecursively() }

    private fun serve(exchange: HttpExchange) {
        val data = bytes
        val range = exchange.requestHeaders.getFirst("Range")
        requests.add(range ?: "full")
        exchange.responseHeaders.add("ETag", tag)
        if (range == null || ignoreRanges) {
            exchange.sendResponseHeaders(200, data.size.toLong())
            exchange.responseBody.use { it.write(data) }
            return
        }
        val parts = range.removePrefix("bytes=").split("-")
        val start = parts[0].toInt()
        val end = parts[1].toInt()
        exchange.responseHeaders.add("Content-Range", "bytes $start-$end/${data.size}")
        exchange.sendResponseHeaders(206, (end - start + 1).toLong())
        try {
            exchange.responseBody.use { output ->
                val count = if (interrupt && end > start) minOf(4096, end - start + 1) else end - start + 1
                output.write(data, start, count)
                output.flush()
                if (stall && end > start) {
                    rangeStarted.countDown()
                    Thread.sleep(10_000)
                }
            }
        } catch (_: Exception) { exchange.close() }
    }

    private fun candidate() = StreamCandidate(
        id = "audio", source = "test", url = "http://127.0.0.1:${server.address.port}/media",
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
        interrupt = true
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
