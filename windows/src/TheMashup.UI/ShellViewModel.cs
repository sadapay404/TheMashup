using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using Avalonia;
using Avalonia.Controls;
using TheMashup.Core;

namespace TheMashup.UI;

public sealed class ShellViewModel : INotifyPropertyChanged
{
    private readonly ThemeSelection _themes;
    private string _page = "home";
    private bool _compact;
    private bool _showRightRail = true;

    public ShellViewModel(ThemeSelection themes)
    {
        _themes = themes;
        NavigateCommand = new ParameterCommand(Navigate);
        SelectThemeCommand = new ParameterCommand(id => _themes.Select(id));
        _themes.Changed += (_, _) =>
        {
            Notify(nameof(CurrentThemeName), nameof(ThemeStatus), nameof(IsFrosted),
                nameof(IsPaper), nameof(IsNeon), nameof(IsAurora), nameof(IsVinyl));
        };
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public ICommand NavigateCommand { get; }
    public ICommand SelectThemeCommand { get; }
    public bool IsHome => _page == "home";
    public bool IsSearch => _page == "search";
    public bool IsLibrary => _page == "library";
    public bool IsDownloads => _page == "downloads";
    public bool IsSettings => _page == "settings";
    public bool IsFeaturePage => IsSearch || IsLibrary || IsDownloads;
    public bool ShowNavLabels => !_compact;
    public bool ShowRightRail => _showRightRail;
    public GridLength SidebarWidth => new(_compact ? 76 : 224);
    public string CurrentThemeName => _themes.Current.Name;
    public bool IsFrosted => _themes.Current.Id == "frosted";
    public bool IsPaper => _themes.Current.Id == "paper-ink";
    public bool IsNeon => _themes.Current.Id == "neon";
    public bool IsAurora => _themes.Current.Id == "aurora";
    public bool IsVinyl => _themes.Current.Id == "vinyl";
    public string ThemeStatus => _themes.LastWriteSucceeded
        ? "Your choice is stored on this device."
        : "Couldn’t save your choice. It may reset when you reopen the app.";
    public string PageTitle => _page switch
    {
        "search" => "Search", "library" => "Your library", "downloads" => "Downloads",
        "settings" => "Appearance", _ => "Home"
    };
    public string FeatureEyebrow => _page switch
    {
        "search" => "DISCOVER", "library" => "YOUR COLLECTION", _ => "OFFLINE LISTENING"
    };
    public string FeatureTitle => _page switch
    {
        "search" => "Find your next favorite.",
        "library" => "A space for your collection.",
        _ => "Take your music with you."
    };
    public string FeatureDescription => _page switch
    {
        "search" => "Search by song, artist, album, or lyrics is planned for phase 3. Search is not connected in this preview yet.",
        "library" => "Likes, playlists, and listening history arrive in phase 2. Nothing has been imported or synced in this preview.",
        _ => "Audio and video downloads, resumability, and offline playback arrive in phase 6. Downloads are not available yet."
    };
    public string FeatureFootnote => _page switch
    {
        "search" => "PHASE 03  ·  SEARCH & DISCOVERY",
        "library" => "PHASE 02  ·  LOCAL LIBRARY",
        _ => "PHASE 06  ·  DOWNLOADS"
    };

    public void UpdateWidth(double width)
    {
        var compact = width < 850;
        var showRail = width >= 1180;
        if (compact != _compact)
        {
            _compact = compact;
            Notify(nameof(ShowNavLabels), nameof(SidebarWidth));
        }
        if (showRail != _showRightRail)
        {
            _showRightRail = showRail;
            Notify(nameof(ShowRightRail));
        }
    }

    private void Navigate(string? page)
    {
        if (page is not ("home" or "search" or "library" or "downloads" or "settings")) return;
        _page = page;
        Notify(nameof(IsHome), nameof(IsSearch), nameof(IsLibrary), nameof(IsDownloads),
            nameof(IsSettings), nameof(IsFeaturePage), nameof(PageTitle), nameof(FeatureEyebrow),
            nameof(FeatureTitle), nameof(FeatureDescription), nameof(FeatureFootnote));
    }

    private void Notify(params string[] properties)
    {
        foreach (var property in properties)
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(property));
    }

    private sealed class ParameterCommand(Action<string?> action) : ICommand
    {
        public event EventHandler? CanExecuteChanged { add { } remove { } }
        public bool CanExecute(object? parameter) => true;
        public void Execute(object? parameter) => action(parameter as string);
    }
}
