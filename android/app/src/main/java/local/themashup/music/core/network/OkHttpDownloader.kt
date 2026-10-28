package local.themashup.music.core.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response

/**
 * Bridges NewPipeExtractor's [Downloader] abstraction onto OkHttp — the app
 * ships no separate downloader module, so this is our `DownloaderImpl`.
 * (NewPipe app's own impl lives in its repo; contract verified against
 * NewPipeExtractor v0.26.5 downloader sources.)
 */
class OkHttpDownloader(private val client: OkHttpClient) : Downloader() {

    override fun execute(request: Request): Response {
        val rb = okhttp3.Request.Builder().url(request.url())
        for ((name, values) in request.headers()) {
            for (v in values) rb.addHeader(name, v)
        }
        val method = request.httpMethod().uppercase()
        val data = request.dataToSend()
        val octet = "application/octet-stream".toMediaType()
        val body = when {
            data != null -> data.toRequestBody(octet)
            method == "GET" || method == "HEAD" -> null
            else -> ByteArray(0).toRequestBody(octet)
        }
        rb.method(method, body)

        client.newCall(rb.build()).execute().use { resp ->
            val headers = LinkedHashMap<String, List<String>>()
            for (name in resp.headers.names()) {
                headers[name] = resp.headers.values(name)
            }
            return Response(
                resp.code,
                resp.message,
                headers,
                resp.body?.string(),
                resp.request.url.toString(),
            )
        }
    }
}
