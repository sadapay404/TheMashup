using System.Collections.ObjectModel;
using System.Diagnostics;
using Avalonia;
using Avalonia.Media;
using Avalonia.Threading;
using TheMashup.Services;

namespace TheMashup.ViewModels;

public sealed class ChipVM : ObservableBase
{
    private bool _on;
    public string Label { get; init; } = "";
    public string Value { get; init; } = "";
    public bool IsOn { get => _on; set => Set(ref _on, value); }
}

public sealed class ThemeCardVM : ObservableBase
{
    private bool _sel;
    public Palette P { get; init; } = ThemeManager.All[0];
    public string Id => P.Id;
    public string Name => P.Name;
    public string Tagline => P.Tagline;
    public IBrush Bg => new SolidColorBrush(Color.Parse(P.Bg));
    public IBrush Surface => new SolidColorBrush(Color.Parse(P.Surface));
    public IBrush Raised => new SolidColorBrush(Color.Parse(P.Raised));
    public IBrush Accent => new SolidColorBrush(Color.Parse(P.Accent));
    public IBrush Accent2 => new SolidColorBrush(Color.Parse(P.Accent2));
    public IBrush Text => new SolidColorBrush(Color.Parse(P.Text));
    public IBrush Muted => new SolidColorBrush(Color.Parse(P.Muted));
    public IBrush Border => new SolidColorBrush(Color.Parse(_sel ? P.Accent : P.Outline));
    public Thickness BorderWidth => new(_sel ? 2 : 1);
    public bool IsSelected { get => _sel; set { if (Set(ref _sel, value)) { Raise(nameof(Border)); Raise(nameof(BorderWidth)); } } }
}

public sealed class PlaylistVM
{
    public long Id { get; init; }
    public string Name { get; init; } = "";
    public string CountText { get; init; } = "";
}

public sealed class QueueItemVM
{
    public TrackVM Item { get; init; } = null!;
    public int Index { get; init; }
    public bool IsCurrent { get; init; }
    public string Title => (IsCurrent ? "▶ " : "") + Item.Title;
    public string Artist => Item.Artist;
}

public sealed class OfflineVM
{
    public DownloadedTrack D { get; init; } = new();
    public TrackVM Item { get; init; } = null!;
    public string Title => D.Track.Title;
    public string Subtitle => $"{D.Track.Artist} · {(D.Quality == "mp4" ? "MP4" : D.Quality + "k")} · {D.Size / 1048576.0:0.0} MB";
}

public sealed class LyricLineVM : ObservableBase
{
    private bool _cur;
    public double T { get; init; }
    public string Text { get; init; } = "";
    public bool IsCurrent { get => _cur; set => Set(ref _cur, value); }
}

public sealed class MainViewModel : ObservableBase, IDisposable
{
    private static readonly string[] EqPresets = { "off", "flat", "bass-boost", "vocal", "treble", "rock", "electronic" };

    public AppSettings S { get; }
    public SourceClient Sources { get; }
    public LibraryStore Library { get; } = new();
    public PlayerService Player { get; }
    public DownloadService Downloads { get; }

    private readonly DispatcherTimer _persist;
    private CancellationTokenSource? _suggestCts, _searchCts;
    private string? _lastCurrentId;
    private int _lastQueueVersion = -1;
    private string _lyricsFor = "";

    public MainViewModel(AppSettings settings)
    {
        S = settings;
        Sources = new SourceClient(() => S.HostUrl);
        Player = new PlayerService(Sources, Library, () => S);
        Downloads = new DownloadService(Sources, Library);

        _persist = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _persist.Tick += (_, _) => { _persist.Stop(); SettingsStore.Save(S); };

        foreach (var p in ThemeManager.All) ThemeCards.Add(new ThemeCardVM { P = p, IsSelected = p.Id == S.Theme });
        foreach (var (l, v) in new[] { ("Everything", "all"), ("Songs", "songs"), ("Lyrics", "lyrics"), ("Artists", "artists") }) FilterChips.Add(new ChipVM { Label = l, Value = v, IsOn = v == "all" });
        foreach (var (l, v) in new[] { ("Playlists", "playlists"), ("Liked songs", "liked"), ("Queue", "queue"), ("History", "history") }) LibChips.Add(new ChipVM { Label = l, Value = v, IsOn = v == "playlists" });
        foreach (var e in EqPresets) EqChips.Add(new ChipVM { Label = e.Replace('-', ' '), Value = e, IsOn = e == S.Eq });
        foreach (var m in new[] { 0, 5, 15, 30, 45, 60, 90 }) SleepChips.Add(new ChipVM { Label = m == 0 ? "Off" : $"{m} min", Value = m.ToString(), IsOn = m == 0 });
        foreach (var (l, v) in new[] { ("MP3 128k", "128"), ("MP3 192k", "192"), ("MP3 320k", "320"), ("MP4 video", "mp4") }) QualityChips.Add(new ChipVM { Label = l, Value = v, IsOn = v == S.DownloadQuality });

        InitCommands();
        Library.Changed += RefreshLibrary;
        Player.Changed += OnPlayerChanged;
        Downloads.Jobs.CollectionChanged += (_, _) => { Raise(nameof(HasJobs)); Raise(nameof(NoJobs)); };

        RefreshLibrary();
        OnPlayerChanged();
        _ = LoadTrending();
        _ = RefreshAccount();
        if (!Player.EngineAvailable) Banner = Player.Error ?? "Audio engine not available.";
    }

