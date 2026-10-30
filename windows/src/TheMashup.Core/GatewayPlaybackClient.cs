using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;

namespace TheMashup.Core;

/// <summary>Only same-origin, tokenized stream paths leave the local host.</summary>
public sealed partial class GatewayPlaybackClient(HttpClient client, Func<CancellationToken, Task<Uri>> endpoint) : IPlaybackResolver
{
    private readonly HttpClient _client = client ?? throw new ArgumentNullException(nameof(client));
    private readonly Func<CancellationToken, Task<Uri>> _endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));

    public async Task<PlaybackResolution> ResolveAsync(string videoId, PlaybackMode mode, string after,
        bool refresh, CancellationToken cancellationToken)
    {
        try
        {
            var origin = await _endpoint(cancellationToken);
            using var sessionRequest = new HttpRequestMessage(HttpMethod.Get, new Uri(origin, "api/playback/session"));
            using var sessionResponse = await _client.SendAsync(sessionRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!sessionResponse.IsSuccessStatusCode) throw Unavailable();
            var session = await ReadAsync(sessionResponse, PlaybackJsonContext.Default.PlaybackSession, cancellationToken);
            if (session?.Session is null || !SessionPattern().IsMatch(session.Session)) throw Unavailable();
            var body = new PlaybackRequest { VideoId = videoId, Mode = mode == PlaybackMode.Video ? "video" : "audio", After = after, Refresh = refresh };
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(origin, "api/playback/resolve"));
            request.Headers.Add("X-TheMashup-Session", session.Session);
            request.Content = new StringContent(JsonSerializer.Serialize(body, PlaybackJsonContext.Default.PlaybackRequest), Encoding.UTF8, "application/json");
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new PlaybackProviderException("Too many playback requests. Please try again shortly.");
            if (!response.IsSuccessStatusCode) throw Unavailable();
            var result = await ReadAsync(response, PlaybackJsonContext.Default.PlaybackResponse, cancellationToken);
            if (result?.Candidates is null || result.VideoId != videoId) throw Unavailable();
            var candidates = new List<PlaybackCandidate>();
            foreach (var item in result.Candidates.Take(8))
            {
                if (item is null || item.PlayUrl is null || !StreamPathPattern().IsMatch(item.PlayUrl) ||
                    item.Source is not ("ytdlp" or "piped" or "invidious") ||
                    (mode == PlaybackMode.Video && !item.HasVideo)) continue;
                var uri = new Uri(origin, item.PlayUrl);
                if (uri.Scheme != origin.Scheme || uri.Authority != origin.Authority) continue;
                candidates.Add(new PlaybackCandidate(uri, item.Source, item.HasVideo, item.Quality ?? ""));
            }
            if (candidates.Count == 0) throw Unavailable();
            return new PlaybackResolution(candidates, result.Degraded);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PlaybackProviderException("Playback timed out. Please try again.");
        }
        catch (JsonException) { throw Unavailable(); }
        catch (HttpRequestException) { throw Unavailable(); }
    }

    private static async Task<T?> ReadAsync<T>(HttpResponseMessage response, JsonTypeInfo<T> type, CancellationToken ct) where T : class
    {
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonSerializer.DeserializeAsync(stream, type, ct);
    }

    private static PlaybackProviderException Unavailable() => new("Playback sources are unavailable. Please try again.");
    [GeneratedRegex(@"^[A-Za-z0-9_-]{32}$")] private static partial Regex SessionPattern();
    [GeneratedRegex(@"^/api/playback/stream/[A-Za-z0-9_-]{24}$")] private static partial Regex StreamPathPattern();
}

internal sealed class PlaybackSession
{
    [JsonPropertyName("session")] public string? Session { get; init; }
}
internal sealed class PlaybackRequest
{
    [JsonPropertyName("video_id")] public string VideoId { get; init; } = "";
    [JsonPropertyName("mode")] public string Mode { get; init; } = "audio";
    [JsonPropertyName("after")] public string After { get; init; } = "";
    [JsonPropertyName("refresh")] public bool Refresh { get; init; }
}
internal sealed class PlaybackCandidateDto
{
    [JsonPropertyName("play_url")] public string? PlayUrl { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("has_video")] public bool HasVideo { get; init; }
    [JsonPropertyName("quality")] public string? Quality { get; init; }
}
internal sealed class PlaybackResponse
{
    [JsonPropertyName("video_id")] public string? VideoId { get; init; }
    [JsonPropertyName("candidates")] public PlaybackCandidateDto[]? Candidates { get; init; }
    [JsonPropertyName("degraded")] public bool Degraded { get; init; }
}
[JsonSerializable(typeof(PlaybackSession))]
[JsonSerializable(typeof(PlaybackRequest))]
[JsonSerializable(typeof(PlaybackResponse))]
internal partial class PlaybackJsonContext : JsonSerializerContext { }
