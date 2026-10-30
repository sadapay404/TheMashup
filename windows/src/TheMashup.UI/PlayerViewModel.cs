using System.ComponentModel;
using System.Windows.Input;
using TheMashup.Core;

namespace TheMashup.UI;

/// <summary>Thin shared presentation of the real platform player.</summary>
public sealed class PlayerViewModel : INotifyPropertyChanged, IDisposable
{
    public PlaybackController? Controller { get; }
    public PlayerViewModel(Library library, IPlaybackResolver? resolver, IMediaDevice? device)
    {
        if ((resolver is null) != (device is null)) throw new ArgumentException("Both playback components are required.");
        if (resolver is not null && device is not null)
        {
            Controller = new PlaybackController(library, resolver, device);
            Controller.PropertyChanged += ControllerChanged;
        }
        PlayPauseCommand = new ActionCommand(() => Controller?.TogglePlayPause());
        NextCommand = new ActionCommand(() => { if (Controller is not null) _ = Controller.NextAsync(); });
        PreviousCommand = new ActionCommand(() => { if (Controller is not null) _ = Controller.PreviousAsync(); });
        ShuffleCommand = new ActionCommand(() => Controller?.ToggleShuffle());
        RepeatCommand = new ActionCommand(() => Controller?.CycleRepeat());
        VideoCommand = new ActionCommand(() =>
        {
            if (Controller is not null) _ = Controller.SwitchModeAsync(Controller.Mode == PlaybackMode.Audio ? PlaybackMode.Video : PlaybackMode.Audio);
        });
    }
    public event PropertyChangedEventHandler? PropertyChanged;
    public ICommand PlayPauseCommand { get; }
    public ICommand NextCommand { get; }
    public ICommand PreviousCommand { get; }
    public ICommand ShuffleCommand { get; }
    public ICommand RepeatCommand { get; }
    public ICommand VideoCommand { get; }
    public bool IsAvailable => Controller is not null;
    public bool HasTrack => Controller?.HasTrack == true;
    public bool IsPlaying => Controller?.IsPlaying == true;
    public bool CanToggle => Controller?.CanToggle == true;
    public bool ShowVideo => HasTrack && Controller?.Mode == PlaybackMode.Video;
    public string Title => Controller?.Track?.Title ?? "";
    public string Artist => Controller?.Track?.Artist ?? "";
    public string Status => Controller?.Status ?? "Playback is unavailable in this build.";
    public string PlayPauseText => IsPlaying ? "Pause" : "Play";
    public string VideoText => Controller?.Mode == PlaybackMode.Video ? "Audio" : "Video";
    public string ShuffleText => Controller?.Shuffle == true ? "Shuffle on" : "Shuffle";
    public string RepeatText => Controller?.Repeat switch { RepeatMode.All => "Repeat all", RepeatMode.One => "Repeat one", _ => "Repeat" };
    public string TimeText => $"{FormatTime(Controller?.Position ?? 0)} / {FormatTime(Controller?.Duration ?? 0)}";
    public double DurationMaximum => Math.Max(1, Controller?.Duration ?? 0);
    public double SeekPosition
    {
        get => Controller?.Position ?? 0;
        set { if (Controller is not null && Math.Abs(value - Controller.Position) > 0.1) Controller.Seek(value); }
    }
    public double Volume
    {
        get => (Controller?.Volume ?? 0.8) * 100;
        set => Controller?.SetVolume(value / 100);
    }
    public Task PlayNowAsync(LibraryTrack track) => Controller?.PlayNowAsync(track) ?? Task.CompletedTask;
    public Task PlayQueueItemAsync(int index) => Controller?.PlayQueueItemAsync(index) ?? Task.CompletedTask;

    private void ControllerChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(PlaybackController.Track): Notify(nameof(Title), nameof(Artist), nameof(HasTrack), nameof(ShowVideo)); break;
            case nameof(PlaybackController.HasTrack): Notify(nameof(HasTrack), nameof(ShowVideo)); break;
            case nameof(PlaybackController.State): Notify(nameof(IsPlaying), nameof(CanToggle), nameof(PlayPauseText), nameof(Status)); break;
            case nameof(PlaybackController.Status): Notify(nameof(Status)); break;
            case nameof(PlaybackController.Position): Notify(nameof(SeekPosition), nameof(TimeText)); break;
            case nameof(PlaybackController.Duration): Notify(nameof(DurationMaximum), nameof(TimeText)); break;
            case nameof(PlaybackController.Mode): Notify(nameof(ShowVideo), nameof(VideoText)); break;
            case nameof(PlaybackController.Volume): Notify(nameof(Volume)); break;
            case nameof(PlaybackController.Shuffle): Notify(nameof(ShuffleText)); break;
            case nameof(PlaybackController.Repeat): Notify(nameof(RepeatText)); break;
        }
    }
    private static string FormatTime(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds < 0) return "0:00";
        var time = TimeSpan.FromSeconds(Math.Min(seconds, 24 * 60 * 60 - 1));
        return time.TotalHours >= 1 ? $"{(int)time.TotalHours}:{time.Minutes:00}:{time.Seconds:00}" : $"{time.Minutes}:{time.Seconds:00}";
    }
    private void Notify(params string[] names) { foreach (var name in names) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name)); }
    public void Dispose()
    {
        if (Controller is null) return;
        Controller.PropertyChanged -= ControllerChanged;
        Controller.Dispose();
    }
}