    /* ======================= navigation ======================= */
    private string _page = "home";
    public string Page { get => _page; set { if (Set(ref _page, value)) foreach (var n in new[] { nameof(IsHome), nameof(IsSearch), nameof(IsLibrary), nameof(IsDownloads), nameof(IsSettings) }) Raise(n); } }
    public bool IsHome => _page == "home";
    public bool IsSearch => _page == "search";
    public bool IsLibrary => _page == "library";
    public bool IsDownloads => _page == "downloads";
    public bool IsSettings => _page == "settings";

    private bool _queueOpen, _expanded, _showLyrics;
    public bool QueueOpen { get => _queueOpen; set => Set(ref _queueOpen, value); }
    public bool Expanded { get => _expanded; set => Set(ref _expanded, value); }
    public bool ShowLyrics { get => _showLyrics; set { if (Set(ref _showLyrics, value)) Raise(nameof(ShowArt)); } }
    public bool ShowArt => !_showLyrics;

    private string? _banner;
    public string? Banner { get => _banner; set { if (Set(ref _banner, value)) Raise(nameof(HasBanner)); } }
    public bool HasBanner => !string.IsNullOrEmpty(_banner);

    /* ======================= commands ======================= */
    public RelayCommand NavigateCmd { get; private set; } = null!;
    public RelayCommand SetThemeCmd { get; private set; } = null!;
    public RelayCommand CycleThemeCmd { get; private set; } = null!;
    public RelayCommand SearchCmd { get; private set; } = null!;
    public RelayCommand SearchTextCmd { get; private set; } = null!;
    public RelayCommand SuggestPickCmd { get; private set; } = null!;
    public RelayCommand FilterCmd { get; private set; } = null!;
    public RelayCommand PlayTrackCmd { get; private set; } = null!;
    public RelayCommand LikeCmd { get; private set; } = null!;
    public RelayCommand AddQueueCmd { get; private set; } = null!;
    public RelayCommand PlayNextCmd { get; private set; } = null!;
    public RelayCommand DownloadCmd { get; private set; } = null!;
    public RelayCommand PickerOpenCmd { get; private set; } = null!;
    public RelayCommand PickerCloseCmd { get; private set; } = null!;
    public RelayCommand PickPlaylistCmd { get; private set; } = null!;
    public RelayCommand PickerCreateCmd { get; private set; } = null!;
    public RelayCommand LibTabCmd { get; private set; } = null!;
    public RelayCommand CreatePlaylistCmd { get; private set; } = null!;
    public RelayCommand OpenPlaylistCmd { get; private set; } = null!;
    public RelayCommand ClosePlaylistCmd { get; private set; } = null!;
    public RelayCommand DeletePlaylistCmd { get; private set; } = null!;
    public RelayCommand RenamePlaylistCmd { get; private set; } = null!;
    public RelayCommand RemoveFromPlaylistCmd { get; private set; } = null!;
    public RelayCommand PlayOpenPlaylistCmd { get; private set; } = null!;
    public RelayCommand PlayLikedCmd { get; private set; } = null!;
    public RelayCommand ClearHistoryCmd { get; private set; } = null!;
    public RelayCommand QueueJumpCmd { get; private set; } = null!;
    public RelayCommand QueueRemoveCmd { get; private set; } = null!;
    public RelayCommand QueueUpCmd { get; private set; } = null!;
    public RelayCommand QueueDownCmd { get; private set; } = null!;
    public RelayCommand ClearQueueCmd { get; private set; } = null!;
    public RelayCommand ToggleCmd { get; private set; } = null!;
    public RelayCommand NextCmd { get; private set; } = null!;
    public RelayCommand PrevCmd { get; private set; } = null!;
    public RelayCommand ShuffleCmd { get; private set; } = null!;
    public RelayCommand RepeatCmd { get; private set; } = null!;
    public RelayCommand ToggleQueueCmd { get; private set; } = null!;
    public RelayCommand ToggleExpandedCmd { get; private set; } = null!;
    public RelayCommand ShowLyricsCmd { get; private set; } = null!;
    public RelayCommand EqCmd { get; private set; } = null!;
    public RelayCommand SleepCmd { get; private set; } = null!;
    public RelayCommand QualityCmd { get; private set; } = null!;
    public RelayCommand SignInCmd { get; private set; } = null!;
    public RelayCommand OpenWebView2Cmd { get; private set; } = null!;
    public RelayCommand VerifyCookieCmd { get; private set; } = null!;
    public RelayCommand SignOutCmd { get; private set; } = null!;
    public RelayCommand PauseJobCmd { get; private set; } = null!;
    public RelayCommand ResumeJobCmd { get; private set; } = null!;
    public RelayCommand CancelJobCmd { get; private set; } = null!;
    public RelayCommand ClearFinishedCmd { get; private set; } = null!;
    public RelayCommand PlayOfflineCmd { get; private set; } = null!;
    public RelayCommand PlayAllOfflineCmd { get; private set; } = null!;
    public RelayCommand DeleteOfflineCmd { get; private set; } = null!;

