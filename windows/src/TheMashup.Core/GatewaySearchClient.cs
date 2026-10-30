using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace TheMashup.Core;

/// <summary>
/// Uses the preview's own origin or an automatically started loopback host on
/// desktop. It never embeds a browser-facing localhost address or credentials.
/// </summary>
public sealed class GatewaySearchClient(HttpClient client, Func<CancellationToken, Task<Uri>> endpoint) : ISearchService
{
    private readonly HttpClient _client = client ?? throw new ArgumentNullException(nameof(client));
    private readonly Func<CancellationToken, Task<Uri>> _endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));

    public async Task<CatalogSearchResult> SearchAsync(string query, CancellationToken cancellationToken)
    {
        var result = await GetAsync($"api/search?q={Uri.EscapeDataString(query)}&limit=20",
            SearchJsonContext.Default.CatalogSearchResult, false, cancellationToken);
        if (result?.Tracks is null || result.Artists is null || result.Albums is null)
            throw new SearchProviderException("Search returned an incomplete response.");
        return result;
    }

    public async Task<SuggestionResult> SuggestAsync(string query, CancellationToken cancellationToken)
    {
        var result = await GetAsync($"api/search/suggest?q={Uri.EscapeDataString(query)}&limit=8",
            SearchJsonContext.Default.SuggestionResult, false, cancellationToken);
        if (result?.Suggestions is null) throw new SearchProviderException("Suggestions returned an incomplete response.");
        return result;
    }

    public async Task<LyricSearchResult> SearchLyricsAsync(string query, CancellationToken cancellationToken)
    {
        var result = await GetAsync($"api/search/lyrics?q={Uri.EscapeDataString(query)}",
            SearchJsonContext.Default.LyricSearchResult, false, cancellationToken);
        if (result?.Hits is null) throw new SearchProviderException("Lyric search returned an incomplete response.");
        return result;
    }

    public Task<LyricDocument?> GetLyricsAsync(CatalogTrack track, CancellationToken cancellationToken)
    {
        var path = $"api/lyrics/by-metadata?title={Uri.EscapeDataString(track.Title)}&artist={Uri.EscapeDataString(track.Artist)}";
        if (track.DurationSeconds is > 0 and <= 3600) path += $"&duration={track.DurationSeconds.Value}";
        return GetAsync(path, SearchJsonContext.Default.LyricDocument, true, cancellationToken);
    }

    private async Task<T?> GetAsync<T>(string path, JsonTypeInfo<T> type, bool allowNotFound, CancellationToken ct) where T : class
    {
        try
        {
            var baseUri = await _endpoint(ct);
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, path));
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (allowNotFound && response.StatusCode == HttpStatusCode.NotFound) return null;
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new SearchProviderException("Too many requests. Please try again shortly.");
            if (!response.IsSuccessStatusCode)
                throw new SearchProviderException("The provider is unavailable. Please try again.");
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            return await JsonSerializer.DeserializeAsync(stream, type, ct)
                ?? throw new SearchProviderException("The provider returned an empty response.");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new SearchProviderException("The request timed out. Please try again.");
        }
        catch (JsonException)
        {
            throw new SearchProviderException("The provider returned an invalid response.");
        }
        catch (HttpRequestException)
        {
            throw new SearchProviderException("The search connection is unavailable. Please try again.");
        }
    }
}

[JsonSerializable(typeof(CatalogSearchResult))]
[JsonSerializable(typeof(SuggestionResult))]
[JsonSerializable(typeof(LyricSearchResult))]
[JsonSerializable(typeof(LyricDocument))]
internal partial class SearchJsonContext : JsonSerializerContext { }
