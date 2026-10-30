package local.themashup.music.core.download

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import local.themashup.music.core.domain.StreamCandidate
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * A single source transfer. Ranges are independent, so interrupted segments can
 * resume without discarding other segments. No credentials or URLs are persisted.
 */
internal class ResumableTransfer(private val client: OkHttpClient) {
    private val calls = ConcurrentHashMap.newKeySet<Call>()
    private val cancelled = AtomicBoolean(false)

    fun cancel() {
        cancelled.set(true)
        calls.forEach { it.cancel() }
    }

    private suspend fun <T> call(request: Request, consume: suspend (Response) -> T): T {
        coroutineContext.ensureActive()
        val call = client.newCall(request)
        calls.add(call)
        try {
            if (cancelled.get()) call.cancel()
            coroutineContext.ensureActive()
            return call.execute().use { consume(it) }
        } finally {
            calls.remove(call)
        }
    }

    suspend fun download(
        source: StreamCandidate,
        mediaId: String,
        dest: File,
        onProgress: suspend (bytes: Long, total: Long?, speed: Long?) -> Unit,
    ) {
        dest.parentFile?.mkdirs()
        fun request(range: String? = null, ifRange: String? = null): Request {
            val builder = Request.Builder().url(source.url)
            source.httpHeaders.forEach { (key, value) -> builder.header(key, value) }
            builder.header("Accept-Encoding", "identity")
            if (range != null) builder.header("Range", range)
            if (ifRange != null) builder.header("If-Range", ifRange)
            return builder.build()
        }
        val info = call(request("bytes=0-0")) { response ->
            when {
                response.code == 206 -> {
                    val range = parseContentRange(response.header("Content-Range"))
                        ?: throw IOException("Invalid range response")
                    if (range.start != 0L || range.end != 0L || range.total <= 0L)
                        throw IOException("Invalid range probe")
                    val etag = response.header("ETag")?.takeUnless { it.startsWith("W/", ignoreCase = true) }
                    val validator = etag ?: response.header("Last-Modified")
                    Probe(range.total, validator)
                }
                response.code == 200 -> null // server does not support byte ranges
                else -> throw IOException("HTTP ${response.code} checking stream")
            }
        }
        if (info == null) {
            // A server that ignores Range cannot safely continue a partial file.
            // Invalidate old segmented/completed metadata before replacing bytes.
            listOf(".complete", ".ranges", ".merge", ".part0", ".part1", ".part2", ".part3")
                .forEach { File(dest.path + it).delete() }
            singleStream(request(), dest, onProgress)
            return
        }

        val total = info.total
        val identity = if (info.validator != null) {
            // A refreshed signed URL may describe the same representation.
            listOf(mediaId, source.source, source.mime, source.quality, source.bitrateKbps,
                source.width, source.height, source.hasVideo, source.videoOnly, info.validator).joinToString("|")
        } else {
            // Without a validator only reuse data from exactly the same URL.
            source.url
        }
        val marker = sha256(identity) + ":" + total
        val metadata = File(dest.path + ".ranges")
        val complete = File(dest.path + ".complete")
        val parts = (0 until SEGMENTS).map { File(dest.path + ".part$it") }
        val merged = File(dest.path + ".merge")
        if (complete.isFile && complete.readText() == marker && dest.isFile && dest.length() == total) {
            parts.forEach { it.delete() }
            metadata.delete()
            onProgress(total, total, null)
            return
        }
        if (!metadata.isFile || metadata.readText() != marker) {
            parts.forEach { it.delete() }
            dest.delete()
            complete.delete()
            metadata.writeText(marker)
        }
        val ranges = parts.mapIndexed { i, file ->
            val start = total * i / SEGMENTS
            val end = total * (i + 1) / SEGMENTS - 1
            val length = (end - start + 1).coerceAtLeast(0)
            if (file.length() > length) file.delete()
            Part(start, end, file)
        }
        fun downloaded(): Long = ranges.sumOf { it.file.length().coerceAtMost((it.end - it.start + 1).coerceAtLeast(0)) }
        val initial = downloaded()
        val started = System.currentTimeMillis()
        onProgress(initial, total, null)
        coroutineScope {
            val reporter = launch {
                while (true) {
                    delay(1_500)
                    val count = downloaded()
                    val elapsed = (System.currentTimeMillis() - started).coerceAtLeast(1)
                    onProgress(count, total, ((count - initial).coerceAtLeast(0) * 1000 / elapsed))
                }
            }
            try {
                ranges.map { part -> async(Dispatchers.IO) {
                    if (part.end < part.start) return@async
                    var failures = 0
                    while (part.start + part.file.length() <= part.end) {
                        coroutineContext.ensureActive()
                        val offset = part.start + part.file.length()
                        try {
                            call(request("bytes=$offset-${part.end}", info.validator)) { response ->
                                if (response.code != 206) throw IOException("Server refused download range (HTTP ${response.code})")
                                val range = parseContentRange(response.header("Content-Range"))
                                    ?: throw IOException("Invalid Content-Range")
                                if (range.start != offset || range.end > part.end || range.total != total)
                                    throw IOException("Stream changed during download")
                                val returnedValidator = if (info.validator?.startsWith('"') == true) response.header("ETag")
                                    else response.header("Last-Modified")
                                if (returnedValidator != null && info.validator != null && returnedValidator != info.validator)
                                    throw IOException("Stream changed during download")
                                val body = response.body ?: throw IOException("Empty range response")
                                var received = 0L
                                body.byteStream().use { input ->
                                    FileOutputStream(part.file, true).buffered().use { out ->
                                        val buffer = ByteArray(128 * 1024)
                                        while (true) {
                                            coroutineContext.ensureActive()
                                            val n = input.read(buffer)
                                            if (n < 0) break
                                            received += n
                                            if (received > range.end - range.start + 1) throw IOException("Range too long")
                                            out.write(buffer, 0, n)
                                        }
                                    }
                                }
                                if (received != range.end - range.start + 1) throw IOException("Range interrupted")
                            }
                            failures = 0
                        } catch (e: IOException) {
                            coroutineContext.ensureActive()
                            if (++failures >= 4) throw e
                            delay(500L * failures)
                        }
                    }
                } }.awaitAll()
            } finally {
                reporter.cancel()
            }
        }
        merged.outputStream().buffered().use { output ->
            ranges.forEach { part ->
                coroutineContext.ensureActive()
                if (part.file.exists()) part.file.inputStream().buffered().use { it.copyTo(output) }
            }
        }
        if (merged.length() != total) throw IOException("Download size mismatch")
        if (!merged.renameTo(dest)) throw IOException("Could not assemble download")
        complete.writeText(marker)
        parts.forEach { it.delete() }
        metadata.delete()
        onProgress(total, total, null)
    }

