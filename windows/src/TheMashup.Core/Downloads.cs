using System.Text.Json.Serialization;

namespace TheMashup.Core;

public enum DownloadStatus { Queued, Downloading, Processing, Completed, Failed }

/// <summary>Download job state returned by the private Windows download gateway.</summary>
public sealed class DownloadJob
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("video_id")] public string VideoId { get; init; } = "";
    [JsonPropertyName("container")] public string Container { get; init; } = "";
    [JsonPropertyName("quality")] public string Quality { get; init; } = "";
    [JsonPropertyName("status")] public string Status { get; init; } = "";
    [JsonPropertyName("progress")] public int Progress { get; init; }
    [JsonPropertyName("filesize")] public long? FileSize { get; init; }
    [JsonPropertyName("filename")] public string? Filename { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("file_token")] public string? FileToken { get; init; }
}

public interface IDownloadService
{
    Task<IReadOnlyList<DownloadJob>> StartBatchAsync(IEnumerable<CatalogTrack> tracks, string container,
        string quality, CancellationToken cancellationToken);
    Task<IReadOnlyList<DownloadJob>> ListAsync(CancellationToken cancellationToken);
    Task<DownloadJob> GetAsync(string jobId, CancellationToken cancellationToken);
    Task<DownloadJob> CancelAsync(string jobId, CancellationToken cancellationToken);
    Task<Uri> FileUrlAsync(string jobId, CancellationToken cancellationToken);
}

public sealed class DownloadProviderException(string message) : Exception(message);

public sealed class UnavailableDownloadService : IDownloadService
{
    public Task<IReadOnlyList<DownloadJob>> StartBatchAsync(IEnumerable<CatalogTrack> tracks, string container,
        string quality, CancellationToken cancellationToken) =>
        Task.FromException<IReadOnlyList<DownloadJob>>(new DownloadProviderException("Downloads are not available in this build."));
    public Task<IReadOnlyList<DownloadJob>> ListAsync(CancellationToken cancellationToken) =>
        Task.FromException<IReadOnlyList<DownloadJob>>(new DownloadProviderException("Downloads are not available in this build."));
    public Task<DownloadJob> GetAsync(string jobId, CancellationToken cancellationToken) =>
        Task.FromException<DownloadJob>(new DownloadProviderException("Downloads are not available in this build."));
    public Task<DownloadJob> CancelAsync(string jobId, CancellationToken cancellationToken) =>
        Task.FromException<DownloadJob>(new DownloadProviderException("Downloads are not available in this build."));
    public Task<Uri> FileUrlAsync(string jobId, CancellationToken cancellationToken) =>
        Task.FromException<Uri>(new DownloadProviderException("Downloads are not available in this build."));
}
