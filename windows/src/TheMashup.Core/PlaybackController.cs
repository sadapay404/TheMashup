using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace TheMashup.Core;

/// <summary>
/// One queue and one player. UI-thread-owned; platform callbacks must arrive on
/// that thread. Only explicit queue actions insert songs, and history is written
/// once a media device reports actual playback. Old async replies/events carry
/// generations and cannot replace a newer selection.
/// </summary>
public sealed class PlaybackController : INotifyPropertyChanged, IDisposable
{
    private readonly Library _library;
    private readonly IPlaybackResolver _resolver;
    private readonly IMediaDevice _device;
    private readonly Random _random;
    private readonly SynchronizationContext? _uiContext;
    private CancellationTokenSource? _request, _watchdog;
    private long _selection, _attempt, _failureAttempt = -1;
    private IReadOnlyList<PlaybackCandidate> _candidates = [];
    private int _candidateIndex;
    private string _source = "", _status = "", _notice = "";
    private LibraryTrack? _track;
    private PlaybackMode _mode;
    private PlaybackState _state = PlaybackState.Idle;
    private RepeatMode _repeat;
    private bool _shuffle, _recorded, _disposed, _mutatingQueue;
    private double _position, _duration, _volume = 0.8;
    private DateTimeOffset _openedAt, _lastProgressAt;
    private readonly HashSet<int> _failedIndices = [];
    private readonly HashSet<int> _shuffledIndices = [];
    private long _failedVersion = -1, _shuffleVersion = -1;

    /* ── Sleep timer ── */
    private Timer? _sleepTimer;
    private DateTimeOffset _sleepTimerEnd;

    /* ── Crossfade / gapless ── */
    private bool _crossfadeEnabled;
    private double _crossfadeDurationSec = 3.0;
    private bool _gaplessEnabled;

    public bool CrossfadeEnabled => _crossfadeEnabled;
    public double CrossfadeDurationSec => _crossfadeDurationSec;
    public bool GaplessEnabled => _gaplessEnabled;

    /* ── Playback rate ── */
    private double _playbackRate = 1.0;
    public double PlaybackRate => _playbackRate;

    /* ── Equalizer ── */
    private bool _equalizerEnabled;
    private string _equalizerPreset = "flat";
    public bool EqualizerEnabled => _equalizerEnabled;
    public string EqualizerPreset => _equalizerPreset;

    /* ── Loudness normalization ── */
    private bool _normalizationEnabled;
    private int _normalizationStrength = 100;
    public bool NormalizationEnabled => _normalizationEnabled;
    public int NormalizationStrength => _normalizationStrength;

