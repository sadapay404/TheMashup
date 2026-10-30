package local.themashup.music.core.network

import java.io.IOException
import java.util.concurrent.TimeUnit
import local.themashup.music.core.network.logic.FallbackHosts
import okhttp3.OkHttpClient
import okhttp3.Request

/** Blocking GET returning body text — non-2xx throws (resolver `raise_for_status`). */
fun OkHttpClient.get_BODY(url: String, headers: Map<String, String> = emptyMap()): String {
    val rb = Request.Builder().url(url)
    headers.forEach { (k, v) -> rb.header(k, v) }
    newCall(rb.build()).execute().use { resp ->
        if (!resp.isSuccessful) {
            throw IOException("HTTP ${resp.code} for $url")
        }
        return resp.body?.string() ?: throw IOException("empty body for $url")
    }
}

/**
 * N9 YouTube sign-in cookie — captured once by the WebView sign-in screen
 * (innertune/SimpMusic method) and attached to every youtube.com request by
 * [newNetworkClient]. Volatile + read per request, so saving a cookie later
 * applies immediately even though NewPipe inits the client only once.
 */
object YouTubeCookie {
    @Volatile
    var value: String? = null
}

/** Client config shared by all N3 HTTP calls (resolver REQUEST_TIMEOUT = 8s). */
fun newNetworkClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(FallbackHosts.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    .readTimeout(FallbackHosts.REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    .addInterceptor { chain ->
        val cookie = YouTubeCookie.value
        val request = chain.request()
        if (!cookie.isNullOrBlank() && (request.url.host == "youtube.com" || request.url.host.endsWith(".youtube.com"))) {
            chain.proceed(request.newBuilder().header("Cookie", cookie).build())
        } else {
            chain.proceed(request)
        }
    }
    .build()
