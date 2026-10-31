using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows.Input;
using TheMashup.Core;

namespace TheMashup.UI;

public sealed class HomeViewModel : INotifyPropertyChanged
{
    private readonly IHomeRecommendationsService _service;
    private readonly Library _library;
    private readonly PlayerViewModel? _player;
    private readonly IAccountSignInLauncher _launcher;
    private CancellationTokenSource? _loadCancellation;
    private bool _loading;
    private string _status = "Connect your YouTube account to see recommendations.";

    public HomeViewModel(IHomeRecommendationsService service, Library library, PlayerViewModel? player = null,
        IAccountSignInLauncher? launcher = null)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
        _library = library ?? throw new ArgumentNullException(nameof(library));
        _player = player;
        _launcher = launcher ?? new UnavailableAccountSignInLauncher();
        ConnectCommand = new ActionCommand(() => _ = ConnectAsync());
        RefreshCommand = new ActionCommand(() => _ = LoadAsync());
        SignOutCommand = new ActionCommand(SignOut);
        _ = LoadAsync();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public ObservableCollection<HomeShelfViewModel> Shelves { get; } = [];
    public bool IsConnected => _service.IsConnected;
    public string? AccountDisplayName => _service.AccountDisplayName ?? "Your account";
    public bool HasShelves => Shelves.Count > 0;
    public bool Loading => _loading;
    public string HomeStatus
    {
        get => _status;
        internal set
        {
            if (_status == value) return;
            _status = value;
            Notify(nameof(HomeStatus));
        }
    }
    public ICommand ConnectCommand { get; }
    public ICommand RefreshCommand { get; }
    public ICommand SignOutCommand { get; }

    public async Task LoadAsync()
    {
        _loadCancellation?.Cancel();
        _loadCancellation = new CancellationTokenSource();
        _loading = true;
        _status = "Loading your recommendations…";
        Notify(nameof(Loading), nameof(HomeStatus));
        Shelves.Clear();
        try
        {
            if (!_service.IsConnected)
            {
                _status = "Connect your YouTube account to see recommendations.";
                return;
            }
            var feed = await _service.LoadFeedAsync(_loadCancellation.Token);
            foreach (var shelf in feed.Shelves)
            {
                var items = new ObservableCollection<HomeItemViewModel>();
                foreach (var item in shelf.Items)
                    items.Add(new HomeItemViewModel(this, item));
                Shelves.Add(new HomeShelfViewModel(shelf.Title, items));
            }
            _status = "Your recommendations are ready.";
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _status = ex is HomeProviderException ? ex.Message : "Could not load recommendations. Please retry.";
        }
        finally
        {
            _loading = false;
            Notify(nameof(Loading), nameof(HomeStatus), nameof(HasShelves), nameof(IsConnected));
        }
    }

