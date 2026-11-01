using Avalonia.Threading;
using Core = LibVLCSharp.Shared.Core;
using FromType = LibVLCSharp.Shared.FromType;
using LibVLC = LibVLCSharp.Shared.LibVLC;
using Media = LibVLCSharp.Shared.Media;
using MediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace TheMashup.Services;

/// <summary>
/// LibVLC-backed player + queue. State machine: Idle, Loading, Playing, Paused, Error, Stopped.
/// Notes (LibVLCSharp limits): MediaPlayer.Rate is read-only and the equalizer API is not used, so speed / EQ / normalization
/// are tracked as state only. Crossfade is a volume fade-out/fade-in; gapless pre-resolves the next stream URL.
/// If the native libvlc is missing the service degrades to an Error state instead of crashing.
/// </summary>
public sealed class PlayerService : IDisposable
{
    private readonly SourceClient _sources;
    private readonly LibraryStore _library;
    private readonly Func<AppSettings> _settings;
    private LibVLC? _vlc;
    private MediaPlayer? _mp;
    private readonly DispatcherTimer _timer;
    private readonly Dictionary<string, Resolved> _cache = new();
    private readonly Random _rng = new();
    private int _loadToken;
    private int? _pendingNext;
    private int _lastVol = -1;
    private DispatcherTimer? _sleep;
    private string? _engineError;

    public List<Track> Queue { get; private set; } = new();
    public int Index { get; private set; }
    public int QueueVersion { get; private set; }
    public PState State { get; private set; } = PState.Idle;
    public long PositionMs { get; private set; }
    public long DurationMs { get; private set; }
    public string? Error { get; private set; }
    public string? Note { get; private set; }
    public DateTime? SleepEnd { get; private set; }
    public Track? Current => Index >= 0 && Index < Queue.Count ? Queue[Index] : null;
    public bool EngineAvailable => _mp != null;
    public event Action? Changed;

    public PlayerService(SourceClient sources, LibraryStore library, Func<AppSettings> settings)
    {
        _sources = sources; _library = library; _settings = settings;
        try
        {
            Core.Initialize();
            _vlc = new LibVLC("--no-video", "--quiet");
            _mp = new MediaPlayer(_vlc);
            _mp.EndReached += (_, _) => Dispatcher.UIThread.Post(OnEnded);
            _mp.EncounteredError += (_, _) => Dispatcher.UIThread.Post(() => Fail("This stream could not be played."));
            _mp.LengthChanged += (_, e) => DurationMs = e.Length;
        }
        catch (Exception ex)
        {
            Program.Log("libvlc init: " + ex);
            _mp = null;
            _engineError = "Audio engine (libvlc) could not be loaded. Reinstall TheMashup so the libvlc folder sits next to TheMashup.exe.";
        }
        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
    }

    private void Raise() => Changed?.Invoke();

    private void Fail(string msg)
    {
        State = PState.Error; Error = msg; Raise();
    }

    private void Tick()
    {
        if (_mp is null) return;
        try
        {
            if (State == PState.Playing || State == PState.Paused)
            {
                PositionMs = Math.Max(0, _mp.Time);
                if (_mp.Length > 0) DurationMs = _mp.Length;
            }
            ApplyVolume();
            Raise();
        }
        catch (Exception ex) { Program.Log("tick: " + ex.Message); }
    }

    /// <summary>Volume = user volume x normalization headroom x crossfade fade factor.</summary>
    public void ApplyVolume()
    {
        if (_mp is null) return;
        var s = _settings();
        double factor = 1;
        var cf = s.Crossfade * 1000L;
        if (cf > 0 && DurationMs > cf * 2 && State == PState.Playing)
        {
            var remaining = DurationMs - PositionMs;
            if (remaining < cf) factor = Math.Min(factor, Math.Clamp((double)remaining / cf, 0, 1));
            if (PositionMs < cf) factor = Math.Min(factor, Math.Clamp(0.1 + 0.9 * PositionMs / cf, 0, 1));
        }
        var norm = s.Normalize ? 1 - 0.3 * s.NormStrength / 100.0 : 1;
        var v = (int)Math.Round(Math.Clamp(s.Volume * norm * factor, 0, 100));
        if (v != _lastVol) { _lastVol = v; _mp.Volume = v; }
    }

    public void PlayQueue(IEnumerable<Track> tracks, int start = 0)
    {
        var list = tracks.ToList();
        if (list.Count == 0) return;
        Queue = list; QueueVersion++;
        Index = Math.Clamp(start, 0, list.Count - 1);
        _ = LoadAndPlay(Index);
    }

    public void JumpTo(int i) { if (i >= 0 && i < Queue.Count) _ = LoadAndPlay(i); }

    private async Task LoadAndPlay(int idx)
    {
        var t = Queue[idx];
        var my = ++_loadToken;
        Index = idx; QueueVersion++; _pendingNext = null; Error = null; Note = null; PositionMs = 0; DurationMs = (t.Duration ?? 0) * 1000L;
        State = PState.Loading; Raise();
        if (_mp is null) { Fail(_engineError ?? "Audio engine not available."); return; }
        try
        {
            string? local = _library.DownloadedPath(t.Id);
            Media media;
            if (local != null) { media = new Media(_vlc!, local, FromType.FromPath); Note = "Playing offline copy"; }
            else
            {
                if (!_cache.TryGetValue(t.Id, out var r))
                {
                    r = await _sources.ResolveAsync(t).ConfigureAwait(true) ?? throw new Exception("No playable source found for this track.");
                    _cache[t.Id] = r;
                }
                if (my != _loadToken) return;
                if (r.Kind == "preview") Note = "Full-length sources are unavailable — playing a 30s preview.";
                media = new Media(_vlc!, new Uri(r.Url));
            }
            if (my != _loadToken) { media.Dispose(); return; }
            _lastVol = -1;
            _mp.Play(media);
            media.Dispose();
            State = PState.Playing;
            _library.AddHistory(t);
            Raise();
            _ = Prefetch();
        }
        catch (Exception ex)
        {
            if (my == _loadToken) Fail(ex.Message);
        }
    }