    private void InitCommands()
    {
        NavigateCmd = new RelayCommand(p => { Page = p as string ?? "home"; });
        SetThemeCmd = new RelayCommand(p => { if (p is string id) SetTheme(id); });
        CycleThemeCmd = new RelayCommand(() =>
        {
            var i = ThemeManager.All.ToList().FindIndex(x => x.Id == S.Theme);
            SetTheme(ThemeManager.All[(i + 1) % ThemeManager.All.Count].Id);
        });
        SearchCmd = new RelayCommand(() => _ = RunSearch(Query));
        SearchTextCmd = new RelayCommand(p => { if (p is string s) { _query = s; Raise(nameof(Query)); Page = "search"; _ = RunSearch(s); } });
        SuggestPickCmd = new RelayCommand(p =>
        {
            if (p is not string s) return;
            _suggestCts?.Cancel(); Suggestions.Clear(); Raise(nameof(HasSuggestions));
            _query = s; Raise(nameof(Query));
            _ = RunSearch(s);
        });
        FilterCmd = new RelayCommand(p => { if (p is ChipVM c) { foreach (var x in FilterChips) x.IsOn = x == c; Filter = c.Value; } });

        PlayTrackCmd = new RelayCommand(p => { if (p is TrackVM t) Player.PlayQueue(t.Source, t.Index); });
        LikeCmd = new RelayCommand(p => { if (p is TrackVM t) Library.ToggleLike(t.Track); });
        AddQueueCmd = new RelayCommand(p => { if (p is TrackVM t) Player.AddToQueue(t.Track); });
        PlayNextCmd = new RelayCommand(p => { if (p is TrackVM t) Player.PlayNext(t.Track); });
        DownloadCmd = new RelayCommand(p => { if (p is TrackVM t) { Downloads.Start(t.Track, S.DownloadQuality); Page = "downloads"; } });
        PickerOpenCmd = new RelayCommand(p => { if (p is TrackVM t) PickerTrack = t.Track; });
        PickerCloseCmd = new RelayCommand(() => PickerTrack = null);
        PickPlaylistCmd = new RelayCommand(p => { if (p is PlaylistVM pl && PickerTrack != null) { Library.AddToPlaylist(pl.Id, PickerTrack); PickerTrack = null; } });
        PickerCreateCmd = new RelayCommand(() =>
        {
            if (PickerTrack == null || string.IsNullOrWhiteSpace(NewPlaylistName)) return;
            var pl = Library.CreatePlaylist(NewPlaylistName);
            Library.AddToPlaylist(pl.Id, PickerTrack);
            NewPlaylistName = ""; PickerTrack = null;
        });

        LibTabCmd = new RelayCommand(p => { if (p is ChipVM c) { foreach (var x in LibChips) x.IsOn = x == c; LibTab = c.Value; } });
        CreatePlaylistCmd = new RelayCommand(() => { if (!string.IsNullOrWhiteSpace(NewPlaylistName)) { Library.CreatePlaylist(NewPlaylistName); NewPlaylistName = ""; } });
        OpenPlaylistCmd = new RelayCommand(p => { if (p is PlaylistVM pl) { OpenPlaylistId = pl.Id; RenameText = pl.Name; RefreshOpenPlaylist(); } });
        ClosePlaylistCmd = new RelayCommand(() => { OpenPlaylistId = null; RefreshOpenPlaylist(); });
        DeletePlaylistCmd = new RelayCommand(() => { if (OpenPlaylistId is long id) { Library.DeletePlaylist(id); OpenPlaylistId = null; RefreshOpenPlaylist(); } });
        RenamePlaylistCmd = new RelayCommand(() => { if (OpenPlaylistId is long id) Library.RenamePlaylist(id, RenameText); });
        RemoveFromPlaylistCmd = new RelayCommand(p => { if (p is TrackVM t && OpenPlaylistId is long id) Library.RemoveFromPlaylist(id, t.Track.Id); });
        PlayOpenPlaylistCmd = new RelayCommand(() => { if (OpenTracks.Count > 0) Player.PlayQueue(OpenTracks.Select(t => t.Track).ToList(), 0); });
        PlayLikedCmd = new RelayCommand(() => { if (Liked.Count > 0) Player.PlayQueue(Liked.Select(t => t.Track).ToList(), 0); });
        ClearHistoryCmd = new RelayCommand(() => Library.ClearHistory());

        QueueJumpCmd = new RelayCommand(p => { if (p is QueueItemVM q) Player.JumpTo(q.Index); });
        QueueRemoveCmd = new RelayCommand(p => { if (p is QueueItemVM q) Player.RemoveAt(q.Index); });
        QueueUpCmd = new RelayCommand(p => { if (p is QueueItemVM q) Player.Move(q.Index, -1); });
        QueueDownCmd = new RelayCommand(p => { if (p is QueueItemVM q) Player.Move(q.Index, 1); });
        ClearQueueCmd = new RelayCommand(() => Player.ClearQueue());

        ToggleCmd = new RelayCommand(() => Player.Toggle());
        NextCmd = new RelayCommand(() => Player.Next());
        PrevCmd = new RelayCommand(() => Player.Prev());
        ShuffleCmd = new RelayCommand(() => { S.Shuffle = !S.Shuffle; Raise(nameof(ShuffleOn)); Persist(); });
        RepeatCmd = new RelayCommand(() =>
        {
            S.Repeat = S.Repeat switch { RepeatMode.Off => RepeatMode.All, RepeatMode.All => RepeatMode.One, _ => RepeatMode.Off };
            Raise(nameof(RepeatGlyph)); Raise(nameof(RepeatOn)); Persist();
        });
        ToggleQueueCmd = new RelayCommand(() => QueueOpen = !QueueOpen);
        ToggleExpandedCmd = new RelayCommand(() => Expanded = !Expanded);
        ShowLyricsCmd = new RelayCommand(p => { ShowLyrics = (p as string) == "lyrics"; });

        EqCmd = new RelayCommand(p => { if (p is ChipVM c) { foreach (var x in EqChips) x.IsOn = x == c; S.Eq = c.Value; Persist(); } });
        SleepCmd = new RelayCommand(p =>
        {
            if (p is ChipVM c) { foreach (var x in SleepChips) x.IsOn = x == c; Player.SetSleep(int.Parse(c.Value)); }
        });
        QualityCmd = new RelayCommand(p => { if (p is ChipVM c) { foreach (var x in QualityChips) x.IsOn = x == c; S.DownloadQuality = c.Value; Persist(); } });

        SignInCmd = new RelayCommand(StartSignIn);
        OpenWebView2Cmd = new RelayCommand(() => OpenUrl(WebView2Check.DownloadUrl));
        VerifyCookieCmd = new RelayCommand(() => _ = VerifyCookie());
        SignOutCmd = new RelayCommand(() =>
        {
            S.Cookie = ""; S.AccountName = ""; SettingsStore.Save(S);
            SignInMessage = null; ShowCookieBox = false; _ = RefreshAccount();
        });

        PauseJobCmd = new RelayCommand(p => { if (p is DownloadJobVM j) Downloads.Pause(j); });
        ResumeJobCmd = new RelayCommand(p => { if (p is DownloadJobVM j) Downloads.Resume(j); });
        CancelJobCmd = new RelayCommand(p => { if (p is DownloadJobVM j) Downloads.Cancel(j); });
        ClearFinishedCmd = new RelayCommand(() => Downloads.ClearFinished());
        PlayOfflineCmd = new RelayCommand(p => { if (p is OfflineVM o) Player.PlayQueue(Offline.Select(x => x.D.Track).ToList(), Offline.IndexOf(o)); });
        PlayAllOfflineCmd = new RelayCommand(() => { if (Offline.Count > 0) Player.PlayQueue(Offline.Select(x => x.D.Track).ToList(), 0); });
        DeleteOfflineCmd = new RelayCommand(p => { if (p is OfflineVM o) Library.RemoveDownload(o.D); });
    }

