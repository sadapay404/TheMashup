using System.Collections.ObjectModel;
using System.Net.Http.Headers;
using Avalonia.Threading;

namespace TheMashup.Services;

public enum JobStatus { Queued, Downloading, Paused, Done, Error, Cancelled }

public sealed class DownloadJobVM : ObservableBase
{
    private JobStatus _status = JobStatus.Queued;
    private long _received, _total;
    private string? _error;

    public string Id { get; init; } = "";
    public Track Track { get; init; } = new("", "", "");
    public string Quality { get; init; } = "192";
    public CancellationTokenSource? Cts { get; set; }

    public JobStatus Status { get => _status; set { if (Set(ref _status, value)) { Raise(nameof(StatusText)); Raise(nameof(CanPause)); Raise(nameof(CanResume)); } } }
    public long Received { get => _received; set { if (Set(ref _received, value)) { Raise(nameof(Progress)); Raise(nameof(SizeText)); } } }
    public long Total { get => _total; set { if (Set(ref _total, value)) { Raise(nameof(Progress)); Raise(nameof(SizeText)); } } }
    public string? Error { get => _error; set { Set(ref _error, value); Raise(nameof(StatusText)); } }

    public double Progress => Total > 0 ? Math.Clamp(Received * 100.0 / Total, 0, 100) : 0;
    public bool CanPause => Status == JobStatus.Downloading;
    public bool CanResume => Status is JobStatus.Paused or JobStatus.Error;
    public string StatusText => Status == JobStatus.Error ? $"Error: {Error}" : Status.ToString();
    public string SizeText => Total > 0 ? $"{Received / 1048576.0:0.0} / {Total / 1048576.0:0.0} MB" : $"{Received / 1048576.0:0.0} MB";
    public string Title => Track.Title;
    public string Subtitle => $"{Track.Artist} · {(Quality == "mp4" ? "MP4 video" : Quality + "k")}";
}

/// <summary>Download queue with progress, pause/resume (HTTP Range) and cancel. Files land in Music\TheMashup.</summary>
public sealed class DownloadService
{
    private readonly SourceClient _sources;
    private readonly LibraryStore _library;
    private readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private const int MaxParallel = 2;

    public ObservableCollection<DownloadJobVM> Jobs { get; } = new();

    public DownloadService(SourceClient sources, LibraryStore library)
    {
        _sources = sources; _library = library;
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
    }

    private static string Safe(string s) => string.Concat(s.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));

    public void Start(Track t, string quality)
    {
        var id = $"{t.Id}|{quality}";
        if (Jobs.Any(j => j.Id == id && j.Status is JobStatus.Queued or JobStatus.Downloading or JobStatus.Paused)) return;
        var old = Jobs.FirstOrDefault(j => j.Id == id);
        if (old != null) Jobs.Remove(old);
        Jobs.Insert(0, new DownloadJobVM { Id = id, Track = t, Quality = quality });
        Pump();
    }

    public void Pause(DownloadJobVM j) { j.Status = JobStatus.Paused; j.Cts?.Cancel(); }
    public void Resume(DownloadJobVM j) { j.Error = null; j.Status = JobStatus.Queued; Pump(); }
    public void Cancel(DownloadJobVM j)
    {
        j.Status = JobStatus.Cancelled; j.Cts?.Cancel();
        try { File.Delete(PartPath(j)); } catch { /* ignore */ }
        Pump();
    }
    public void ClearFinished() { foreach (var j in Jobs.Where(j => j.Status is JobStatus.Done or JobStatus.Cancelled or JobStatus.Error).ToList()) Jobs.Remove(j); }

    private static string PartPath(DownloadJobVM j) => Path.Combine(AppPaths.Downloads, Safe(j.Id) + ".part");

    private void Pump()
    {
        var running = Jobs.Count(j => j.Status == JobStatus.Downloading);
        foreach (var j in Jobs.Where(j => j.Status == JobStatus.Queued).Take(Math.Max(0, MaxParallel - running)).ToList())
        {
            j.Status = JobStatus.Downloading;
            _ = Task.Run(() => RunAsync(j));
        }
    }

    private void Ui(Action a) => Dispatcher.UIThread.Post(a);

    private async Task RunAsync(DownloadJobVM j)
    {
        j.Cts = new CancellationTokenSource();
        var ct = j.Cts.Token;
        try
        {
            Directory.CreateDirectory(AppPaths.Downloads);
            var video = j.Quality == "mp4";
            var r = await _sources.ResolveAsync(j.Track, int.TryParse(j.Quality, out var q) ? q : 192, video, ct)
                ?? throw new Exception(video ? "Video is not available from the current mirrors." : "No downloadable source found.");
            var part = PartPath(j);
            long have = File.Exists(part) ? new FileInfo(part).Length : 0;
            using var req = new HttpRequestMessage(HttpMethod.Get, r.Url);
            if (have > 0) req.Headers.Range = new RangeHeaderValue(have, null);
            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!resp.IsSuccessStatusCode) throw new Exception($"HTTP {(int)resp.StatusCode}");
            if (have > 0 && (int)resp.StatusCode != 206) { File.Delete(part); have = 0; }
            var total = (resp.Content.Headers.ContentLength ?? 0) + (resp.Content.Headers.ContentLength > 0 ? have : 0);
            var mime = resp.Content.Headers.ContentType?.MediaType ?? "";
            Ui(() => j.Total = total);
            await using (var fs = new FileStream(part, have > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write))
            await using (var input = await resp.Content.ReadAsStreamAsync(ct))
            {
                var buf = new byte[64 * 1024];
                long got = have; var last = Environment.TickCount64;
                int n;
                while ((n = await input.ReadAsync(buf, ct)) > 0)
                {
                    await fs.WriteAsync(buf.AsMemory(0, n), ct);
                    got += n;
                    if (Environment.TickCount64 - last > 200) { last = Environment.TickCount64; var g = got; Ui(() => j.Received = g); }
                }
                var final = got; Ui(() => j.Received = final);
            }
            var ext = video ? "mp4" : mime.Contains("webm") ? "webm" : mime.Contains("mpeg") ? "mp3" : "m4a";
            var dest = Path.Combine(AppPaths.Downloads, Safe($"{j.Track.Artist} - {j.Track.Title}.{j.Quality}") + "." + ext);
            File.Move(part, dest, true);
            var size = new FileInfo(dest).Length;
            Ui(() =>
            {
                _library.AddDownload(new DownloadedTrack { Track = j.Track, Quality = j.Quality, Path = dest, Size = size });
                j.Total = size; j.Received = size; j.Status = JobStatus.Done;
            });
        }
        catch (OperationCanceledException) { /* pause/cancel already set status */ }
        catch (Exception ex) { Ui(() => { j.Error = ex.Message; j.Status = JobStatus.Error; }); }
        finally { Ui(Pump); }
    }
}
