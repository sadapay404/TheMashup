using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TheMashup.Core;

internal sealed class DownloadTrackRequest
{
    [JsonPropertyName("video_id")] public string VideoId { get; init; } = "";
    [JsonPropertyName("title")] public string Title { get; init; } = "";
}

internal sealed class DownloadBatchRequest
{
    [JsonPropertyName("tracks")] public DownloadTrackRequest[] Tracks { get; init; } = [];
    [JsonPropertyName("container")] public string Container { get; init; } = "";
    [JsonPropertyName("quality")] public string Quality { get; init; } = "";
}

internal sealed class DownloadBatchResponse
{
    [JsonPropertyName("jobs")] public DownloadJob[] Jobs { get; init; } = [];
}

internal sealed class DownloadListResponse
{
    [JsonPropertyName("jobs")] public DownloadJob[] Jobs { get; init; } = [];
}

internal sealed class DownloadGetResponse
{
    [JsonPropertyName("job")] public DownloadJob? Job { get; init; }
}

internal sealed class DownloadErrorResponse
{
    [JsonPropertyName("detail")] public string Detail { get; init; } = "";
}

/// <summary>Calls the private Windows gateway, which forwards to the local resolver download manager.</summary>
public sealed class GatewayDownloadClient(HttpClient _client, Func<CancellationToken, Task<Uri>> endpoint) : IDownloadService
{
    public async Task<IReadOnlyList<DownloadJob>> StartBatchAsync(IEnumerable<CatalogTrack> tracks, string container,
        string quality, CancellationToken cancellationToken)
    {
        var origin = await endpoint(cancellationToken);
        var session = await GetSessionAsync(origin, cancellationToken);
        var body = new DownloadBatchRequest
        {
            Tracks = tracks.Where(track => track.IsUsable).Select(track => new DownloadTrackRequest
            {
                VideoId = track.Id,
                Title = track.Title,
            }).ToArray(),
            Container = container,
            Quality = quality,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(origin, "api/downloads/start"))
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-TheMashup-Session", session);

        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new DownloadProviderException(await ReadError(response, cancellationToken));
        }

        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var result = JsonSerializer.Deserialize<DownloadBatchResponse>(text) ?? new DownloadBatchResponse();
        return result.Jobs;
    }

    public async Task<IReadOnlyList<DownloadJob>> ListAsync(CancellationToken cancellationToken)
    {
        var origin = await endpoint(cancellationToken);
        using var response = await _client.GetAsync(new Uri(origin, "api/downloads"), cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new DownloadProviderException(await ReadError(response, cancellationToken));
        }

        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var result = JsonSerializer.Deserialize<DownloadListResponse>(text) ?? new DownloadListResponse();
        return result.Jobs;
    }

    public async Task<DownloadJob> GetAsync(string jobId, CancellationToken cancellationToken)
    {
        var origin = await endpoint(cancellationToken);
        using var response = await _client.GetAsync(new Uri(origin, $"api/downloads/{Uri.EscapeDataString(jobId)}"), cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new DownloadProviderException(await ReadError(response, cancellationToken));
        }

        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var result = JsonSerializer.Deserialize<DownloadGetResponse>(text) ?? new DownloadGetResponse();
        return result.Job?.Id == jobId ? result.Job : new DownloadJob();
    }

    public async Task<DownloadJob> CancelAsync(string jobId, CancellationToken cancellationToken)
    {
        var origin = await endpoint(cancellationToken);
        using var response = await _client.DeleteAsync(new Uri(origin, $"api/downloads/{Uri.EscapeDataString(jobId)}"), cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new DownloadProviderException(await ReadError(response, cancellationToken));
        }

        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var result = JsonSerializer.Deserialize<DownloadGetResponse>(text) ?? new DownloadGetResponse();
        return result.Job ?? new DownloadJob { Id = jobId };
    }

    public async Task<Uri> FileUrlAsync(string jobId, CancellationToken cancellationToken)
    {
        var job = await GetAsync(jobId, cancellationToken);
        if (job.FileToken is null)
        {
            throw new DownloadProviderException("This download was not started in this session. Start it again to open the file.");
        }

        var origin = await endpoint(cancellationToken);
        return new Uri(origin, $"api/downloads/{Uri.EscapeDataString(jobId)}/file?token={Uri.EscapeDataString(job.FileToken)}");
    }

    private async Task<string> GetSessionAsync(Uri origin, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(origin, "api/playback/session"));
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var session = JsonSerializer.Deserialize<PlaybackSession>(text) ?? new PlaybackSession();
        return session.Session ?? "";
    }

    private static async Task<string> ReadError(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            var error = JsonSerializer.Deserialize<DownloadErrorResponse>(text);
            return string.IsNullOrWhiteSpace(error?.Detail) ? $"Download request failed ({(int)response.StatusCode})." : error.Detail;
        }
        catch
        {
            return $"Download request failed ({(int)response.StatusCode}).";
        }
    }
}
