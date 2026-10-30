using System.Net;
using System.Text;
using TheMashup.Core;
using TheMashup.UI;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class SearchViewModelTests
{
    private static CatalogTrack Track(string id = "one", string title = "First song") =>
        new() { Id = id, Source = "ytmusic", Title = title, Artist = "Artist", DurationSeconds = 180 };
    private static CatalogSearchResult Catalog(params CatalogTrack[] tracks) =>
        new() { Tracks = tracks, Artists = [], Albums = [], Warnings = [] };
    private static LyricSearchResult LyricHits(params LyricSearchHit[] hits) => new() { Hits = hits, Source = "genius", Warnings = [] };
    private static TaskCompletionSource<T> Completion<T>() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    [Fact]
    public async Task SuggestionsAreDebouncedAndDoNotCreateAQueue()
    {
        var service = new FakeService { Suggest = (q, _) => Task.FromResult(new SuggestionResult { Suggestions = [$"{q} song"] }) };
        var library = new Library(new MemoryStore());
        using var model = new SearchViewModel(service, library);
        model.Query = "fir";
        await model.PendingSuggestions;
        Assert.Single(model.Suggestions);
        Assert.Equal("fir song", model.Suggestions[0].Text);
        Assert.Empty(library.Queue);
        Assert.Equal(-1, library.CurrentQueueIndex);
    }

    [Fact]
    public async Task SearchBranchesLoadIndependentlyAndErrorsDoNotHideSongs()
    {
        var catalog = Completion<CatalogSearchResult>();
        var lyrics = Completion<LyricSearchResult>();
        var service = new FakeService { Search = (_, _) => catalog.Task, SearchLyrics = (_, _) => lyrics.Task };
        using var model = new SearchViewModel(service, new Library(new MemoryStore()));
        model.Query = "a remembered line";
        var pending = model.SubmitAsync();
        Assert.True(model.CatalogLoading);
        Assert.True(model.LyricSearchLoading);
        catalog.SetResult(Catalog(Track()));
        await WaitUntil(() => !model.CatalogLoading);
        Assert.Single(model.Tracks);
        Assert.True(model.LyricSearchLoading);
        lyrics.SetException(new SearchProviderException("Lyric provider unavailable"));
        await pending;
        Assert.Single(model.Tracks);
        Assert.Contains("unavailable", model.LyricSearchStatus, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.LyricSearchLoading);
    }

    [Fact]
    public async Task LateResultsFromPreviousInputCannotOverwriteCurrentSearch()
    {
        var old = Completion<CatalogSearchResult>();
        var newer = Completion<CatalogSearchResult>();
        var service = new FakeService { Search = (q, _) => q == "old" ? old.Task : newer.Task };
        using var model = new SearchViewModel(service, new Library(new MemoryStore()));
        model.Query = "old";
        var first = model.SubmitAsync();
        model.Query = "new";
        var second = model.SubmitAsync();
        newer.SetResult(Catalog(Track("new-id", "New song")));
        await second;
        old.SetResult(Catalog(Track("old-id", "Old song"))); // deliberately ignores cancellation
        await first;
        Assert.Equal("New song", Assert.Single(model.Tracks).Title);
        Assert.False(model.CatalogLoading);
    }

    [Fact]
    public async Task LateLyricTextCannotReplaceTheLastSelectedSong()
    {
        var old = Completion<LyricDocument?>();
        var newer = Completion<LyricDocument?>();
        var service = new FakeService { GetLyrics = (track, _) => track.Id == "old" ? old.Task : newer.Task };
        using var model = new SearchViewModel(service, new Library(new MemoryStore()));
        var first = model.OpenLyricsAsync(Track("old", "Old"));
        var second = model.OpenLyricsAsync(Track("new", "New"));
        newer.SetResult(new LyricDocument { Plain = "new words", Provider = "lrclib" });
        await second;
        old.SetResult(new LyricDocument { Plain = "old words", Provider = "lrclib" });
        await first;
        Assert.Equal("new words", model.LyricsText);
        Assert.StartsWith("New", model.LyricsTitle);
    }

    [Fact]
    public async Task SearchDoesNotCreateAQueueAndExplicitQueueAddsOnlyOneSong()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        Assert.True(library.CreatePlaylist("Favorites", out var playlistId));
        var service = new FakeService { Search = (_, _) => Task.FromResult(Catalog(Track(), Track("two", "Second song"))) };
        using var model = new SearchViewModel(service, library);
        model.Query = "song";
        await model.SubmitAsync();
        Assert.Empty(library.Queue);
        Assert.Empty(library.History);
        var first = model.Tracks[0];
        first.QueueCommand.Execute(null);
        Assert.Equal("one", Assert.Single(library.Queue).Id);
        Assert.Equal(-1, library.CurrentQueueIndex); // no playback
        Assert.Empty(library.History);
        first.LikeCommand.Execute(null);
        Assert.Equal("one", Assert.Single(library.LikedTracks).Id);
        first.PlaylistCommand.Execute(null);
        Assert.Equal("Favorites", model.SelectedPlaylist?.Name);
        model.AddToPlaylistCommand.Execute(null);
        Assert.Equal("one", Assert.Single(library.Playlists.Single(p => p.Id == playlistId).Tracks).Id);
        var row = new PlaylistRowViewModel(library, library.Playlists.Single());
        row.ToggleSongsCommand.Execute(null);
        Assert.True(row.IsExpanded);
        Assert.Equal("First song", Assert.Single(row.Songs).Title);
        var restored = new Library(store);
        Assert.Equal("one", Assert.Single(restored.Queue).Id);
        Assert.Equal("one", Assert.Single(restored.LikedTracks).Id);
        Assert.Equal("one", Assert.Single(restored.Playlists[0].Tracks).Id);
    }

    [Fact]
    public async Task UnmatchedLyricCandidateNeverReceivesAQueueableTrack()
    {
        var hit = new LyricSearchHit { Title = "Found title", Artist = "Found artist", Snippet = "remembered words", Track = null };
        var service = new FakeService { SearchLyrics = (_, _) => Task.FromResult(LyricHits(hit)) };
        var library = new Library(new MemoryStore());
        using var model = new SearchViewModel(service, library);
        model.Query = "remembered words";
        await model.SubmitAsync();
        var row = Assert.Single(model.LyricHits);
        Assert.True(row.IsUnmatched);
        row.QueueCommand.Execute(null);
        Assert.Empty(library.Queue);
    }

    [Fact]
    public async Task GatewayUsesTheProvidedOriginAndDistinguishesMissingLyricsFromFailures()
    {
        var paths = new List<Uri>();
        var handler = new StubHandler(request =>
        {
            paths.Add(request.RequestUri!);
            if (request.RequestUri!.AbsolutePath.EndsWith("by-metadata"))
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"tracks\":[{\"id\":\"id\",\"title\":\"Song\",\"artist_names\":\"Artist\",\"source\":\"ytmusic\"}],\"artists\":[],\"albums\":[],\"warnings\":[]}", Encoding.UTF8, "application/json"),
            };
        });
        var client = new GatewaySearchClient(new HttpClient(handler), _ => Task.FromResult(new Uri("https://preview.example/")));
        var found = await client.SearchAsync("a & b", CancellationToken.None);
        Assert.Equal("Song", Assert.Single(found.Tracks!).Title);
        Assert.Equal("preview.example", paths[0].Host);
        Assert.Contains("a%20%26%20b", paths[0].Query);
        Assert.Null(await client.GetLyricsAsync(Track(), CancellationToken.None));
        Assert.All(paths, uri => Assert.Equal("https", uri.Scheme));
    }

    [Fact]
    public async Task GatewayRejectsIncompleteSuccessfulResponses()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
        var client = new GatewaySearchClient(new HttpClient(handler), _ => Task.FromResult(new Uri("https://preview.example/")));
        await Assert.ThrowsAsync<SearchProviderException>(() => client.SearchAsync("song", CancellationToken.None));
    }

    private static async Task WaitUntil(Func<bool> predicate)
    {
        for (var i = 0; i < 200 && !predicate(); i++) await Task.Delay(5);
        Assert.True(predicate(), "The expected asynchronous state did not arrive.");
    }
    private sealed class MemoryStore : ILibraryStore
    {
        public string? Value { get; private set; }
        public LibraryReadResult Read() => new(true, Value);
        public bool TryWrite(string content) { Value = content; return true; }
    }
    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(send(request));
    }
    private sealed class FakeService : ISearchService
    {
        public Func<string, CancellationToken, Task<CatalogSearchResult>> Search { get; set; } = (_, _) => Task.FromResult(Catalog());
        public Func<string, CancellationToken, Task<SuggestionResult>> Suggest { get; set; } = (_, _) => Task.FromResult(new SuggestionResult { Suggestions = [] });
        public Func<string, CancellationToken, Task<LyricSearchResult>> SearchLyrics { get; set; } = (_, _) => Task.FromResult(LyricHits());
        public Func<CatalogTrack, CancellationToken, Task<LyricDocument?>> GetLyrics { get; set; } = (_, _) => Task.FromResult<LyricDocument?>(null);
        public Task<CatalogSearchResult> SearchAsync(string query, CancellationToken cancellationToken) => Search(query, cancellationToken);
        public Task<SuggestionResult> SuggestAsync(string query, CancellationToken cancellationToken) => Suggest(query, cancellationToken);
        public Task<LyricSearchResult> SearchLyricsAsync(string query, CancellationToken cancellationToken) => SearchLyrics(query, cancellationToken);
        public Task<LyricDocument?> GetLyricsAsync(CatalogTrack track, CancellationToken cancellationToken) => GetLyrics(track, cancellationToken);
    }
}
