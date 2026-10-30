using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows.Input;
using TheMashup.Core;

namespace TheMashup.UI;

/// <summary>
/// Search, suggestions, lyric discovery and lyric text have independent state.
/// Cancelling and generation checks keep late replies from replacing newer input.
/// </summary>
public sealed class SearchViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISearchService _service;
    private readonly Library _library;
    private readonly PlayerViewModel? _player;
    private TimedLyricLine[] _timedLines = [];
    private string? _lyricsTrackId;
    private string _activeLyric = "";
    private CancellationTokenSource? _suggestionsCancellation, _searchCancellation, _lyricsCancellation;
    private long _suggestionGeneration, _searchGeneration, _lyricsGeneration;
    private string _query = "", _suggestionStatus = "", _catalogStatus = "Enter a song, artist, album or lyric.",
        _lyricSearchStatus = "", _lyricsStatus = "", _lyricsText = "", _lyricsTitle = "", _actionStatus = "", _playlistStatus = "";
    private bool _catalogLoading, _lyricSearchLoading, _lyricsLoading, _showLyrics, _showPlaylistPicker;
    private CatalogTrack? _playlistTrack;
    private PlaylistChoice? _selectedPlaylist;

    public SearchViewModel(ISearchService service, Library library, PlayerViewModel? player = null)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
        _library = library ?? throw new ArgumentNullException(nameof(library));
        _player = player;
        if (_player?.Controller is { } controller) controller.PropertyChanged += PlayerChanged;
        SubmitCommand = new ActionCommand(() => { _ = SubmitAsync(); });
        CloseLyricsCommand = new ActionCommand(CloseLyrics);
        ClearHistoryCommand = new ActionCommand(() => _library.ClearHistory());
        AddToPlaylistCommand = new ActionCommand(AddToPlaylist);
        ClosePlaylistCommand = new ActionCommand(() => { _showPlaylistPicker = false; Notify(nameof(ShowPlaylistPicker)); });
        _library.Changed += LibraryChanged;
        RefreshLibrary();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public ICommand SubmitCommand { get; }
    public ICommand CloseLyricsCommand { get; }
    public ICommand ClearHistoryCommand { get; }
    public ICommand AddToPlaylistCommand { get; }
    public ICommand ClosePlaylistCommand { get; }
    public ObservableCollection<SearchTrackRowViewModel> Tracks { get; } = [];
    public ObservableCollection<SearchTrackRowViewModel> LyricHits { get; } = [];
    public ObservableCollection<SearchSuggestionViewModel> Suggestions { get; } = [];
    public ObservableCollection<SearchSuggestionViewModel> ArtistsAndAlbums { get; } = [];
    public ObservableCollection<PlaylistChoice> PlaylistChoices { get; } = [];
    public ObservableCollection<SavedTrackRowViewModel> LikedTracks { get; } = [];
    public ObservableCollection<SavedTrackRowViewModel> QueuedTracks { get; } = [];
    public ObservableCollection<SavedTrackRowViewModel> HistoryTracks { get; } = [];
    public Task PendingSuggestions { get; private set; } = Task.CompletedTask;

    public string Query
    {
        get => _query;
        set
        {
            value ??= "";
            if (_query == value) return;
            _query = value.Length > 200 ? value[..200] : value;
            _suggestionsCancellation?.Cancel();
            _searchCancellation?.Cancel();
            _suggestionGeneration++;
            _searchGeneration++;
            Suggestions.Clear(); Tracks.Clear(); LyricHits.Clear(); ArtistsAndAlbums.Clear();
            CloseLyrics();
            _showPlaylistPicker = false;
            _catalogLoading = _lyricSearchLoading = false;
            _catalogStatus = string.IsNullOrWhiteSpace(_query) ? "Enter a song, artist, album or lyric." : "Press Search to find matches.";
            _lyricSearchStatus = _suggestionStatus = _actionStatus = "";
            Notify(nameof(Query), nameof(CatalogStatus), nameof(LyricSearchStatus), nameof(SuggestionStatus),
                nameof(CatalogLoading), nameof(LyricSearchLoading), nameof(HasTracks), nameof(HasLyricHits),
                nameof(HasSuggestions), nameof(HasArtistsAndAlbums), nameof(ShowPlaylistPicker), nameof(ActionStatus));
            var text = _query.Trim();
            if (text.Length >= 2)
            {
                var cts = new CancellationTokenSource();
                _suggestionsCancellation = cts;
                PendingSuggestions = LoadSuggestionsAsync(text, _suggestionGeneration, cts);
            }
            else PendingSuggestions = Task.CompletedTask;
        }
    }

    public string SuggestionStatus => _suggestionStatus;
    public string CatalogStatus => _catalogStatus;
    public string LyricSearchStatus => _lyricSearchStatus;
    public string LyricsStatus => _lyricsStatus;
    public string LyricsText => _lyricsText;
    public string LyricsTitle => _lyricsTitle;
    public string ActiveLyric => _activeLyric;
    public bool HasActiveLyric => !string.IsNullOrWhiteSpace(_activeLyric);
    public string ActionStatus => _actionStatus;
    public string PlaylistStatus => _playlistStatus;
    public bool CatalogLoading => _catalogLoading;
    public bool LyricSearchLoading => _lyricSearchLoading;
    public bool LyricsLoading => _lyricsLoading;
    public bool ShowLyrics => _showLyrics;
    public bool ShowPlaylistPicker => _showPlaylistPicker;
    public bool HasTracks => Tracks.Count > 0;
    public bool HasLyricHits => LyricHits.Count > 0;
    public bool HasSuggestions => Suggestions.Count > 0;
    public bool HasArtistsAndAlbums => ArtistsAndAlbums.Count > 0;
    public bool HasLikedTracks => LikedTracks.Count > 0;
    public bool HasQueuedTracks => QueuedTracks.Count > 0;
    public bool HasHistoryTracks => HistoryTracks.Count > 0;
    public bool HasPlaylistChoices => PlaylistChoices.Count > 0;
    public bool CanAddToPlaylist => _library.CanEdit && _playlistTrack is not null && _selectedPlaylist is not null;
    public string PlaylistTrackTitle => _playlistTrack?.Title ?? "";
    public string QueueSummary => QueuedTracks.Count == 1 ? "1 song queued" : $"{QueuedTracks.Count} songs queued";
    public string LikedSummary => LikedTracks.Count == 1 ? "1 liked song" : $"{LikedTracks.Count} liked songs";
    public PlaylistChoice? SelectedPlaylist
    {
        get => _selectedPlaylist;
        set { _selectedPlaylist = value; Notify(nameof(SelectedPlaylist), nameof(CanAddToPlaylist)); }
    }

    private async Task LoadSuggestionsAsync(string text, long generation, CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(350, cts.Token);
            if (!CurrentSuggestion(generation, cts)) return;
            _suggestionStatus = "Finding suggestions…"; Notify(nameof(SuggestionStatus));
            var result = await _service.SuggestAsync(text, cts.Token);
            if (!CurrentSuggestion(generation, cts)) return;
            Suggestions.Clear();
            foreach (var item in (result.Suggestions ?? []).Where(item => !string.IsNullOrWhiteSpace(item)).Take(8))
                Suggestions.Add(new SearchSuggestionViewModel(item, ChooseSuggestion));
            _suggestionStatus = "";
            Notify(nameof(HasSuggestions), nameof(SuggestionStatus));
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception)
        {
            if (!CurrentSuggestion(generation, cts)) return;
            _suggestionStatus = "Suggestions unavailable; you can still search.";
            Notify(nameof(SuggestionStatus));
        }
        finally
        {
            if (ReferenceEquals(_suggestionsCancellation, cts)) _suggestionsCancellation = null;
            cts.Dispose();
        }
    }

    public async Task SubmitAsync()
    {
        var text = Query.Trim();
        if (text.Length == 0)
        {
            _catalogStatus = "Enter a song, artist, album or lyric."; Notify(nameof(CatalogStatus)); return;
        }
        _suggestionsCancellation?.Cancel(); _suggestionGeneration++;
        _searchCancellation?.Cancel(); _searchGeneration++;
        Suggestions.Clear(); Tracks.Clear(); LyricHits.Clear(); ArtistsAndAlbums.Clear();
        _suggestionStatus = _actionStatus = "";
        _catalogStatus = "Searching songs…"; _catalogLoading = true;
        _lyricSearchStatus = text.Length >= 2 ? "Searching lyric matches…" : "Enter at least two characters for lyric search.";
        _lyricSearchLoading = text.Length >= 2;
        Notify(nameof(HasSuggestions), nameof(HasTracks), nameof(HasLyricHits), nameof(HasArtistsAndAlbums),
            nameof(SuggestionStatus), nameof(ActionStatus), nameof(CatalogStatus), nameof(CatalogLoading),
            nameof(LyricSearchStatus), nameof(LyricSearchLoading));
        var cts = new CancellationTokenSource();
        _searchCancellation = cts;
        var generation = _searchGeneration;
        try
        {
            var catalog = LoadCatalogAsync(text, generation, cts);
            var lyric = text.Length >= 2 ? LoadLyricHitsAsync(text, generation, cts) : Task.CompletedTask;
            await Task.WhenAll(catalog, lyric);
        }
        finally
        {
            if (ReferenceEquals(_searchCancellation, cts)) _searchCancellation = null;
            cts.Dispose();
        }
    }

    private async Task LoadCatalogAsync(string text, long generation, CancellationTokenSource cts)
    {
        try
        {
            var result = await _service.SearchAsync(text, cts.Token);
            if (!CurrentSearch(generation, cts)) return;
            foreach (var track in (result.Tracks ?? []).Where(track => track.IsUsable).Take(20))
                Tracks.Add(new SearchTrackRowViewModel(this, track));
            foreach (var artist in (result.Artists ?? []).Where(item => !string.IsNullOrWhiteSpace(item.Name)).Take(5))
                ArtistsAndAlbums.Add(new SearchSuggestionViewModel($"Artist · {artist.Name}", () => ChooseSuggestion(artist.Name)));
            foreach (var album in (result.Albums ?? []).Where(item => !string.IsNullOrWhiteSpace(item.Title)).Take(5))
                ArtistsAndAlbums.Add(new SearchSuggestionViewModel($"Album · {album.Title}", () => ChooseSuggestion($"{album.Title} {album.Artist}")));
            var warnings = result.Warnings ?? [];
            _catalogStatus = Tracks.Count == 0 && ArtistsAndAlbums.Count == 0 ? "No catalog matches found." :
                warnings.Contains("mock_mode") ? "Fixture results (not live music)." :
                warnings.Any(w => w.Contains("fallback", StringComparison.OrdinalIgnoreCase)) ? "Showing results from a fallback source." : "Catalog results";
            Notify(nameof(CatalogStatus), nameof(HasTracks), nameof(HasArtistsAndAlbums));
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!CurrentSearch(generation, cts)) return;
            _catalogStatus = Message(ex, "Song search is unavailable. Please try again."); Notify(nameof(CatalogStatus));
        }
        finally
        {
            if (CurrentSearch(generation, cts)) { _catalogLoading = false; Notify(nameof(CatalogLoading)); }
        }
    }

    private async Task LoadLyricHitsAsync(string text, long generation, CancellationTokenSource cts)
    {
        try
        {
            var result = await _service.SearchLyricsAsync(text, cts.Token);
            if (!CurrentSearch(generation, cts)) return;
            foreach (var hit in (result.Hits ?? []).Take(4))
            {
                if (string.IsNullOrWhiteSpace(hit.Title) || string.IsNullOrWhiteSpace(hit.Artist)) continue;
                var track = hit.Track?.IsUsable == true ? hit.Track : new CatalogTrack { Title = hit.Title, Artist = hit.Artist };
                LyricHits.Add(new SearchTrackRowViewModel(this, track!, hit.Snippet));
            }
            _lyricSearchStatus = result.Source == "mock" ? "Lyric matches · fixture data" :
                LyricHits.Count == 0 ? "No lyric matches found." :
                (result.Warnings ?? []).Length > 0 ? "Some lyric matches could not be matched to the catalog." : "Lyric matches · Genius";
            Notify(nameof(LyricSearchStatus), nameof(HasLyricHits));
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!CurrentSearch(generation, cts)) return;
            _lyricSearchStatus = Message(ex, "Lyric search is unavailable. Song results can still appear.");
            Notify(nameof(LyricSearchStatus));
        }
        finally
        {
            if (CurrentSearch(generation, cts)) { _lyricSearchLoading = false; Notify(nameof(LyricSearchLoading)); }
        }
    }

    public async Task OpenLyricsAsync(CatalogTrack track)
    {
        _lyricsCancellation?.Cancel(); _lyricsGeneration++;
        var cts = new CancellationTokenSource(); _lyricsCancellation = cts;
        var generation = _lyricsGeneration;
        _showLyrics = true; _lyricsLoading = true; _lyricsTitle = $"{track.Title} · {track.Artist}";
        _lyricsTrackId = track.Id; _timedLines = []; _activeLyric = "";
        _lyricsText = ""; _lyricsStatus = "Loading lyrics…";
        Notify(nameof(ActiveLyric), nameof(HasActiveLyric));
        Notify(nameof(ShowLyrics), nameof(LyricsLoading), nameof(LyricsTitle), nameof(LyricsText), nameof(LyricsStatus));
        try
        {
            var lyrics = await _service.GetLyricsAsync(track, cts.Token);
            if (!CurrentLyrics(generation, cts)) return;
            if (lyrics is null) _lyricsStatus = "No lyrics found for this song.";
            else if (lyrics.Instrumental) _lyricsStatus = "This track is marked instrumental.";
            else if (lyrics.Synced is { Length: > 0 })
            {
                _timedLines = lyrics.Synced.Where(line => line is not null && double.IsFinite(line.Time) && line.Time >= 0 && line.Time < 86_400)
                    .OrderBy(line => line.Time).ToArray();
                _lyricsText = string.Join("\n", _timedLines.Select(line => $"{TimeSpan.FromSeconds(line.Time):mm\\:ss}  {line.Text}"));
                _lyricsStatus = lyrics.Provider == "mock" ? "Timed lyrics · fixture data" :
                    "Timed lyrics from LRCLIB · the current line follows playback.";
                RefreshActiveLyric();
            }
            else if (!string.IsNullOrWhiteSpace(lyrics.Plain))
            {
                _lyricsText = lyrics.Plain;
                _lyricsStatus = lyrics.Provider == "mock" ? "Lyrics · fixture data" : "Plain lyrics from LRCLIB.";
            }
            else _lyricsStatus = "No lyric text is available for this song.";
            Notify(nameof(LyricsText), nameof(LyricsStatus));
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!CurrentLyrics(generation, cts)) return;
            _lyricsStatus = Message(ex, "Lyrics are unavailable. Please try again."); Notify(nameof(LyricsStatus));
        }
        finally
        {
            if (CurrentLyrics(generation, cts)) { _lyricsLoading = false; Notify(nameof(LyricsLoading)); }
            if (ReferenceEquals(_lyricsCancellation, cts)) _lyricsCancellation = null;
            cts.Dispose();
        }
    }

    internal void PlayTrack(CatalogTrack track)
    {
        if (!track.IsUsable) return;
        if (_player?.IsAvailable != true)
        {
            _actionStatus = "Playback is unavailable in this build."; Notify(nameof(ActionStatus)); return;
        }
        _actionStatus = ""; Notify(nameof(ActionStatus));
        _ = _player.PlayNowAsync(track.ToLibraryTrack());
    }
    internal bool CanPlay => _player?.IsAvailable == true;

    internal void ToggleLike(CatalogTrack track)
    {
        if (!track.IsUsable || !_library.CanEdit) return;
        var saved = track.ToLibraryTrack();
        if (!_library.SetLiked(saved, !_library.IsLiked(saved)))
        {
            _actionStatus = "This song could not be saved."; Notify(nameof(ActionStatus)); return;
        }
        _actionStatus = _library.LastWriteSucceeded ? (_library.IsLiked(saved) ? "Added to liked songs." : "Removed from liked songs.")
            : "The change is only available for this session; it could not be saved.";
        Notify(nameof(ActionStatus));
    }
    internal void QueueTrack(CatalogTrack track)
    {
        if (!track.IsUsable) return;
        if (!_library.AddToQueue(track.ToLibraryTrack()))
        {
            _actionStatus = "This song could not be queued."; Notify(nameof(ActionStatus)); return;
        }
        _actionStatus = !_library.CanEdit || !_library.LastWriteSucceeded ? "Queued for this session only; library storage is unavailable." :
            "Added one song to the queue without interrupting playback.";
        Notify(nameof(ActionStatus));
    }
    internal void ChoosePlaylist(CatalogTrack track)
    {
        if (!track.IsUsable) return;
        _playlistTrack = track; _showPlaylistPicker = true; _playlistStatus = "";
        Notify(nameof(PlaylistTrackTitle), nameof(ShowPlaylistPicker), nameof(PlaylistStatus), nameof(CanAddToPlaylist));
    }
    private void AddToPlaylist()
    {
        if (!CanAddToPlaylist || _playlistTrack is null || _selectedPlaylist is null) return;
        var ok = _library.AddToPlaylist(_selectedPlaylist.Id, _playlistTrack.ToLibraryTrack());
        _playlistStatus = !ok ? "Could not add this song." : _library.LastWriteSucceeded
            ? "Added to playlist." : "Added for this session only; the library could not be saved.";
        Notify(nameof(PlaylistStatus));
    }
    private void ChooseSuggestion(string value)
    {
        Query = value;
        _ = SubmitAsync();
    }
    private void CloseLyrics()
    {
        _lyricsCancellation?.Cancel(); _lyricsGeneration++;
        _showLyrics = _lyricsLoading = false;
        _lyricsTrackId = null; _timedLines = []; _activeLyric = "";
        Notify(nameof(ShowLyrics), nameof(LyricsLoading), nameof(ActiveLyric), nameof(HasActiveLyric));
    }
    private void LibraryChanged(object? sender, EventArgs e) => RefreshLibrary();
    private void RefreshLibrary()
    {
        var selectedId = _selectedPlaylist?.Id;
        PlaylistChoices.Clear();
        foreach (var playlist in _library.Playlists) PlaylistChoices.Add(new PlaylistChoice(playlist.Id, playlist.Name));
        _selectedPlaylist = PlaylistChoices.FirstOrDefault(item => item.Id == selectedId) ?? PlaylistChoices.FirstOrDefault();
        LikedTracks.Clear();
        foreach (var track in _library.LikedTracks)
            LikedTracks.Add(new SavedTrackRowViewModel(track, () => _library.SetLiked(track, false),
                _player?.IsAvailable == true ? () => { _ = _player.PlayNowAsync(track); } : null));
        RefreshQueued();
        HistoryTracks.Clear();
        foreach (var entry in _library.History.Take(50))
        {
            var track = entry.Track;
            if (track is null) continue;
            HistoryTracks.Add(new SavedTrackRowViewModel(track, null,
                _player?.IsAvailable == true ? () => { _ = _player.PlayNowAsync(track); } : null));
        }
        foreach (var row in Tracks.Concat(LyricHits)) row.RefreshLiked();
        Notify(nameof(SelectedPlaylist), nameof(HasPlaylistChoices), nameof(CanAddToPlaylist),
            nameof(HasLikedTracks), nameof(HasHistoryTracks), nameof(LikedSummary));
    }
    private void RefreshQueued()
    {
        QueuedTracks.Clear();
        for (var index = 0; index < _library.Queue.Count; index++)
        {
            var position = index;
            var track = _library.Queue[index];
            var isCurrent = _player?.HasTrack == true && position == _library.CurrentQueueIndex;
            QueuedTracks.Add(new SavedTrackRowViewModel(track, isCurrent ? null : () => _library.RemoveFromQueue(position),
                _player?.IsAvailable == true ? () => { _ = _player.PlayQueueItemAsync(position); } : null, isCurrent));
        }
        Notify(nameof(HasQueuedTracks), nameof(QueueSummary));
    }
    private void PlayerChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(PlaybackController.Position) or nameof(PlaybackController.Track)) RefreshActiveLyric();
        if (e.PropertyName is nameof(PlaybackController.Track) or nameof(PlaybackController.State)) RefreshQueued();
    }
    private void RefreshActiveLyric()
    {
        var controller = _player?.Controller;
        var line = "";
        if (_showLyrics && controller?.Track?.Id == _lyricsTrackId && _timedLines.Length > 0)
        {
            // Find the last line whose timestamp has started, including after seeking.
            var left = 0; var right = _timedLines.Length - 1; var match = -1;
            while (left <= right)
            {
                var mid = left + (right - left) / 2;
                if (_timedLines[mid].Time <= controller.Position + 0.05) { match = mid; left = mid + 1; }
                else right = mid - 1;
            }
            if (match >= 0) line = _timedLines[match].Text ?? "";
        }
        if (_activeLyric == line) return;
        _activeLyric = line;
        Notify(nameof(ActiveLyric), nameof(HasActiveLyric));
    }
    internal bool IsLiked(CatalogTrack track) => track.IsUsable && _library.IsLiked(track.ToLibraryTrack());
    internal bool CanEditLibrary => _library.CanEdit;
    private bool CurrentSuggestion(long generation, CancellationTokenSource cts) => !cts.IsCancellationRequested && generation == _suggestionGeneration;
    private bool CurrentSearch(long generation, CancellationTokenSource cts) => !cts.IsCancellationRequested && generation == _searchGeneration;
    private bool CurrentLyrics(long generation, CancellationTokenSource cts) => !cts.IsCancellationRequested && generation == _lyricsGeneration;
    private static string Message(Exception ex, string fallback) => ex is SearchProviderException ? ex.Message : fallback;
    private void Notify(params string[] names) { foreach (var name in names) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name)); }
    public void Dispose()
    {
        _library.Changed -= LibraryChanged;
        if (_player?.Controller is { } controller) controller.PropertyChanged -= PlayerChanged;
        _suggestionsCancellation?.Cancel(); _searchCancellation?.Cancel(); _lyricsCancellation?.Cancel();
    }
}