    public async Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string browseId)
    {
        return await _service.LoadCollectionAsync(browseId, CancellationToken.None);
    }

    private async Task ConnectAsync()
    {
        try
        {
            var snapshot = await _launcher.LaunchAsync(CancellationToken.None);
            await _service.ConnectAsync(snapshot, CancellationToken.None);
            await LoadAsync();
        }
        catch (Exception ex)
        {
            _status = ex is HomeProviderException ? ex.Message : "Could not connect your account. Please try again.";
            Notify(nameof(HomeStatus));
        }
    }

    private void SignOut()
    {
        _service.SignOut();
        _ = LoadAsync();
    }

    internal bool CanPlay(CatalogTrack track) => _player?.IsAvailable == true && track.IsUsable;
    internal void PlayTrack(CatalogTrack track)
    {
        if (!track.IsUsable) return;
        if (_player?.IsAvailable != true)
        {
            HomeStatus = "Playback is unavailable in this build.";
            return;
        }
        _ = _player.PlayNowAsync(track.ToLibraryTrack());
    }
    internal void QueueTrack(CatalogTrack track)
    {
        if (!track.IsUsable) return;
        if (_library.AddToQueue(track.ToLibraryTrack()))
            HomeStatus = "Added to the queue without interrupting playback.";
        else
            HomeStatus = "This song could not be queued.";
    }
    internal void ToggleLike(CatalogTrack track)
    {
        if (!track.IsUsable || !_library.CanEdit) return;
        var saved = track.ToLibraryTrack();
        if (!_library.SetLiked(saved, !_library.IsLiked(saved)))
        {
            HomeStatus = "This song could not be saved.";
            return;
        }
        HomeStatus = _library.IsLiked(saved) ? "Added to liked songs." : "Removed from liked songs.";
    }

    private void Notify(params string[] names)
    {
        foreach (var name in names)
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

public sealed class HomeShelfViewModel
{
    public HomeShelfViewModel(string title, ObservableCollection<HomeItemViewModel> items)
    {
        Title = title;
        Items = items;
    }

    public string Title { get; }
    public ObservableCollection<HomeItemViewModel> Items { get; }
}

public sealed class HomeItemViewModel : INotifyPropertyChanged
{
    private readonly HomeViewModel _owner;
    private bool _expanded;

    public HomeItemViewModel(HomeViewModel owner, HomeItem item)
    {
        _owner = owner;
        IsSong = item is HomeSong;
        if (item is HomeSong { Track: { } songTrack })
        {
            var track = songTrack.ToCatalogTrack();
            Track = track;
            Title = track.Title;
            Artist = track.Artist;
            Album = track.Album ?? "";
            Artwork = track.Artwork ?? "";
            CanPlay = owner.CanPlay(track);
        }
        else if (item is HomeCollection { BrowseId: { } browseId, Title: { } title, Artwork: { } artwork })
        {
            BrowseId = browseId;
            Title = title;
            Artwork = artwork ?? "";
            CanExpand = true;
        }

        PlayCommand = new ActionCommand(() => { if (Track is { } current) owner.PlayTrack(current); });
        QueueCommand = new ActionCommand(() => { if (Track is { } current) owner.QueueTrack(current); });
        LikeCommand = new ActionCommand(() => { if (Track is { } current) owner.ToggleLike(current); });
        ExpandCommand = new ActionCommand(() => _ = ExpandAsync());
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public bool IsSong { get; }
    public bool IsCollection => !IsSong;
    public bool CanExpand { get; }
    public bool IsExpanded => _expanded && IsCollection;
    public string ExpandText => _expanded ? "Hide songs" : "View songs";
    public string Title { get; } = "";
    public string Artist { get; } = "";
    public string Album { get; } = "";
    public string Artwork { get; } = "";
    public CatalogTrack? Track { get; }
    public string? BrowseId { get; }
    public bool CanPlay { get; private set; }
    public ObservableCollection<HomeTrackRowViewModel> Tracks { get; } = [];
    public ICommand PlayCommand { get; }
    public ICommand QueueCommand { get; }
    public ICommand LikeCommand { get; }
    public ICommand ExpandCommand { get; }

    private async Task ExpandAsync()
    {
        if (!IsCollection || string.IsNullOrWhiteSpace(BrowseId)) return;
        _expanded = !_expanded;
        Notify(nameof(IsExpanded), nameof(ExpandText));
        if (!_expanded) return;
        try
        {
            var tracks = await _owner.LoadCollectionAsync(BrowseId!);
            Tracks.Clear();
            foreach (var track in tracks.Where(track => track.IsUsable))
                Tracks.Add(new HomeTrackRowViewModel(_owner, track));
        }
        catch (Exception ex)
        {
            _owner.HomeStatus = ex is HomeProviderException ? ex.Message : "This collection could not be opened.";
        }
    }

    private void Notify(params string[] names)
    {
        foreach (var name in names)
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

public sealed class HomeTrackRowViewModel
{
    private readonly HomeViewModel _owner;
    private readonly CatalogTrack _track;

    public HomeTrackRowViewModel(HomeViewModel owner, CatalogTrack track)
    {
        _owner = owner;
        _track = track;
        Title = track.Title;
        Artist = track.Artist;
        Album = track.Album ?? "";
        Artwork = track.Artwork ?? "";
        DurationText = track.DurationSeconds is > 0 ? $"{track.DurationSeconds / 60}:{track.DurationSeconds % 60:D2}" : "";
        PlayCommand = new ActionCommand(() => _owner.PlayTrack(_track));
        QueueCommand = new ActionCommand(() => _owner.QueueTrack(_track));
        LikeCommand = new ActionCommand(() => _owner.ToggleLike(_track));
    }

    public string Title { get; }
    public string Artist { get; }
    public string Album { get; }
    public string Artwork { get; }
    public string DurationText { get; }
    public ICommand PlayCommand { get; }
    public ICommand QueueCommand { get; }
    public ICommand LikeCommand { get; }
}