    /* ======================= theme & settings ======================= */
    public ObservableCollection<ThemeCardVM> ThemeCards { get; } = new();
    public ObservableCollection<ChipVM> EqChips { get; } = new();
    public ObservableCollection<ChipVM> SleepChips { get; } = new();
    public ObservableCollection<ChipVM> QualityChips { get; } = new();
    public string ThemeName => ThemeManager.Get(S.Theme).Name;

    private void SetTheme(string id)
    {
        S.Theme = id;
        ThemeManager.Apply(id);
        foreach (var c in ThemeCards) c.IsSelected = c.Id == id;
        Raise(nameof(ThemeName));
        Persist();
    }

    private void Persist() { _persist.Stop(); _persist.Start(); }

    public double Crossfade { get => S.Crossfade; set { S.Crossfade = (int)Math.Round(value); Raise(); Raise(nameof(CrossfadeText)); Persist(); } }
    public string CrossfadeText => S.Crossfade == 0 ? "off" : $"{S.Crossfade}s";
    public bool Gapless { get => S.Gapless; set { S.Gapless = value; Raise(); Persist(); } }
    public bool Normalize { get => S.Normalize; set { S.Normalize = value; Raise(); Raise(nameof(NormalizeOpen)); Persist(); } }
    public bool NormalizeOpen => S.Normalize;
    public double NormStrength { get => S.NormStrength; set { S.NormStrength = (int)Math.Round(value); Raise(); Raise(nameof(NormText)); Persist(); } }
    public string NormText => $"{S.NormStrength}%";
    public double Rate { get => S.Rate; set { S.Rate = Math.Round(value * 4) / 4; Raise(); Raise(nameof(RateText)); Persist(); } }
    public string RateText => $"{S.Rate:0.00}×";
    public double Volume { get => S.Volume; set { S.Volume = (int)Math.Round(value); Raise(); Player.ApplyVolume(); Persist(); } }
    public bool ShuffleOn => S.Shuffle;
    public bool RepeatOn => S.Repeat != RepeatMode.Off;
    public string RepeatGlyph => S.Repeat == RepeatMode.One ? "↻1" : "↻";
    public string HostUrl { get => S.HostUrl; set { S.HostUrl = value; Raise(); Persist(); } }
    public string SleepText => Player.SleepEnd is DateTime d ? $"Pausing in about {Math.Max(1, (int)Math.Ceiling((d - DateTime.Now).TotalMinutes))} min" : "Pause playback after a set time.";