public sealed class SearchSuggestionViewModel
{
    public SearchSuggestionViewModel(string text, Action<string> choose) : this(text, () => choose(text)) { }
    public SearchSuggestionViewModel(string text, Action choose) { Text = text; ChooseCommand = new ActionCommand(choose); }
    public string Text { get; }
    public ICommand ChooseCommand { get; }
}

public sealed class SearchTrackRowViewModel : INotifyPropertyChanged
{
    private readonly SearchViewModel _owner;
    private readonly CatalogTrack _track;
    public SearchTrackRowViewModel(SearchViewModel owner, CatalogTrack track, string? snippet = null)
    {
        _owner = owner; _track = track; Snippet = snippet ?? "";
        PlayCommand = new ActionCommand(() => owner.PlayTrack(track));
        LikeCommand = new ActionCommand(() => owner.ToggleLike(track));
        QueueCommand = new ActionCommand(() => owner.QueueTrack(track));
        LyricsCommand = new ActionCommand(() => { _ = owner.OpenLyricsAsync(track); });
        PlaylistCommand = new ActionCommand(() => owner.ChoosePlaylist(track));
    }
    public event PropertyChangedEventHandler? PropertyChanged;
    public string Title => _track.Title;
    public string Artist => _track.Artist;
    public string Snippet { get; }
    public bool HasSnippet => !string.IsNullOrWhiteSpace(Snippet);
    public bool IsMatched => _track.IsUsable;
    public bool IsUnmatched => !IsMatched;
    public bool CanLike => IsMatched && _owner.CanEditLibrary;
    public bool CanPlay => IsMatched && _owner.CanPlay;
    public string LikeText => _owner.IsLiked(_track) ? "Liked" : "Like";
    public string Detail => _track.Category == "video" ? $"{Artist} · Video" : Artist;
    public ICommand PlayCommand { get; }
    public ICommand LikeCommand { get; }
    public ICommand QueueCommand { get; }
    public ICommand LyricsCommand { get; }
    public ICommand PlaylistCommand { get; }
    internal void RefreshLiked()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LikeText)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanLike)));
    }
}

