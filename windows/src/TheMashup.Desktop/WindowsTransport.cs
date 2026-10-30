using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.Versioning;
using Avalonia.Controls;
using Avalonia.Threading;
using TheMashup.Core;
using Windows.Media;

namespace TheMashup.Desktop;

/// <summary>Connects the native player to the Windows media flyout and media keys.</summary>
[SupportedOSPlatform("windows10.0.17763.0")]
internal sealed class WindowsTransport : IDisposable
{
    private readonly PlaybackController _player;
    private readonly SystemMediaTransportControls _controls;
    private bool _disposed;
    private long _lastTimeline;
    private double _lastPosition = -1, _lastDuration = -1;

    public static IDisposable? TryAttach(Window window, PlaybackController player)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)) return null;
        var handle = window.TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
        if (handle == IntPtr.Zero) return null;
        try { return new WindowsTransport(handle, player); }
        catch (Exception ex) { Trace.WriteLine($"Windows media controls unavailable: {ex.GetType().Name}"); return null; }
    }

    private WindowsTransport(IntPtr handle, PlaybackController player)
    {
        _player = player;
        _controls = SystemMediaTransportControlsInterop.GetForWindow(handle);
        _controls.IsPlayEnabled = true;
        _controls.IsPauseEnabled = true;
        _controls.IsNextEnabled = true;
        _controls.IsPreviousEnabled = true;
        _controls.ButtonPressed += OnButtonPressed;
        _controls.PlaybackPositionChangeRequested += OnSeekRequested;
        _player.PropertyChanged += OnPlayerChanged;
        UpdateMetadata();
        UpdateState();
    }

    private void OnButtonPressed(SystemMediaTransportControls sender, SystemMediaTransportControlsButtonPressedEventArgs args)
    {
        var button = args.Button;
        Dispatcher.UIThread.Post(() =>
        {
            if (_disposed) return;
            switch (button)
            {
                case SystemMediaTransportControlsButton.Play:
                    if (!_player.IsPlaying && _player.CanToggle) _player.TogglePlayPause();
                    break;
                case SystemMediaTransportControlsButton.Pause:
                case SystemMediaTransportControlsButton.Stop:
                    if (_player.IsPlaying) _player.TogglePlayPause();
                    break;
                case SystemMediaTransportControlsButton.Next: _ = _player.NextAsync(); break;
                case SystemMediaTransportControlsButton.Previous: _ = _player.PreviousAsync(); break;
            }
        });
    }

    private void OnSeekRequested(SystemMediaTransportControls sender, PlaybackPositionChangeRequestedEventArgs args)
    {
        var seconds = args.RequestedPlaybackPosition.TotalSeconds;
        Dispatcher.UIThread.Post(() => { if (!_disposed) _player.Seek(seconds); });
    }

    private void OnPlayerChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_disposed) return;
        try
        {
            switch (e.PropertyName)
            {
                case nameof(PlaybackController.Track):
                case nameof(PlaybackController.Mode): UpdateMetadata(); break;
                case nameof(PlaybackController.State): UpdateState(); break;
                case nameof(PlaybackController.Position):
                case nameof(PlaybackController.Duration): UpdateTimeline(); break;
            }
        }
        catch (Exception ex) { Trace.WriteLine($"Windows media update failed: {ex.GetType().Name}"); }
    }

    private void UpdateMetadata()
    {
        var display = _controls.DisplayUpdater;
        display.ClearAll();
        if (_player.Track is { } track)
        {
            display.Type = _player.Mode == PlaybackMode.Video ? MediaPlaybackType.Video : MediaPlaybackType.Music;
            if (_player.Mode == PlaybackMode.Video)
            {
                display.VideoProperties.Title = track.Title;
                display.VideoProperties.Subtitle = track.Artist;
            }
            else
            {
                display.MusicProperties.Title = track.Title;
                display.MusicProperties.Artist = track.Artist;
            }
        }
        display.Update();
    }

    private void UpdateState()
    {
        _controls.IsEnabled = _player.HasTrack;
        _controls.PlaybackStatus = _player.State switch
        {
            PlaybackState.Playing => MediaPlaybackStatus.Playing,
            PlaybackState.Paused => MediaPlaybackStatus.Paused,
            PlaybackState.Idle => MediaPlaybackStatus.Closed,
            _ => MediaPlaybackStatus.Stopped,
        };
        _lastTimeline = 0;
        UpdateTimeline();
    }

    private void UpdateTimeline()
    {
        var duration = _player.Duration;
        if (duration <= 0 || !double.IsFinite(duration)) return;
        var position = Math.Clamp(_player.Position, 0, duration);
        var now = Environment.TickCount64;
        if (_lastTimeline != 0 && now - _lastTimeline < 5000 &&
            Math.Abs(duration - _lastDuration) < 0.1 && Math.Abs(position - _lastPosition) < 2) return;
        _lastTimeline = now; _lastPosition = position; _lastDuration = duration;
        var end = TimeSpan.FromSeconds(duration);
        _controls.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties
        {
            StartTime = TimeSpan.Zero, EndTime = end, MinSeekTime = TimeSpan.Zero, MaxSeekTime = end,
            Position = TimeSpan.FromSeconds(position),
        });
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _player.PropertyChanged -= OnPlayerChanged;
        _controls.ButtonPressed -= OnButtonPressed;
        _controls.PlaybackPositionChangeRequested -= OnSeekRequested;
        try
        {
            _controls.DisplayUpdater.ClearAll(); _controls.DisplayUpdater.Update();
            _controls.PlaybackStatus = MediaPlaybackStatus.Closed; _controls.IsEnabled = false;
        }
        catch (Exception) { }
    }
}
