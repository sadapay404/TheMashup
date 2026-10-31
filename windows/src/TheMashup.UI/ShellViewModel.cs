using System.Collections.ObjectModel;
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
    private readonly Library _library;
    private string _page = "home";
    private bool _compact;
    private bool _showHeroArtwork = true;
    private string _newPlaylistName = "";
    private string _playlistMessage = "";

    public ShellViewModel(ThemeSelection themes, Library library, ISearchService? searchService = null,
        IPlaybackResolver? playbackResolver = null, IMediaDevice? mediaDevice = null,
        IHomeRecommendationsService? homeService = null, IAccountSignInLauncher? signInLauncher = null,
        IDownloadService? downloadService = null)
    {
        _themes = themes ?? throw new ArgumentNullException(nameof(themes));
        _library = library ?? throw new ArgumentNullException(nameof(library));
        Player = new PlayerViewModel(_library, playbackResolver, mediaDevice);
        Search = new SearchViewModel(searchService ?? new UnavailableSearchService(), _library, Player, downloadService);
        Home = new HomeViewModel(homeService ?? new UnavailableHomeService(), _library, Player,
            signInLauncher ?? new UnavailableAccountSignInLauncher());
        Download = new DownloadViewModel(downloadService ?? new UnavailableDownloadService());
        NavigateCommand = new ParameterCommand(Navigate);
        SelectThemeCommand = new ParameterCommand(id => _themes.Select(id));
        CreatePlaylistCommand = new ActionCommand(CreatePlaylist);
        DownloadQueueCommand = new ActionCommand(() => _ = DownloadQueueAsync());
        DownloadPlaylistCommand = new ParameterCommand(id => _ = DownloadPlaylistAsync(id));
        _themes.Changed += (_, _) =>
        {
            Notify(nameof(CurrentThemeName), nameof(ThemeStatus), nameof(IsFrosted),
                nameof(IsPaper), nameof(IsNeon), nameof(IsAurora), nameof(IsVinyl));
        };
        _library.Changed += (_, _) => RefreshLibrary();
        RefreshLibrary();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public SearchViewModel Search { get; }
    public PlayerViewModel Player { get; }
    public HomeViewModel Home { get; }
    public DownloadViewModel Download { get; }
    public ICommand NavigateCommand { get; }
    public ICommand SelectThemeCommand { get; }
    public ICommand CreatePlaylistCommand { get; }
    public ICommand DownloadQueueCommand { get; }
    public ICommand DownloadPlaylistCommand { get; }
    public ObservableCollection<PlaylistRowViewModel> PlaylistRows { get; } = [];
    public bool IsHome => _page == "home";
    public bool IsSearch => _page == "search";
    public bool IsLibrary => _page == "library";
    public bool IsDownloads => _page == "downloads";
    public bool IsSettings => _page == "settings";
    public bool IsFeaturePage => false;
    public bool ShowNavLabels => !_compact;
    public bool ShowHeroArtwork => _showHeroArtwork;
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
    public bool CanEditLibrary => _library.CanEdit;
    public bool HasPlaylists => PlaylistRows.Count > 0;
    public bool HasNoPlaylists => !HasPlaylists;
    public string PlaylistCountText => PlaylistRows.Count == 1 ? "1 playlist" : $"{PlaylistRows.Count} playlists";
    public string LibraryStatus => _library.LoadStatus switch
    {
        LibraryLoadStatus.Unavailable => "Library storage is unavailable. Existing data was not changed.",
        LibraryLoadStatus.Invalid => "This library could not be read. Existing data was preserved; editing is disabled.",
        LibraryLoadStatus.NewerVersion => "This library was created by a newer version. Existing data was preserved; editing is disabled.",
        _ when !_library.LastWriteSucceeded => "Couldn’t save your changes. They are only available for this session.",
        _ => "Saved locally on this device."
    };
    public string NewPlaylistName
    {
        get => _newPlaylistName;
        set
        {
            value ??= "";
            if (_newPlaylistName == value) return;
            _newPlaylistName = value;
            _playlistMessage = "";
            Notify(nameof(NewPlaylistName), nameof(PlaylistMessage), nameof(HasPlaylistMessage));
        }
    }
    public string PlaylistMessage => _playlistMessage;
    public bool HasPlaylistMessage => !string.IsNullOrEmpty(_playlistMessage);
    public string PageTitle => _page switch
    {
        "search" => "Search", "library" => "Your library", "downloads" => "Downloads",
        "settings" => "Appearance", _ => "Home"
    };
    public string FeatureEyebrow => IsSearch ? "DISCOVER" : "OFFLINE LISTENING";
    public string FeatureTitle => IsSearch ? "Find your next favorite." : "Take your music with you.";
    public string FeatureDescription => IsSearch
        ? "Search songs, artists, albums and lyrics."
        : "Download and save audio or video from search, queues, and playlists.";
    public string FeatureFootnote => IsSearch ? "SEARCH & DISCOVERY" : "DOWNLOADS";

    public void UpdateWidth(double width)
    {
        var compact = width < 850;
        var showArtwork = width >= 1180;
        if (compact != _compact)
        {
            _compact = compact;
            Notify(nameof(ShowNavLabels), nameof(SidebarWidth));
        }
        if (showArtwork != _showHeroArtwork)
        {
            _showHeroArtwork = showArtwork;
            Notify(nameof(ShowHeroArtwork));
        }
    }

    private void CreatePlaylist()
    {
        if (!_library.CanEdit) return;
        if (!_library.CreatePlaylist(NewPlaylistName, out _))
        {
            _playlistMessage = $"Enter a name of up to {Library.MaxPlaylistNameLength} characters.";
            Notify(nameof(PlaylistMessage), nameof(HasPlaylistMessage));
            return;
        }
        NewPlaylistName = "";
    }

    private void RefreshLibrary()
    {
        var playlists = _library.Playlists;
        var sameRows = PlaylistRows.Count == playlists.Count;
        for (var i = 0; sameRows && i < playlists.Count; i++)
            sameRows = PlaylistRows[i].Id == playlists[i].Id && PlaylistRows[i].Name == playlists[i].Name &&
                PlaylistRows[i].SongCount == playlists[i].Tracks.Count;
        // Queue/history changes should not recreate the whole playlist view.
        if (!sameRows)
        {
            PlaylistRows.Clear();
            foreach (var playlist in playlists)
                PlaylistRows.Add(new PlaylistRowViewModel(_library, playlist, Player, DownloadTracksAsync));
        }
        Notify(nameof(HasPlaylists), nameof(HasNoPlaylists), nameof(PlaylistCountText),
            nameof(LibraryStatus), nameof(CanEditLibrary));
    }

    private async Task DownloadQueueAsync()
    {
        var tracks = _library.Queue.Select(CatalogTrack.FromLibraryTrack).ToArray();
        if (tracks.Length == 0)
        {
            Download.Status = "Nothing is queued to download.";
            return;
        }
        await Download.StartBatchAsync(tracks, "mp3", "320k");
    }

    private async Task DownloadPlaylistAsync(string? playlistId)
    {
        if (string.IsNullOrWhiteSpace(playlistId)) return;
        var playlist = _library.Playlists.FirstOrDefault(item => item.Id == playlistId);
        if (playlist is null)
        {
            Download.Status = "That playlist no longer exists.";
            return;
        }
        await DownloadTracksAsync(playlist.Tracks);
    }

    private async Task DownloadTracksAsync(IEnumerable<LibraryTrack> tracks)
    {
        var catalog = tracks.Select(CatalogTrack.FromLibraryTrack).ToArray();
        if (catalog.Length == 0)
        {
            Download.Status = "Nothing to download.";
            return;
        }
        await Download.StartBatchAsync(catalog, "mp3", "320k");
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

internal sealed class ActionCommand(Action action) : ICommand
{
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => action();
}

public sealed class PlaylistRowViewModel : INotifyPropertyChanged
{
    private readonly Library _library;
    private string _draftName;
    private bool _editing;
    private bool _confirmingDelete;
    private bool _expanded;
    private string _message = "";
    private readonly Func<IEnumerable<LibraryTrack>, Task>? _downloadAll;

    public PlaylistRowViewModel(Library library, LibraryPlaylistView playlist, PlayerViewModel? player = null,
        Func<IEnumerable<LibraryTrack>, Task>? downloadAll = null)
    {
        _library = library;
        _downloadAll = downloadAll;
        Id = playlist.Id;
        Name = playlist.Name;
        _draftName = Name;
        SongCount = playlist.Tracks.Count;
        SongCountText = SongCount == 1 ? "1 song" : $"{SongCount} songs";
        for (var index = 0; index < playlist.Tracks.Count; index++)
        {
            var position = index;
            var track = playlist.Tracks[index];
            Songs.Add(new SavedTrackRowViewModel(track, () => _library.RemoveFromPlaylist(Id, position),
                player?.IsAvailable == true ? () => { _ = player.PlayNowAsync(track); } : null));
        }
        ToggleSongsCommand = new ActionCommand(() =>
        {
            _expanded = !_expanded;
            Notify(nameof(IsExpanded), nameof(ToggleSongsText), nameof(ShowEmptySongs));
        });
        DownloadCommand = new ActionCommand(() => _ = _downloadAll?.Invoke(playlist.Tracks));
        BeginRenameCommand = new ActionCommand(() => { _editing = true; _confirmingDelete = false; UpdateState(); });
        SaveNameCommand = new ActionCommand(SaveName);
        CancelRenameCommand = new ActionCommand(() => { _editing = false; DraftName = Name; UpdateState(); });
        BeginDeleteCommand = new ActionCommand(() => { _confirmingDelete = true; _editing = false; UpdateState(); });
        ConfirmDeleteCommand = new ActionCommand(() => _library.DeletePlaylist(Id));
        CancelDeleteCommand = new ActionCommand(() => { _confirmingDelete = false; UpdateState(); });
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public string Id { get; }
    public string Name { get; }
    public int SongCount { get; }
    public string SongCountText { get; }
    public ObservableCollection<SavedTrackRowViewModel> Songs { get; } = [];
    public bool IsExpanded => _expanded && IsViewing;
    public bool ShowEmptySongs => IsExpanded && Songs.Count == 0;
    public string ToggleSongsText => _expanded ? "Hide songs" : "View songs";
    public bool IsEditing => _editing;
    public bool IsConfirmingDelete => _confirmingDelete;
    public bool IsViewing => !_editing && !_confirmingDelete;
    public string Message => _message;
    public bool HasMessage => !string.IsNullOrEmpty(_message);
    public string DraftName
    {
        get => _draftName;
        set
        {
            value ??= "";
            if (_draftName == value) return;
            _draftName = value;
            _message = "";
            Notify(nameof(DraftName), nameof(Message), nameof(HasMessage));
        }
    }
    public ICommand ToggleSongsCommand { get; }
    public ICommand DownloadCommand { get; }
    public ICommand BeginRenameCommand { get; }
    public ICommand SaveNameCommand { get; }
    public ICommand CancelRenameCommand { get; }
    public ICommand BeginDeleteCommand { get; }
    public ICommand ConfirmDeleteCommand { get; }
    public ICommand CancelDeleteCommand { get; }

    private void SaveName()
    {
        if (_library.RenamePlaylist(Id, DraftName))
        {
            _editing = false;
            UpdateState();
            return;
        }
        _message = $"Enter a name of up to {Library.MaxPlaylistNameLength} characters.";
        Notify(nameof(Message), nameof(HasMessage));
    }

    private void UpdateState()
    {
        _message = "";
        Notify(nameof(IsEditing), nameof(IsConfirmingDelete), nameof(IsViewing), nameof(IsExpanded), nameof(ShowEmptySongs), nameof(Message), nameof(HasMessage));
    }

    private void Notify(params string[] properties)
    {
        foreach (var property in properties)
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(property));
    }
}