public sealed record PlaylistChoice(string Id, string Name);

public sealed class SavedTrackRowViewModel
{
    public SavedTrackRowViewModel(LibraryTrack track, Action? remove, Action? play = null, bool current = false)
    {
        Title = track.Title; Artist = current ? $"{track.Artist} · Current" : track.Artist;
        CanRemove = remove is not null; CanPlay = play is not null;
        RemoveCommand = new ActionCommand(() => remove?.Invoke());
        PlayCommand = new ActionCommand(() => play?.Invoke());
    }
    public string Title { get; }
    public string Artist { get; }
    public bool CanRemove { get; }
    public bool CanPlay { get; }
    public ICommand RemoveCommand { get; }
    public ICommand PlayCommand { get; }
}

internal sealed class UnavailableSearchService : ISearchService
{
    private static SearchProviderException Error() => new("Search is not configured for this build.");
    public Task<CatalogSearchResult> SearchAsync(string q, CancellationToken ct) => Task.FromException<CatalogSearchResult>(Error());
    public Task<SuggestionResult> SuggestAsync(string q, CancellationToken ct) => Task.FromException<SuggestionResult>(Error());
    public Task<LyricSearchResult> SearchLyricsAsync(string q, CancellationToken ct) => Task.FromException<LyricSearchResult>(Error());
    public Task<LyricDocument?> GetLyricsAsync(CatalogTrack track, CancellationToken ct) => Task.FromException<LyricDocument?>(Error());
}