    private suspend fun singleStream(
        request: Request,
        dest: File,
        onProgress: suspend (bytes: Long, total: Long?, speed: Long?) -> Unit,
    ) {
        val temp = File(dest.path + ".single")
        val started = System.currentTimeMillis()
        var lastUpdate = started
        try {
            call(request) { response ->
                if (response.code != 200) throw IOException("HTTP ${response.code} fetching stream")
                val body = response.body ?: throw IOException("Empty stream")
                val total = body.contentLength().takeIf { it >= 0 }
                var count = 0L
                body.byteStream().use { input -> temp.outputStream().buffered().use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        count += n
                        val now = System.currentTimeMillis()
                        if (now - lastUpdate >= 1_500) {
                            onProgress(count, total, count * 1000 / (now - started).coerceAtLeast(1))
                            lastUpdate = now
                        }
                    }
                } }
                if (total != null && count != total) throw IOException("Stream interrupted")
                dest.delete()
                if (!temp.renameTo(dest)) throw IOException("Could not save download")
                onProgress(count, total, null)
            }
        } finally {
            temp.delete()
        }
    }

    private data class Probe(val total: Long, val validator: String?)
    private data class Part(val start: Long, val end: Long, val file: File)
    private data class ContentRange(val start: Long, val end: Long, val total: Long)

    private fun parseContentRange(value: String?): ContentRange? {
        val match = RANGE.matchEntire(value ?: "") ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val end = match.groupValues[2].toLongOrNull() ?: return null
        val total = match.groupValues[3].toLongOrNull() ?: return null
        return if (start <= end && end < total) ContentRange(start, end, total) else null
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }

    private companion object {
        const val SEGMENTS = 4
        val RANGE = Regex("bytes (\\d+)-(\\d+)/(\\d+)")
    }
}