    /* ======================= account ======================= */
    private string? _signInMessage, _cookieInput = "";
    private bool _showCookieBox, _signInBusy;
    public string? SignInMessage { get => _signInMessage; set { if (Set(ref _signInMessage, value)) Raise(nameof(HasSignInMessage)); } }
    public bool HasSignInMessage => !string.IsNullOrEmpty(_signInMessage);
    public bool ShowCookieBox { get => _showCookieBox; set => Set(ref _showCookieBox, value); }
    public string? CookieInput { get => _cookieInput; set => Set(ref _cookieInput, value); }
    public bool SignInBusy { get => _signInBusy; set => Set(ref _signInBusy, value); }
    public bool SignedIn => !string.IsNullOrEmpty(S.Cookie);
    public bool SignedOut => !SignedIn;
    public string AccountText => SignedIn ? $"Signed in{(string.IsNullOrEmpty(S.AccountName) ? "" : " as " + S.AccountName)} · home shows recommendations." : "Not signed in.";
    public string Greeting => SignedIn ? $"Welcome back{(string.IsNullOrEmpty(S.AccountName) ? "" : ", " + S.AccountName)}." : "Welcome to your sound.";
    private bool _webView2Missing;
    public bool WebView2Missing { get => _webView2Missing; set => Set(ref _webView2Missing, value); }

    private void StartSignIn()
    {
        // In-app Google sign-in needs the WebView2 runtime. Detect it first; show a clear message instead of crashing.
        if (!WebView2Check.IsInstalled())
        {
            WebView2Missing = true;
            ShowCookieBox = false;
            SignInMessage = "Microsoft Edge WebView2 Runtime is not installed, so YouTube sign-in is unavailable. Install the runtime with the button below, then try again.";
            return;
        }
        WebView2Missing = false;
        OpenUrl("https://music.youtube.com");
        ShowCookieBox = true;
        SignInMessage = "Sign in on the page that just opened, then copy the Cookie request header from your browser's DevTools (Network tab) and paste it below.";
    }

    private async Task VerifyCookie()
    {
        if (string.IsNullOrWhiteSpace(CookieInput)) { SignInMessage = "Paste the cookie first."; return; }
        SignInBusy = true; SignInMessage = "Verifying session…";
        var (ok, name, err) = await Sources.VerifyCookieAsync(CookieInput!.Trim());
        SignInBusy = false;
        if (!ok) { SignInMessage = err ?? "Could not verify the session."; return; }
        S.Cookie = CookieInput!.Trim(); S.AccountName = name ?? "";
        CookieInput = ""; ShowCookieBox = false; SignInMessage = null;
        SettingsStore.Save(S);
        await RefreshAccount();
    }

