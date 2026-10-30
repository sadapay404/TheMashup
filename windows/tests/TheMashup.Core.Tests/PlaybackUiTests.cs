using TheMashup.Core;
using TheMashup.UI;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class PlaybackUiTests
{
    [Fact]
    public async Task SearchPlayAndQueueButtonsHaveDifferentEffectsAndLyricsFollowThePlayer()
    {
        var library = new Library(new Store());
        var device = new Device();
        using var player = new PlayerViewModel(library, new Resolver(), device);
        using var search = new SearchViewModel(new Search(), library, player);
        search.Query = "song";
        await search.SubmitAsync();
        Assert.Empty(library.Queue);
        var first = search.Tracks[0];
        var second = search.Tracks[1];
        first.QueueCommand.Execute(null);
        Assert.Equal("first000001", Assert.Single(library.Queue).Id);
        Assert.Equal(0, device.OpenCount);
        second.PlayCommand.Execute(null);
        Assert.Equal(new[] { "second00001", "first000001" }, library.Queue.Select(track => track.Id));
        Assert.Equal(1, device.OpenCount);
        Assert.Empty(library.History);
        device.Send(MediaSignal.Playing);
        Assert.Single(library.History);
        Assert.False(search.QueuedTracks[0].CanRemove); // current song cannot be removed under a live player
        Assert.True(search.QueuedTracks[1].CanRemove);
        await search.OpenLyricsAsync(new CatalogTrack { Id = "second00001", Source = "ytmusic", Title = "Second", Artist = "Artist" });
        device.Send(MediaSignal.Time, 12, 180);
        Assert.Equal("second line", search.ActiveLyric);
        device.Send(MediaSignal.Time, 3, 180);
        Assert.Equal("first line", search.ActiveLyric); // seeking backward
        Assert.True(search.HasActiveLyric);
        search.CloseLyricsCommand.Execute(null);
        Assert.False(search.HasActiveLyric);
    }
    private sealed class Store : ILibraryStore
    {
        public LibraryReadResult Read() => new(true, null);
        public bool TryWrite(string content) => true;
    }
    private sealed class Resolver : IPlaybackResolver
    {
        public Task<PlaybackResolution> ResolveAsync(string id, PlaybackMode mode, string after, bool refresh, CancellationToken ct) =>
            Task.FromResult(new PlaybackResolution([new PlaybackCandidate(new Uri("https://preview.example/api/playback/stream/aaaaaaaaaaaaaaaaaaaaaaaa"), "ytdlp", false, "test")], false));
    }
    private sealed class Device : IMediaDevice
    {
        private long _attempt;
        public int OpenCount { get; private set; }
        public event EventHandler<MediaDeviceEvent>? Changed;
        public void Open(PlaybackCandidate candidate, PlaybackMode mode, long attempt, double resumeAtSeconds) { _attempt = attempt; OpenCount++; }
        public void Send(MediaSignal signal, double position = 0, double duration = 0) => Changed?.Invoke(this, new MediaDeviceEvent(_attempt, signal, position, duration));
        public void Play() { }
        public void Pause() { }
        public void Stop() { }
        public void Seek(double seconds) { }
        public void SetVolume(double volume) { }
        public void Dispose() { }
    }
    private sealed class Search : ISearchService
    {
        public Task<CatalogSearchResult> SearchAsync(string query, CancellationToken ct) => Task.FromResult(new CatalogSearchResult
        {
            Tracks = [Track("first000001", "First"), Track("second00001", "Second")], Artists = [], Albums = [], Warnings = [],
        });
        public Task<SuggestionResult> SuggestAsync(string query, CancellationToken ct) => Task.FromResult(new SuggestionResult { Suggestions = [] });
        public Task<LyricSearchResult> SearchLyricsAsync(string query, CancellationToken ct) => Task.FromResult(new LyricSearchResult { Hits = [] });
        public Task<LyricDocument?> GetLyricsAsync(CatalogTrack track, CancellationToken ct) => Task.FromResult<LyricDocument?>(new LyricDocument
        {
            Synced = [new TimedLyricLine { Time = 0, Text = "first line" }, new TimedLyricLine { Time = 10, Text = "second line" }], Provider = "test",
        });
        private static CatalogTrack Track(string id, string title) => new() { Id = id, Source = "ytmusic", Title = title, Artist = "Artist" };
    }
}
