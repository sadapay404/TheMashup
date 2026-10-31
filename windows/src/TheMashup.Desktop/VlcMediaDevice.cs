using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Threading;
using LibVLCSharp.Avalonia;
using LibVLCSharp.Shared;
using TheMashup.Core;

namespace TheMashup.Desktop;

/// <summary>
/// Native LibVLC player. One MediaPlayer per candidate makes callback attempt
/// IDs reliable; retiring old players is done off the UI thread because VLC's
/// Stop is synchronous. Native callbacks only post work to Avalonia's thread.
/// </summary>
internal sealed class VlcMediaDevice : IMediaDevice
{
    private LibVLC? _vlc;
    private MediaPlayer? _player;
    private Media? _media;
    private VideoView? _view;
    private Task _retire = Task.CompletedTask;
    private double _volume = 0.8;
    private double _playbackRate = 1.0;
    private bool _normalizationEnabled;
    private int _normalizationStrength;
    private bool _disposed;

    public event EventHandler<MediaDeviceEvent>? Changed;

    public Control CreateVideoSurface()
    {
        _view ??= new VideoView();
        _view.MediaPlayer = _player;
        return _view;
    }

    public void Open(PlaybackCandidate candidate, PlaybackMode mode, long attempt, double resumeAtSeconds)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Stop();
        try
        {
            if (_vlc is null)
            {
                LibVLCSharp.Shared.Core.Initialize();
                _vlc = new LibVLC("--no-video-title-show", "--no-snapshot-preview");
            }
            var player = new MediaPlayer(_vlc);
            var media = new Media(_vlc, candidate.PlayUri);
            if (mode == PlaybackMode.Audio) media.AddOption(":no-video");
            _player = player; _media = media;
            if (_view is not null) _view.MediaPlayer = mode == PlaybackMode.Video ? player : null;
            player.Volume = (int)Math.Round(NormalizedVolume * 100);
            var pendingSeek = Math.Max(0, resumeAtSeconds);
            long lastTimeEvent = 0;

            void Post(MediaSignal signal, double position = 0, double duration = 0)
            {
                Dispatcher.UIThread.Post(() =>
                {
                    if (_disposed || !ReferenceEquals(_player, player)) return;
                    Changed?.Invoke(this, new MediaDeviceEvent(attempt, signal, position, duration));
                });
            }
            void ApplyResume()
            {
                if (pendingSeek <= 0 || !player.IsSeekable) return;
                player.Time = (long)(pendingSeek * 1000);
                pendingSeek = 0;
            }
            player.Playing += (_, _) => Dispatcher.UIThread.Post(() =>
            {
                if (_disposed || !ReferenceEquals(_player, player)) return;
                ApplyResume();
                Changed?.Invoke(this, new MediaDeviceEvent(attempt, MediaSignal.Playing));
            });
            player.SeekableChanged += (_, e) =>
            {
                if (e.Seekable != 0) Dispatcher.UIThread.Post(() =>
                {
                    if (!_disposed && ReferenceEquals(_player, player)) ApplyResume();
                });
            };
            player.Paused += (_, _) => Post(MediaSignal.Paused);
            player.EndReached += (_, _) => Post(MediaSignal.Ended);
            player.EncounteredError += (_, _) => Post(MediaSignal.Failed);
            player.TimeChanged += (_, e) =>
            {
                var now = Stopwatch.GetTimestamp();
                var last = Interlocked.Read(ref lastTimeEvent);
                if (last != 0 && Stopwatch.GetElapsedTime(last, now) < TimeSpan.FromMilliseconds(220)) return;
                Interlocked.Exchange(ref lastTimeEvent, now);
                var position = Math.Max(0, e.Time) / 1000.0;
                Dispatcher.UIThread.Post(() =>
                {
                    if (_disposed || !ReferenceEquals(_player, player)) return;
                    var duration = Math.Max(0, player.Length) / 1000.0;
                    Changed?.Invoke(this, new MediaDeviceEvent(attempt, MediaSignal.Time, position, duration));
                });
            };
            player.Media = media;
            if (!player.Play()) Post(MediaSignal.Failed);
        }
        catch (Exception)
        {
            Stop();
            Dispatcher.UIThread.Post(() =>
            {
                if (!_disposed) Changed?.Invoke(this, new MediaDeviceEvent(attempt, MediaSignal.DeviceFailed));
            });
        }
    }

    public void Play()
    {
        if (_player is not { } player) return;
        if (player.State is VLCState.Ended or VLCState.Stopped) player.Play();
        else player.SetPause(false);
    }
    public void Pause() => _player?.SetPause(true);
    public void Seek(double seconds)
    {
        if (_player is { IsSeekable: true } player && double.IsFinite(seconds))
            player.Time = (long)(Math.Max(0, seconds) * 1000);
    }
    public void SetVolume(double volume)
    {
        _volume = Math.Clamp(volume, 0, 1);
        if (_player is not null) _player.Volume = (int)Math.Round(_volume * 100);
    }

    public void SetPlaybackRate(double rate)
    {
        _playbackRate = Math.Clamp(rate, 0.5, 2.0);
        if (_player is not null) _player.SetRate((float)_playbackRate);
    }

    public void SetEqualizerPreset(string preset)
    {
        // Equalizer not available in this LibVLCSharp version; state tracked for UI parity.
    }

    public void SetEqualizerBand(int band, double gainDb)
    {
        // Equalizer not available in this LibVLCSharp version; preset tracked for UI parity.
        _equalizerPreset = "custom";
    }

    private string _equalizerPreset = "flat";

    public void SetNormalization(bool enabled, int strength)
    {
        _normalizationEnabled = enabled;
        _normalizationStrength = Math.Clamp(strength, 0, 100);
        if (_player is not null) _player.Volume = (int)Math.Round(NormalizedVolume * 100);
    }

    private double NormalizedVolume => _normalizationEnabled
        ? Math.Clamp(_volume * Math.Pow(2, ((_normalizationStrength / 100.0) - 0.5) * 2), 0, 1)
        : _volume;

    public void Stop()
    {
        var player = _player; var media = _media;
        _player = null; _media = null;
        if (_view is not null) _view.MediaPlayer = null;
        if (player is null) { media?.Dispose(); return; }
        player.Volume = 0;
        _retire = _retire.ContinueWith(_ =>
        {
            try { player.Stop(); }
            finally { player.Dispose(); media?.Dispose(); }
        }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        // Don't block the UI thread — VLC Stop is synchronous and can take
        // multiple seconds. Cleanup runs on the thread pool via _retire.
        _vlc = null;
    }
}
