using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using Avalonia.Media.Imaging;
using Avalonia.Threading;

namespace TheMashup.Services;

public abstract class ObservableBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected void Raise([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        Raise(name);
        return true;
    }
}

public sealed class RelayCommand : ICommand
{
    private readonly Action<object?> _run;
    public RelayCommand(Action<object?> run) => _run = run;
    public RelayCommand(Action run) => _run = _ => run();
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter)
    {
        try { _run(parameter); }
        catch (Exception ex) { Program.Log(ex.ToString()); }
    }
}

public sealed record Track(
    string Id, string Title, string Artist, string? Album = null, string? Artwork = null,
    int? Duration = null, string? PreviewUrl = null, string? LyricLine = null);

public sealed record Artist(string Id, string Name);
public sealed record Album(string Id, string Title, string Artist, string? Artwork);

public sealed class SearchResult
{
    public List<Track> Songs { get; set; } = new();
    public List<Track> Lyrics { get; set; } = new();
    public List<Artist> Artists { get; set; } = new();
    public List<Album> Albums { get; set; } = new();
    public List<string> Via { get; set; } = new();
    public string? Error { get; set; }
}

public sealed record Resolved(string Url, string Kind, string Via);
public sealed record LyricLine(double T, string Text);
public sealed record LyricsData(List<LyricLine> Synced, string Plain);

public enum PState { Idle, Loading, Playing, Paused, Error, Stopped }
public enum RepeatMode { Off, All, One }

/// <summary>Track wrapper for lists: lazy artwork loading + list context for "play from here".</summary>
public sealed class TrackVM : ObservableBase
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly Dictionary<string, Bitmap?> Cache = new();
    private bool _requested;
    private Bitmap? _art;
    private bool _isCurrent;
    private bool _liked;
    private bool _offline;

    public Track Track { get; }
    public IReadOnlyList<Track> Source { get; }
    public int Index { get; }

    public TrackVM(Track t, IReadOnlyList<Track> source, int index) { Track = t; Source = source; Index = index; }

    public string Title => Track.Title;
    public string Artist => Track.Artist;
    public string Subtitle => string.IsNullOrEmpty(Track.Album) ? Track.Artist : $"{Track.Artist} · {Track.Album}";
    public string? LyricLine => string.IsNullOrEmpty(Track.LyricLine) ? null : $"“{Track.LyricLine}”";
    public bool HasLyricLine => !string.IsNullOrEmpty(Track.LyricLine);
    public string DurationText => Track.Duration is int d && d > 0 ? $"{d / 60}:{d % 60:00}" : "";
    public bool IsCurrent { get => _isCurrent; set { if (Set(ref _isCurrent, value)) Raise(nameof(TitleBrushKey)); } }
    public string TitleBrushKey => _isCurrent ? "accent" : "text";
    public bool Liked { get => _liked; set { if (Set(ref _liked, value)) Raise(nameof(LikeGlyph)); } }
    public string LikeGlyph => _liked ? "♥" : "♡";
    public bool Offline { get => _offline; set => Set(ref _offline, value); }

    public Bitmap? Art
    {
        get
        {
            if (!_requested && !string.IsNullOrEmpty(Track.Artwork)) { _requested = true; _ = LoadAsync(Track.Artwork!); }
            return _art;
        }
    }

    private async Task LoadAsync(string url)
    {
        try
        {
            lock (Cache) { if (Cache.TryGetValue(url, out var hit)) { _art = hit; Dispatcher.UIThread.Post(() => Raise(nameof(Art))); return; } }
            var bytes = await Http.GetByteArrayAsync(url).ConfigureAwait(false);
            using var ms = new MemoryStream(bytes);
            var bmp = Bitmap.DecodeToWidth(ms, 160);
            lock (Cache) Cache[url] = bmp;
            _art = bmp;
            Dispatcher.UIThread.Post(() => Raise(nameof(Art)));
        }
        catch { /* artwork is optional */ }
    }
}