    private async Task RefreshAccount()
    {
        foreach (var n in new[] { nameof(SignedIn), nameof(SignedOut), nameof(AccountText), nameof(Greeting) }) Raise(n);
        MadeTracks.Clear();
        Raise(nameof(HasMade));
        if (!SignedIn) return;
        var seed = Library.Data.History.FirstOrDefault() ?? Library.Data.Liked.FirstOrDefault();
        if (seed == null) return;
        MadeTitle = $"More like {seed.Artist}";
        var rel = await Sources.RelatedAsync(seed);
        foreach (var t in Wrap(rel)) MadeTracks.Add(t);
        Raise(nameof(HasMade));
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Program.Log("open url: " + ex.Message); }
    }

    /* ======================= home ======================= */
    public ObservableCollection<TrackVM> Trending { get; } = new();
    public ObservableCollection<TrackVM> Recent { get; } = new();
    public ObservableCollection<TrackVM> MadeTracks { get; } = new();
    private string _madeTitle = "";
    public string MadeTitle { get => _madeTitle; set => Set(ref _madeTitle, value); }
    public bool HasMade => MadeTracks.Count > 0;
    private bool _trendingLoading = true;
    public bool TrendingLoading { get => _trendingLoading; set { Set(ref _trendingLoading, value); Raise(nameof(TrendingEmpty)); } }
    public bool TrendingEmpty => !_trendingLoading && Trending.Count == 0;

    private async Task LoadTrending()
    {
        var list = await Sources.TrendingAsync();
        Trending.Clear();
        foreach (var t in Wrap(list)) Trending.Add(t);
        TrendingLoading = false;
        RefreshFlags();
    }

    /* ======================= search ======================= */
    private string _query = "", _filter = "all", _searchMessage = "";
    private bool _searching;
    public ObservableCollection<ChipVM> FilterChips { get; } = new();
    public ObservableCollection<string> Suggestions { get; } = new();
    public ObservableCollection<TrackVM> Songs { get; } = new();
    public ObservableCollection<TrackVM> LyricHits { get; } = new();
    public ObservableCollection<string> ArtistNames { get; } = new();
    public ObservableCollection<string> AlbumNames { get; } = new();
    public string SearchMessage { get => _searchMessage; set { if (Set(ref _searchMessage, value)) Raise(nameof(HasSearchMessage)); } }
    public bool HasSearchMessage => !string.IsNullOrEmpty(_searchMessage);
    public bool Searching { get => _searching; set => Set(ref _searching, value); }
    public bool HasSuggestions => Suggestions.Count > 0;
    public string Filter { get => _filter; set { if (Set(ref _filter, value)) RaiseFilterFlags(); } }
    public bool ShowSongs => (_filter == "all" || _filter == "songs") && Songs.Count > 0;
    public bool ShowLyricHits => (_filter == "all" || _filter == "lyrics") && LyricHits.Count > 0;
    public bool ShowArtists => (_filter == "all" || _filter == "artists") && ArtistNames.Count > 0;
    public bool ShowAlbums => (_filter == "all" || _filter == "artists") && AlbumNames.Count > 0;
    private void RaiseFilterFlags() { foreach (var n in new[] { nameof(ShowSongs), nameof(ShowLyricHits), nameof(ShowArtists), nameof(ShowAlbums) }) Raise(n); }

    public string Query
    {
        get => _query;
        set { if (Set(ref _query, value)) _ = Typeahead(value); }
    }

    private async Task Typeahead(string q)
    {
        _suggestCts?.Cancel();
        var cts = _suggestCts = new CancellationTokenSource();
        try
        {
            if (q.Trim().Length < 2) { Suggestions.Clear(); Raise(nameof(HasSuggestions)); return; }
            await Task.Delay(300, cts.Token); // debounce
            var list = await Sources.SuggestAsync(q.Trim(), cts.Token);
            if (cts.IsCancellationRequested) return;
            Suggestions.Clear();
            foreach (var s in list) Suggestions.Add(s);
            Raise(nameof(HasSuggestions));
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Program.Log("typeahead: " + ex.Message); }
    }

    private async Task RunSearch(string q)
    {
        q = q.Trim();
        if (q.Length == 0) return;
        _suggestCts?.Cancel(); Suggestions.Clear(); Raise(nameof(HasSuggestions));
        _searchCts?.Cancel();
        var cts = _searchCts = new CancellationTokenSource();
        Searching = true; SearchMessage = "";
        try
        {
            var r = await Sources.SearchAsync(q, cts.Token);
            if (cts.IsCancellationRequested) return;
            Songs.Clear(); LyricHits.Clear(); ArtistNames.Clear(); AlbumNames.Clear();
            foreach (var t in Wrap(r.Songs)) Songs.Add(t);
            foreach (var t in Wrap(r.Lyrics)) LyricHits.Add(t);
            foreach (var a in r.Artists) ArtistNames.Add(a.Name);
            foreach (var a in r.Albums) AlbumNames.Add($"{a.Artist} {a.Title}");
            RaiseFilterFlags();
            RefreshFlags();
            SearchMessage = r.Error ?? (Songs.Count + LyricHits.Count + ArtistNames.Count == 0 ? $"No results for “{q}”." : "");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Program.Log("search: " + ex);
            SearchMessage = SourceClient.NotAvailable;
        }
        finally { if (!cts.IsCancellationRequested) Searching = false; }
    }

    /* ======================= library ======================= */
    public ObservableCollection<ChipVM> LibChips { get; } = new();
    public ObservableCollection<PlaylistVM> Playlists { get; } = new();
    public ObservableCollection<TrackVM> Liked { get; } = new();
    public ObservableCollection<TrackVM> HistoryList { get; } = new();
    public ObservableCollection<TrackVM> OpenTracks { get; } = new();
    public ObservableCollection<OfflineVM> Offline { get; } = new();
    public ObservableCollection<QueueItemVM> QueueItems { get; } = new();
    private string _libTab = "playlists", _newPlaylistName = "", _renameText = "";
    private long? _openPlaylistId;
    private Track? _pickerTrack;
    public string LibTab { get => _libTab; set { if (Set(ref _libTab, value)) RaiseLibFlags(); } }
    public string NewPlaylistName { get => _newPlaylistName; set => Set(ref _newPlaylistName, value); }
    public string RenameText { get => _renameText; set => Set(ref _renameText, value); }
    public long? OpenPlaylistId { get => _openPlaylistId; set { if (Set(ref _openPlaylistId, value)) RaiseLibFlags(); } }
    public Track? PickerTrack { get => _pickerTrack; set { if (Set(ref _pickerTrack, value)) { Raise(nameof(PickerOpen)); Raise(nameof(PickerTitle)); } } }
    public bool PickerOpen => _pickerTrack != null;
    public string PickerTitle => _pickerTrack?.Title ?? "";
    public bool LibPlaylists => _libTab == "playlists" && _openPlaylistId == null;
    public bool LibPlaylistOpen => _openPlaylistId != null;
    public bool LibLiked => _libTab == "liked" && _openPlaylistId == null;
    public bool LibQueue => _libTab == "queue" && _openPlaylistId == null;
    public bool LibHistory => _libTab == "history" && _openPlaylistId == null;
    public bool LibTabsVisible => _openPlaylistId == null;
    public bool NoPlaylists => Playlists.Count == 0;
    public bool NoLiked => Liked.Count == 0;
    public bool NoHistory => HistoryList.Count == 0;
    public bool NoQueue => QueueItems.Count == 0;
    public bool NoOffline => Offline.Count == 0;
    public bool HasRecent => Recent.Count > 0;
    public string LikedCount => $"{Liked.Count} songs";
    public string OpenPlaylistName => Library.Data.Playlists.FirstOrDefault(p => p.Id == _openPlaylistId)?.Name ?? "";
    public string OpenPlaylistCount => $"{OpenTracks.Count} songs";
    public bool OpenEmpty => OpenTracks.Count == 0;

    private void RaiseLibFlags()
    {
        foreach (var n in new[] { nameof(LibPlaylists), nameof(LibPlaylistOpen), nameof(LibLiked), nameof(LibQueue), nameof(LibHistory), nameof(LibTabsVisible), nameof(OpenPlaylistName) }) Raise(n);
    }

    private static List<TrackVM> Wrap(IReadOnlyList<Track> list) => list.Select((t, i) => new TrackVM(t, list, i)).ToList();

    private void RefreshOpenPlaylist()
    {
        OpenTracks.Clear();
        var p = Library.Data.Playlists.FirstOrDefault(x => x.Id == _openPlaylistId);
        if (p != null) foreach (var t in Wrap(p.Tracks.ToList())) OpenTracks.Add(t);
        Raise(nameof(OpenPlaylistCount)); Raise(nameof(OpenEmpty)); Raise(nameof(OpenPlaylistName));
        RefreshFlags();
    }

    private void RefreshLibrary()
    {
        var d = Library.Data;
        Playlists.Clear();
        foreach (var p in d.Playlists) Playlists.Add(new PlaylistVM { Id = p.Id, Name = p.Name, CountText = $"{p.Tracks.Count} songs" });
        Liked.Clear(); foreach (var t in Wrap(d.Liked.ToList())) Liked.Add(t);
        HistoryList.Clear(); foreach (var t in Wrap(d.History.ToList())) HistoryList.Add(t);
        var recent = d.History.GroupBy(t => t.Id).Select(g => g.First()).Take(12).ToList();
        Recent.Clear(); foreach (var t in Wrap(recent)) Recent.Add(t);
        Offline.Clear();
        var offTracks = d.Downloads.Select(x => x.Track).ToList();
        for (var i = 0; i < d.Downloads.Count; i++) Offline.Add(new OfflineVM { D = d.Downloads[i], Item = new TrackVM(d.Downloads[i].Track, offTracks, i) });
        if (_openPlaylistId != null && !d.Playlists.Any(p => p.Id == _openPlaylistId)) _openPlaylistId = null;
        RefreshOpenPlaylist();
        foreach (var n in new[] { nameof(NoPlaylists), nameof(NoLiked), nameof(NoHistory), nameof(NoOffline), nameof(LikedCount), nameof(HasRecent) }) Raise(n);
        RaiseLibFlags();
        RefreshFlags();
    }

    /// <summary>Updates liked / current / offline markers on every visible track row.</summary>
    private void RefreshFlags()
    {
        var curId = Player.Current?.Id;
        foreach (var coll in new[] { Songs, LyricHits, Trending, Recent, MadeTracks, Liked, HistoryList, OpenTracks })
            foreach (var t in coll)
            {
                t.Liked = Library.IsLiked(t.Track.Id);
                t.IsCurrent = t.Track.Id == curId;
                t.Offline = Library.DownloadedPath(t.Track.Id) != null;
            }
    }

    /* ======================= player state ======================= */
    private TrackVM? _current;
    private double _positionSec, _durationSec = 1;
    private string _stateText = "", _playGlyph = "▶", _positionText = "0:00", _durationText = "0:00";
    private bool _seeking;
    private int _lyricIndex = -1;

    public TrackVM? Current { get => _current; private set { if (Set(ref _current, value)) { Raise(nameof(HasCurrent)); Raise(nameof(NoCurrent)); } } }
    public bool HasCurrent => _current != null;
    public bool NoCurrent => _current == null;
    public double PositionSec { get => _positionSec; set => Set(ref _positionSec, value); }
    public double DurationSec { get => _durationSec; set => Set(ref _durationSec, value); }
    public string PositionText { get => _positionText; set => Set(ref _positionText, value); }
    public string DurationText { get => _durationText; set => Set(ref _durationText, value); }
    public string StateText { get => _stateText; set => Set(ref _stateText, value); }
    public string PlayGlyph { get => _playGlyph; set => Set(ref _playGlyph, value); }
    public bool IsLoading => Player.State == PState.Loading;
    public string? PlayerNote => Player.State == PState.Error ? Player.Error : Player.Note;
    public bool HasPlayerNote => !string.IsNullOrEmpty(PlayerNote);
    public string QueueTitle => $"Queue ({Player.Queue.Count})";
    public bool Seeking { get => _seeking; set => _seeking = value; }

    public ObservableCollection<LyricLineVM> Lyrics { get; } = new();
    private string _lyricsPlain = "", _lyricsStatus = "";
    public string LyricsPlain { get => _lyricsPlain; set { Set(ref _lyricsPlain, value); Raise(nameof(HasPlainOnly)); } }
    public string LyricsStatus { get => _lyricsStatus; set { Set(ref _lyricsStatus, value); Raise(nameof(HasLyricsStatus)); } }
    public bool HasLyricsStatus => !string.IsNullOrEmpty(_lyricsStatus);
    public bool HasPlainOnly => Lyrics.Count == 0 && !string.IsNullOrEmpty(_lyricsPlain);
    public int LyricIndex { get => _lyricIndex; private set { if (Set(ref _lyricIndex, value)) LyricIndexChanged?.Invoke(value); } }
    public event Action<int>? LyricIndexChanged;

    public void CommitSeek(double sec) { Player.SeekMs((long)(sec * 1000)); _seeking = false; }

    private static string Fmt(long ms) { var s = Math.Max(0, ms) / 1000; return $"{s / 60}:{s % 60:00}"; }

    private void OnPlayerChanged()
    {
        var t = Player.Current;
        if (t?.Id != _lastCurrentId)
        {
            _lastCurrentId = t?.Id;
            Current = t == null ? null : new TrackVM(t, Player.Queue.ToList(), Player.Index);
            RefreshFlags();
            _ = LoadLyrics(t);
        }
        if (Player.QueueVersion != _lastQueueVersion)
        {
            _lastQueueVersion = Player.QueueVersion;
            QueueItems.Clear();
            var q = Player.Queue.ToList();
            for (var i = 0; i < q.Count; i++) QueueItems.Add(new QueueItemVM { Item = new TrackVM(q[i], q, i), Index = i, IsCurrent = i == Player.Index });
            Raise(nameof(NoQueue)); Raise(nameof(QueueTitle));
        }
        var dur = Player.DurationMs > 0 ? Player.DurationMs : (t?.Duration ?? 0) * 1000L;
        DurationSec = Math.Max(1, dur / 1000.0);
        DurationText = Fmt(dur);
        if (!_seeking) { PositionSec = Player.PositionMs / 1000.0; PositionText = Fmt(Player.PositionMs); }
        PlayGlyph = Player.State == PState.Playing ? "⏸" : "▶";
        StateText = Player.State switch
        {
            PState.Loading => "Loading…",
            PState.Playing => "Playing",
            PState.Paused => "Paused",
            PState.Error => "Error",
            PState.Stopped => "Stopped",
            _ => "Idle",
        };
        Raise(nameof(IsLoading)); Raise(nameof(PlayerNote)); Raise(nameof(HasPlayerNote)); Raise(nameof(SleepText));
        UpdateLyricHighlight();
    }

    private async Task LoadLyrics(Track? t)
    {
        Lyrics.Clear(); LyricsPlain = ""; LyricIndex = -1; Raise(nameof(HasPlainOnly));
        if (t == null) { LyricsStatus = ""; return; }
        _lyricsFor = t.Id;
        LyricsStatus = "Looking for lyrics…";
        var data = await Sources.LyricsAsync(t);
        if (_lyricsFor != t.Id) return;
        foreach (var l in data.Synced) Lyrics.Add(new LyricLineVM { T = l.T, Text = string.IsNullOrEmpty(l.Text) ? "♪" : l.Text });
        LyricsPlain = data.Plain;
        LyricsStatus = Lyrics.Count == 0 && string.IsNullOrEmpty(data.Plain) ? "No lyrics found for this track." : "";
        Raise(nameof(HasPlainOnly));
    }

    private void UpdateLyricHighlight()
    {
        if (Lyrics.Count == 0) return;
        var pos = Player.PositionMs / 1000.0 + 0.25;
        var idx = -1;
        for (var i = 0; i < Lyrics.Count; i++) { if (Lyrics[i].T <= pos) idx = i; else break; }
        if (idx == _lyricIndex) return;
        if (_lyricIndex >= 0 && _lyricIndex < Lyrics.Count) Lyrics[_lyricIndex].IsCurrent = false;
        if (idx >= 0) Lyrics[idx].IsCurrent = true;
        LyricIndex = idx;
    }

    public bool HasJobs => Downloads.Jobs.Count > 0;
    public bool NoJobs => Downloads.Jobs.Count == 0;

    public void Dispose()
    {
        SettingsStore.Save(S);
        Player.Dispose();
    }
}
