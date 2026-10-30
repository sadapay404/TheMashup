package local.themashup.music.core.network

import java.io.IOException
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert
import org.junit.Test

class YouTubeMusicHomeTest {
    private fun client(responseBody: String, onRequest: (okhttp3.Request) -> Unit = {}): OkHttpClient =
        OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            onRequest(req)
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(responseBody.toResponseBody("application/json".toMediaType())).build()
        }).build()

    @Test fun sapisidAloneIsNotAcceptedAsProofOfAccount() {
        val home = YouTubeMusicHome(client("{}"))
        val result = runCatching { home.verify("SAPISID=secret") }
        Assert.assertTrue(result.exceptionOrNull() is IOException)
    }

    @Test fun verifiedAccountUsesOnlyAuthenticatedMusicEndpoint() {
        var host = ""
        var authorization = ""
        val home = YouTubeMusicHome(client("""{"header":{"activeAccountHeaderRenderer":{}}}""") {
            host = it.url.host
            authorization = it.header("Authorization").orEmpty()
            Assert.assertEquals("SAPISID=secret", it.header("Cookie"))
        })
        home.verify("SAPISID=secret")
        Assert.assertEquals("music.youtube.com", host)
        Assert.assertTrue(authorization.startsWith("SAPISIDHASH "))
        Assert.assertFalse(authorization.contains("secret"))
    }

    @Test fun secureCookieFallbackUsesFirstNonblankSessionId() {
        Assert.assertEquals("three", YouTubeMusicHome.sessionId("SAPISID=; __Secure-3PAPISID=three; __Secure-1PAPISID=one"))
    }

    @Test fun malformedCookieIsRejectedBeforeNetworking() {
        var requests = 0
        val home = YouTubeMusicHome(client("{}") { requests++ })
        Assert.assertTrue(runCatching { home.verify("VISITOR_INFO1_LIVE=x") }.isFailure)
        Assert.assertEquals(0, requests)
    }
}