    public PlaybackController(Library library, IPlaybackResolver resolver, IMediaDevice device, Random? random = null)
    {
        _library = library ?? throw new ArgumentNullException(nameof(library));
        _resolver = resolver ?? throw new ArgumentNullException(nameof(resolver));
        _device = device ?? throw new ArgumentNullException(nameof(device));
        _random = random ?? new Random();
        // Capture the UI context so cross-thread callbacks (sleep timer, watchdog)
        // can marshal property changes back to the UI thread.
        _uiContext = SynchronizationContext.Current;
        _device.Changed += OnDeviceChanged;
        _library.Changed += OnLibraryChanged;
        _device.SetVolume(_volume);
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public LibraryTrack? Track => _track;
    public PlaybackState State => _state;
    public PlaybackMode Mode => _mode;
    public RepeatMode Repeat => _repeat;
    public bool Shuffle => _shuffle;
    public bool HasTrack => _track is not null;
    public double Position => _position;
    public double Duration => _duration;
    public double Volume => _volume;
    public string Source => _source;
    public string Status => _status;
    public bool IsPlaying => _state == PlaybackState.Playing;
    public bool CanToggle => HasTrack && _state is not (PlaybackState.Resolving or PlaybackState.Buffering);

    /// <summary>Play exactly this selection; never queue surrounding search results.</summary>
    public Task PlayNowAsync(LibraryTrack track, PlaybackMode mode = PlaybackMode.Audio)
    {
        ArgumentNullException.ThrowIfNull(track);
        if (_disposed) return Task.CompletedTask;
        BeginSelection(track, mode, resetHistory: true);
        _mutatingQueue = true;
        bool inserted;
        try { inserted = _library.PlayNow(track); }
        finally { _mutatingQueue = false; }
        if (!inserted) { SetError("This song cannot be played."); return Task.CompletedTask; }
        // PlayNow may reuse an equal existing entry instead of inserting the
        // newly supplied record; track the canonical queue instance.
        _track = _library.CurrentTrack;
        Notify(nameof(Track));
        ResetTraversal();
        return ResolveAsync("", _selection);
    }

    /// <summary>Play a queue item in place; this does not insert a duplicate.</summary>
    public Task PlayQueueItemAsync(int index)
    {
        if (_disposed || index < 0 || index >= _library.Queue.Count) return Task.CompletedTask;
        var track = _library.Queue[index];
        BeginSelection(track, PlaybackMode.Audio, resetHistory: true);
        _mutatingQueue = true;
        try { _library.SetCurrentQueueIndex(index); }
        finally { _mutatingQueue = false; }
        ResetTraversal();
        return ResolveAsync("", _selection);
    }

    /// <summary>Switch audio/video on the current song, preserving position and history.</summary>
    public Task SwitchModeAsync(PlaybackMode mode)
    {
        if (_disposed || _track is null || _mode == mode) return Task.CompletedTask;
        var track = _track;
        var resume = _position;
        BeginSelection(track, mode, resetHistory: false);
        _position = resume;
        Notify(nameof(Position));
        return ResolveAsync("", _selection);
    }

    public Task NextAsync() => AdvanceAsync(forFailure: false, previous: false);
    public Task PreviousAsync() => AdvanceAsync(forFailure: false, previous: true);

    public void TogglePlayPause()
    {
        if (_disposed || _track is null) return;
        switch (_state)
        {
            case PlaybackState.Playing:
                _device.Pause();
                break;
            case PlaybackState.Paused:
                _device.Play();
                break;
            case PlaybackState.Ended:
                _recorded = false;
                _position = 0;
                _device.Seek(0);
                _device.Play();
                _openedAt = _lastProgressAt = DateTimeOffset.UtcNow;
                StartWatchdog(_attempt);
                break;
            case PlaybackState.Error:
                _ = RetryAsync();
                break;
        }
    }

    public void Seek(double seconds)
    {
        if (_disposed || _track is null || !double.IsFinite(seconds) || _duration <= 0 ||
            _state is PlaybackState.Idle or PlaybackState.Resolving or PlaybackState.Error) return;
        _position = Math.Clamp(seconds, 0, _duration);
        _lastProgressAt = DateTimeOffset.UtcNow;
        _device.Seek(_position);
        Notify(nameof(Position));
    }

    public void SetVolume(double volume)
    {
        if (_disposed || !double.IsFinite(volume)) return;
        _volume = Math.Clamp(volume, 0, 1);
        _device.SetVolume(_volume);
        Notify(nameof(Volume));
    }

    public void ToggleShuffle()
    {
        _shuffle = !_shuffle;
        _shuffledIndices.Clear();
        _shuffleVersion = _library.QueueVersion;
        if (_library.CurrentQueueIndex >= 0) _shuffledIndices.Add(_library.CurrentQueueIndex);
        Notify(nameof(Shuffle));
    }

    public void CycleRepeat()
    {
        _repeat = _repeat switch { RepeatMode.Off => RepeatMode.All, RepeatMode.All => RepeatMode.One, _ => RepeatMode.Off };
        Notify(nameof(Repeat));
    }

    /* ── Sleep timer ── */

    private void OnUiThread(Action action)
    {
        if (_uiContext is not null) _uiContext.Post(_ => action(), null);
        else action();
    }

    public void SetSleepTimer(int minutes)
    {
        CancelSleepTimer();
        if (minutes <= 0) return;
        _sleepTimerEnd = DateTimeOffset.UtcNow.AddMinutes(minutes);
        _sleepTimer = new Timer(_ =>
        {
            try
            {
                if (DateTimeOffset.UtcNow >= _sleepTimerEnd)
                {
                    CancelSleepTimer();
                    OnUiThread(() =>
                    {
                        if (_track is not null)
                        {
                            _device.Pause();
                            SetState(PlaybackState.Paused, "Sleep timer");
                        }
                    });
                }
            }
            catch { /* best-effort; never throw from a timer callback */ }
        }, null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }

    public void CancelSleepTimer()
    {
        _sleepTimer?.Dispose();
        _sleepTimer = null;
    }

    /* ── Crossfade / gapless ── */

    public void SetCrossfade(bool enabled, double durationSec = 3.0)
    {
        _crossfadeEnabled = enabled;
        _crossfadeDurationSec = Math.Max(0.5, durationSec);
        Notify(nameof(CrossfadeEnabled), nameof(CrossfadeDurationSec));
    }

    public void SetGapless(bool enabled)
    {
        _gaplessEnabled = enabled;
        Notify(nameof(GaplessEnabled));
    }

    /* ── Playback rate / equalizer / normalization ── */

    public void SetPlaybackRate(double rate)
    {
        _playbackRate = Math.Clamp(rate, 0.5, 2.0);
        _device.SetPlaybackRate(_playbackRate);
        Notify(nameof(PlaybackRate));
    }

    public void SetEqualizer(bool enabled, string preset)
    {
        _equalizerEnabled = enabled;
        _equalizerPreset = preset;
        _device.SetEqualizerPreset(preset);
        Notify(nameof(EqualizerEnabled), nameof(EqualizerPreset));
    }

    public void SetEqualizerBand(int band, double gainDb)
    {
        _equalizerPreset = "custom";
        _device.SetEqualizerBand(band, gainDb);
        Notify(nameof(EqualizerPreset));
    }

    public void SetNormalization(bool enabled, int strength)
    {
        _normalizationEnabled = enabled;
        _normalizationStrength = Math.Clamp(strength, 0, 100);
        _device.SetNormalization(_normalizationEnabled, _normalizationStrength);
        Notify(nameof(NormalizationEnabled), nameof(NormalizationStrength));
    }

    /* ── Phase 4: sharing ── */

    public void ShareTrack(string title, string artist, string externalId)
    {
        // Desktop share is handled by the UI layer (Avalonia clipboard or
        // native interop). This is a placeholder the view can call; the
        // concrete share action lives in the platform shell.
    }

    /* ── Phase 4: recently added / smart playlists ── */

    private readonly List<LibraryTrack> _recentlyAdded = [];
    public IReadOnlyList<LibraryTrack> RecentlyAdded => _recentlyAdded;

    public void AddToRecentlyAdded(LibraryTrack track)
    {
        _recentlyAdded.RemoveAll(t => t.Id == track.Id);
        _recentlyAdded.Insert(0, track);
        if (_recentlyAdded.Count > 50) _recentlyAdded.RemoveRange(50, _recentlyAdded.Count - 50);
        Notify(nameof(RecentlyAdded));
    }

    public void ClearRecentlyAdded()
    {
        _recentlyAdded.Clear();
        Notify(nameof(RecentlyAdded));
    }

    /* ── Phase 4: local file playback ── */

    public async Task PlayLocalFile(string filePath, string displayName)
    {
        if (_disposed || string.IsNullOrEmpty(filePath)) return;
        try
        {
            // Stable, process-independent id (SHA256 of the path).
            var id = $"local:{Sha256(filePath)}";
            var track = new LibraryTrack("local", id, displayName, "Local File");
            AddToRecentlyAdded(track);
            await PlayNowAsync(track);
        }
        catch { /* best effort; local file playback handled by device layer */ }
    }

    private static string Sha256(string input)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private Task RetryAsync()
    {
        if (_track is null) return Task.CompletedTask;
        var track = _track;
        BeginSelection(track, _mode, resetHistory: true);
        ResetTraversal();
        return ResolveAsync("", _selection);
    }

    private void BeginSelection(LibraryTrack track, PlaybackMode mode, bool resetHistory)
    {
        CancelPending();
        _selection++;
        _attempt++; // invalidate callbacks before stopping the old device
        _device.Stop();
        _track = track;
        _mode = mode;
        _source = _notice = "";
        _position = 0;
        _duration = track.DurationSeconds is > 0 ? track.DurationSeconds.Value : 0;
        if (resetHistory) _recorded = false;
        _candidates = [];
        _candidateIndex = 0;
        SetState(PlaybackState.Resolving, "Finding a playable source…");
        Notify(nameof(Track), nameof(Mode), nameof(HasTrack), nameof(Position), nameof(Duration), nameof(Source));
    }

    private async Task ResolveAsync(string after, long selection)
    {
        if (_track is null || selection != _selection || _disposed) return;

        // ── Local files bypass the HTTP gateway entirely ──
        if (_track.Id.StartsWith("local:", StringComparison.Ordinal))
        {
            var path = _track.Id["local:".Length..];
            _source = "local";
            _candidates = [new PlaybackCandidate(new Uri(path), "local", _mode == PlaybackMode.Video, "local")];
            _candidateIndex = 0;
            Notify(nameof(Source));
            OpenCandidate();
            return;
        }

        var cts = _request ??= new CancellationTokenSource();
        try
        {
            // refresh: true only when explicitly requested (after a failure).
            // Defaults to false so server-side stream caches are honored.
            var result = await _resolver.ResolveAsync(_track.Id, _mode, after, false, cts.Token);
            if (selection != _selection || cts.IsCancellationRequested || _disposed) return;
            var afterRank = Rank(after);
            var valid = result.Candidates.Where(item => Rank(item.Source) > afterRank &&
                (_mode != PlaybackMode.Video || item.HasVideo)).ToArray();
            if (valid.Length == 0) { await ExhaustedAsync(selection); return; }
            // Resolver batches contain one source; enforce the boundary so a
            // malformed response cannot accidentally repeat or skip priorities.
            _source = valid[0].Source;
            _candidates = valid.Where(item => item.Source == _source).Take(8).ToArray();
            _candidateIndex = 0;
            Notify(nameof(Source));
            OpenCandidate();
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception)
        {
            if (selection != _selection || _disposed) return;
            await ExhaustedAsync(selection);
        }
    }

    private void OpenCandidate()
    {
        if (_disposed || _track is null || _candidateIndex >= _candidates.Count) return;
        _attempt++;
        _failureAttempt = -1;
        _openedAt = _lastProgressAt = DateTimeOffset.UtcNow;
        SetState(PlaybackState.Buffering, _source == "ytdlp" ? "Connecting…" : "Trying a fallback source…");
        try
        {
            _device.Open(_candidates[_candidateIndex], _mode, _attempt, _position);
            StartWatchdog(_attempt);
        }
        catch (Exception)
        {
            SetError("The media engine could not start on this device.");
        }
    }

    private async Task FailAttemptAsync(long attempt)
    {
        if (_disposed || attempt != _attempt || _failureAttempt == attempt) return;
        _failureAttempt = attempt;
        var selection = _selection;
        _attempt++; // reject late callbacks from the failed candidate
        CancelWatchdog();
        _device.Stop();
        if (++_candidateIndex < _candidates.Count) { OpenCandidate(); return; }
        if (Rank(_source) < Rank("invidious"))
        {
            SetState(PlaybackState.Resolving, "Trying the next source…");
            await ResolveAsync(_source, selection);
        }
        else await ExhaustedAsync(selection);
    }

    private async Task ExhaustedAsync(long selection)
    {
        if (_disposed || selection != _selection || _track is null) return;
        if (_mode == PlaybackMode.Video)
        {
            _mode = PlaybackMode.Audio;
            _notice = "Video is unavailable for this song; playing audio instead.";
            Notify(nameof(Mode));
            SetState(PlaybackState.Resolving, "Video unavailable; trying audio…");
            await ResolveAsync("", selection);
            return;
        }
        if (_failedVersion != _library.QueueVersion) { _failedIndices.Clear(); _failedVersion = _library.QueueVersion; }
        if (_library.CurrentQueueIndex >= 0) _failedIndices.Add(_library.CurrentQueueIndex);
        if (!await AdvanceAsync(forFailure: true, previous: false))
            SetError("Could not play this song or the remaining queued songs. Try again.");
    }

    private async Task<bool> AdvanceAsync(bool forFailure, bool previous)
    {
        if (_disposed || _library.Queue.Count == 0) return false;
        var next = FindNextIndex(forFailure, previous);
        if (next < 0) return false;
        var track = _library.Queue[next];
        // Automatic queue advancement keeps the selected mode. Manual queue
        // selection defaults to audio; neither creates additional queue entries.
        var mode = _mode;
        BeginSelection(track, mode, resetHistory: true);
        _mutatingQueue = true;
        try { _library.SetCurrentQueueIndex(next); }
        finally { _mutatingQueue = false; }
        if (!forFailure) { _failedIndices.Clear(); _failedVersion = _library.QueueVersion; }
        if (_shuffle && !previous) _shuffledIndices.Add(next);
        await ResolveAsync("", _selection);
        return true;
    }

    private int FindNextIndex(bool forFailure, bool previous)
    {
        var count = _library.Queue.Count;
        var current = _library.CurrentQueueIndex;
        if (count == 0) return -1;
        if (previous)
        {
            var prev = current > 0 ? current - 1 : (_repeat == RepeatMode.All ? count - 1 : -1);
            return prev;
        }
        if (_shuffle && !forFailure)
        {
            if (_shuffleVersion != _library.QueueVersion)
            {
                _shuffledIndices.Clear(); _shuffleVersion = _library.QueueVersion;
                if (current >= 0) _shuffledIndices.Add(current);
            }
            var choices = Enumerable.Range(0, count).Where(i => !_shuffledIndices.Contains(i)).ToArray();
            if (choices.Length == 0 && _repeat == RepeatMode.All)
            {
                _shuffledIndices.Clear();
                choices = Enumerable.Range(0, count).Where(i => count == 1 || i != current).ToArray();
            }
            return choices.Length == 0 ? -1 : choices[_random.Next(choices.Length)];
        }
        var allowWrap = _repeat == RepeatMode.All;
        for (var step = 1; step <= count; step++)
        {
            var index = current + step;
            if (index >= count)
            {
                if (!allowWrap) break;
                index %= count;
            }
            if (index >= 0 && (!forFailure || !_failedIndices.Contains(index))) return index;
        }
        return -1;
    }

    private void OnDeviceChanged(object? sender, MediaDeviceEvent e)
    {
        if (_disposed || e.Attempt != _attempt || _track is null) return;
        switch (e.Signal)
        {
            case MediaSignal.Playing:
                _lastProgressAt = DateTimeOffset.UtcNow;
                SetState(PlaybackState.Playing, !string.IsNullOrEmpty(_notice) ? _notice :
                    _source == "ytdlp" ? "Playing" : "Playing · fallback source");
                if (!_recorded)
                {
                    _recorded = true;
                    _library.RecordPlay(_track, DateTimeOffset.UtcNow);
                }
                _failedIndices.Clear();
                _failedVersion = _library.QueueVersion;
                break;
            case MediaSignal.Paused:
            case MediaSignal.Blocked:
                SetState(PlaybackState.Paused, e.Signal == MediaSignal.Blocked ? "Press Play to enable browser audio." : "Paused");
                break;
            case MediaSignal.Time:
                if (double.IsFinite(e.Duration) && e.Duration > 0) _duration = e.Duration;
                if (double.IsFinite(e.Position) && e.Position >= 0)
                {
                    if (Math.Abs(e.Position - _position) >= 0.1) _lastProgressAt = DateTimeOffset.UtcNow;
                    _position = _duration > 0 ? Math.Min(e.Position, _duration) : e.Position;
                }
                Notify(nameof(Position), nameof(Duration));
                break;
            case MediaSignal.Failed:
                _ = FailAttemptAsync(e.Attempt);
                break;
            case MediaSignal.DeviceFailed:
                SetError("The media engine is unavailable on this device.");
                break;
            case MediaSignal.Ended:
                CancelWatchdog();
                SetState(PlaybackState.Ended, "Finished");
                if (_repeat == RepeatMode.One)
                {
                    _recorded = false;
                    _position = 0;
                    _device.Seek(0);
                    _device.Play();
                    _openedAt = _lastProgressAt = DateTimeOffset.UtcNow;
                    StartWatchdog(_attempt);
                }
                else _ = AdvanceAsync(forFailure: false, previous: false);
                break;
        }
    }

    /// <summary>Exposed for deterministic health checks; normal operation schedules it automatically.</summary>
    public Task CheckHealthAsync(DateTimeOffset now)
    {
        if (_disposed) return Task.CompletedTask;
        if ((_state == PlaybackState.Buffering && now - _openedAt > TimeSpan.FromSeconds(20)) ||
            (_state == PlaybackState.Playing && now - _lastProgressAt > TimeSpan.FromSeconds(30)))
            return FailAttemptAsync(_attempt);
        return Task.CompletedTask;
    }

    private void StartWatchdog(long attempt)
    {
        CancelWatchdog();
        var cts = new CancellationTokenSource();
        _watchdog = cts;
        _ = WatchAsync(attempt, cts);
    }

    private async Task WatchAsync(long attempt, CancellationTokenSource cts)
    {
        try
        {
            while (!cts.IsCancellationRequested && attempt == _attempt && !_disposed)
            {
                await Task.Delay(TimeSpan.FromSeconds(5), cts.Token);
                if (attempt == _attempt) await CheckHealthAsync(DateTimeOffset.UtcNow);
            }
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        finally { cts.Dispose(); }
    }

    private void OnLibraryChanged(object? sender, EventArgs e)
    {
        if (_disposed || _mutatingQueue || _track is null) return;
        if (_library.CurrentTrack is null || !ReferenceEquals(_library.CurrentTrack, _track))
        {
            CancelPending(); _selection++; _attempt++; _device.Stop();
            _track = null; _position = _duration = 0;
            SetState(PlaybackState.Idle, "");
            Notify(nameof(Track), nameof(HasTrack), nameof(Position), nameof(Duration));
        }
    }

    private void ResetTraversal()
    {
        _failedIndices.Clear(); _failedVersion = _library.QueueVersion;
        _shuffledIndices.Clear(); _shuffleVersion = _library.QueueVersion;
        if (_library.CurrentQueueIndex >= 0) _shuffledIndices.Add(_library.CurrentQueueIndex);
    }

    private void SetError(string message)
    {
        CancelWatchdog();
        SetState(PlaybackState.Error, message);
    }
    private void SetState(PlaybackState state, string status)
    {
        _state = state; _status = status;
        Notify(nameof(State), nameof(Status), nameof(IsPlaying), nameof(CanToggle));
    }
    private static int Rank(string source) => source switch { "ytdlp" => 0, "piped" => 1, "invidious" => 2, _ => -1 };
    private void CancelWatchdog() { _watchdog?.Cancel(); _watchdog = null; }
    private void CancelPending() { _request?.Cancel(); _request?.Dispose(); _request = null; CancelWatchdog(); }
    private void Notify(params string[] names) { foreach (var name in names) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name)); }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        CancelSleepTimer();
        CancelPending();
        _library.Changed -= OnLibraryChanged;
        _device.Changed -= OnDeviceChanged;
        _device.Stop();
        _device.Dispose();
    }
}