    private int? ComputeNext(bool auto)
    {
        var s = _settings();
        if (Queue.Count == 0) return null;
        if (auto && s.Repeat == RepeatMode.One) return Index;
        if (s.Shuffle && Queue.Count > 1)
        {
            if (_pendingNext is int p && p != Index && p < Queue.Count) return p;
            int r; do r = _rng.Next(Queue.Count); while (r == Index);
            _pendingNext = r;
            return r;
        }
        if (Index + 1 < Queue.Count) return Index + 1;
        if (s.Repeat == RepeatMode.All) return 0;
        return null;
    }

    /// <summary>Gapless: resolve the next track's stream ahead of time so the switch is instant.</summary>
    private async Task Prefetch()
    {
        if (!_settings().Gapless) return;
        try
        {
            var n = ComputeNext(true);
            if (n is null || n == Index) return;
            var t = Queue[n.Value];
            if (_cache.ContainsKey(t.Id) || _library.DownloadedPath(t.Id) != null) return;
            var r = await _sources.ResolveAsync(t).ConfigureAwait(false);
            if (r != null) lock (_cache) _cache[t.Id] = r;
        }
        catch { /* best effort */ }
    }

    private void OnEnded()
    {
        var n = ComputeNext(true);
        if (n is null) { State = PState.Stopped; PositionMs = 0; Raise(); return; }
        _ = LoadAndPlay(n.Value);
    }

    public void Toggle()
    {
        if (_mp is null) return;
        switch (State)
        {
            case PState.Playing: _mp.SetPause(true); State = PState.Paused; break;
            case PState.Paused: _mp.SetPause(false); State = PState.Playing; break;
            case PState.Stopped: if (Queue.Count > 0) _ = LoadAndPlay(0); break;
            case PState.Error: if (Queue.Count > 0) _ = LoadAndPlay(Index); break;
        }
        Raise();
    }

    public void Next() { var n = ComputeNext(false); if (n is int i) _ = LoadAndPlay(i); }
    public void Prev()
    {
        if (PositionMs > 3000 || Index == 0) { SeekMs(0); return; }
        _ = LoadAndPlay(Index - 1);
    }

    public void SeekMs(long ms)
    {
        if (_mp is null || (State != PState.Playing && State != PState.Paused)) return;
        _mp.Time = Math.Max(0, ms);
        PositionMs = ms;
        Raise();
    }

    public void AddToQueue(Track t) { if (Queue.Count == 0) { PlayQueue(new[] { t }); return; } Queue.Add(t); QueueVersion++; _pendingNext = null; Raise(); }
    public void PlayNext(Track t) { if (Queue.Count == 0) { PlayQueue(new[] { t }); return; } Queue.Insert(Index + 1, t); QueueVersion++; _pendingNext = null; Raise(); }

    public void RemoveAt(int i)
    {
        if (i < 0 || i >= Queue.Count) return;
        QueueVersion++; _pendingNext = null;
        if (i < Index) { Queue.RemoveAt(i); Index--; }
        else if (i == Index)
        {
            Queue.RemoveAt(i);
            if (Queue.Count == 0) { _loadToken++; _mp?.Stop(); Index = 0; State = PState.Idle; }
            else { Index = Math.Min(i, Queue.Count - 1); _ = LoadAndPlay(Index); }
        }
        else Queue.RemoveAt(i);
        Raise();
    }

    public void Move(int i, int dir)
    {
        var j = i + dir;
        if (i < 0 || j < 0 || i >= Queue.Count || j >= Queue.Count) return;
        (Queue[i], Queue[j]) = (Queue[j], Queue[i]); QueueVersion++;
        if (Index == i) Index = j; else if (Index == j) Index = i;
        _pendingNext = null;
        Raise();
    }

    public void ClearQueue()
    {
        QueueVersion++;
        var cur = Current;
        if (cur != null && State is PState.Playing or PState.Paused or PState.Loading) { Queue = new List<Track> { cur }; Index = 0; }
        else { Queue = new(); Index = 0; State = PState.Idle; }
        Raise();
    }

    public void SetSleep(int minutes)
    {
        _sleep?.Stop(); _sleep = null; SleepEnd = null;
        if (minutes > 0)
        {
            SleepEnd = DateTime.Now.AddMinutes(minutes);
            _sleep = new DispatcherTimer { Interval = TimeSpan.FromMinutes(minutes) };
            _sleep.Tick += (_, _) =>
            {
                _sleep?.Stop(); _sleep = null; SleepEnd = null;
                if (State == PState.Playing) Toggle();
                Raise();
            };
            _sleep.Start();
        }
        Raise();
    }

    public void Dispose()
    {
        _timer.Stop();
        try { _mp?.Stop(); _mp?.Dispose(); _vlc?.Dispose(); } catch { /* ignore */ }
    }
}
