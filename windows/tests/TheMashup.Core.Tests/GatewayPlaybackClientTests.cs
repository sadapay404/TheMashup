using System.Net;
using System.Text;
using TheMashup.Core;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class GatewayPlaybackClientTests
{
    [Fact]
    public async Task ResolvesOnlySafeSameOriginTokensAndDoesNotExposeProviderUrls()
    {
        var handler = new Handler(request => request.Method == HttpMethod.Get
            ? Json("{\"session\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
            : Json("""
                {"video_id":"valid000001","degraded":false,"candidates":[
                  {"play_url":"/api/playback/stream/aaaaaaaaaaaaaaaaaaaaaaaa","source":"ytdlp","has_video":false,"quality":"128k"},
                  {"play_url":"https://attacker.invalid/secret","source":"piped","has_video":false},
                  {"play_url":"//attacker.invalid/secret","source":"piped","has_video":false}]}
                """));
        var client = new GatewayPlaybackClient(new HttpClient(handler), _ => Task.FromResult(new Uri("https://preview.example/")));
        var result = await client.ResolveAsync("valid000001", PlaybackMode.Audio, "", true, CancellationToken.None);
        var candidate = Assert.Single(result.Candidates);
        Assert.Equal("https://preview.example/api/playback/stream/aaaaaaaaaaaaaaaaaaaaaaaa", candidate.PlayUri.ToString());
        Assert.Equal("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", handler.Token);
        Assert.Contains("\"refresh\":true", handler.Body);
        Assert.Contains("\"mode\":\"audio\"", handler.Body);
    }

    [Fact]
    public async Task BadSessionOrProviderFailureIsNotAPlayableEmptyResult()
    {
        var handler = new Handler(_ => Json("{\"session\":\"bad\"}"));
        var client = new GatewayPlaybackClient(new HttpClient(handler), _ => Task.FromResult(new Uri("https://preview.example/")));
        await Assert.ThrowsAsync<PlaybackProviderException>(() => client.ResolveAsync("valid000001", PlaybackMode.Audio, "", true, CancellationToken.None));
    }

    private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK) { Content = new StringContent(value, Encoding.UTF8, "application/json") };
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public string Token { get; private set; } = "";
        public string Body { get; private set; } = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method == HttpMethod.Post)
            {
                Token = request.Headers.GetValues("X-TheMashup-Session").Single();
                Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            }
            return respond(request);
        }
    }
}
