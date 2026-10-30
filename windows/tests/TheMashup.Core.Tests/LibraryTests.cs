using TheMashup.Core;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class LibraryTests
{
    private static LibraryTrack Track(string id) => new("youtube", id, $"Song {id}", "An artist", 180);

    [Fact]
    public void PlaylistsPersistRenameDeleteAndDoNotDeleteLikes()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        Assert.True(library.CreatePlaylist("  Late night  ", out var id));
        Assert.NotNull(id);
        Assert.True(library.AddToPlaylist(id!, Track("one")));
        Assert.True(library.AddToPlaylist(id!, Track("one"))); // explicit duplicates are allowed
        Assert.True(library.SetLiked(Track("one"), true));
        Assert.True(library.RenamePlaylist(id!, " Favorites "));

        var restored = new Library(store);
        var playlist = Assert.Single(restored.Playlists);
        Assert.Equal("Favorites", playlist.Name);
        Assert.Equal(2, playlist.Tracks.Count);
        Assert.True(restored.IsLiked(Track("one")));
        Assert.True(restored.DeletePlaylist(id!));
        Assert.Empty(new Library(store).Playlists);
        Assert.True(new Library(store).IsLiked(Track("one")));
    }

    [Fact]
    public void InvalidPlaylistNamesNeverWriteOrCreateRows()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        Assert.False(library.CreatePlaylist("  ", out _));
        Assert.False(library.CreatePlaylist(new string('x', Library.MaxPlaylistNameLength + 1), out _));
        Assert.Null(store.Content);
        Assert.Empty(library.Playlists);
        Assert.True(library.CreatePlaylist("First", out var id));
        Assert.False(library.RenamePlaylist(id!, "\t"));
        Assert.Equal("First", Assert.Single(new Library(store).Playlists).Name);
    }

    [Fact]
    public void LikesAreUniqueBySourceAndIdAndPersistAcrossInstances()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        var song = Track("one");
        Assert.True(library.SetLiked(song, true));
        Assert.True(library.SetLiked(song with { Title = "Updated title" }, true));
        Assert.Single(library.LikedTracks);
        Assert.True(new Library(store).IsLiked(song));
        Assert.True(library.SetLiked(song, false));
        Assert.Empty(new Library(store).LikedTracks);
    }

    [Fact]
    public void PlayFromSearchPreservesCurrentImmediatelyBehindAndDoesNotAddOtherResults()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        var old = Track("old");
        var chosen = Track("chosen");
        var queued = Track("queued");
        Assert.True(library.PlayNow(old));
        Assert.True(library.AddToQueue(queued));
        Assert.True(library.PlayNow(chosen));
        Assert.Equal(new[] { "chosen", "old", "queued" }, library.Queue.Select(song => song.Id));
        Assert.Equal("chosen", library.CurrentTrack!.Id);
        Assert.Equal(0, library.CurrentQueueIndex);
        Assert.True(library.PlayNow(chosen));
        Assert.Equal(3, library.Queue.Count);
        var restored = new Library(store);
        Assert.Equal(new[] { "chosen", "old", "queued" }, restored.Queue.Select(song => song.Id));
        Assert.Equal("chosen", restored.CurrentTrack!.Id);
    }

    [Fact]
    public void AddToQueueAddsOnlyOneAndNeverStartsOrInterruptsPlayback()
    {
        var library = new Library(new MemoryStore());
        Assert.True(library.AddToQueue(Track("queued")));
        Assert.Null(library.CurrentTrack);
        Assert.Equal(-1, library.CurrentQueueIndex);
        Assert.Equal(new[] { "queued" }, library.Queue.Select(song => song.Id));
        Assert.True(library.PlayNow(Track("current")));
        Assert.True(library.AddToQueue(Track("later")));
        Assert.Equal("current", library.CurrentTrack!.Id);
        Assert.Equal(new[] { "current", "queued", "later" }, library.Queue.Select(song => song.Id));
        Assert.True(library.RemoveFromQueue(0));
        Assert.Null(library.CurrentTrack); // removal never silently starts another track
        Assert.Equal(new[] { "queued", "later" }, library.Queue.Select(song => song.Id));
    }

    [Fact]
    public void HistoryIsExplicitNewestFirstBoundedAndPersistent()
    {
        var store = new MemoryStore();
        var library = new Library(store);
        Assert.Empty(library.History); // selecting/queuing is not proof of playback
        Assert.True(library.PlayNow(Track("selected")));
        Assert.Empty(library.History);
        for (var i = 0; i < Library.MaxHistoryEntries + 2; i++)
            Assert.True(library.RecordPlay(Track(i.ToString()), DateTimeOffset.UnixEpoch.AddSeconds(i)));
        Assert.Equal(Library.MaxHistoryEntries, library.History.Count);
        Assert.Equal((Library.MaxHistoryEntries + 1).ToString(), library.History[0].Track!.Id);
        Assert.Equal("2", library.History[^1].Track!.Id);
        var restored = new Library(store);
        Assert.Equal(Library.MaxHistoryEntries, restored.History.Count);
        Assert.True(restored.ClearHistory());
        Assert.Empty(new Library(store).History);
    }

    [Fact]
    public void LegacyUnversionedCollectionsMigrateWithoutLosingPlaylists()
    {
        var store = new MemoryStore
        {
            Content = """{"playlists":[{"id":"old-id","name":"Old list","tracks":[]}],"likedTracks":[],"history":[]}"""
        };
        var library = new Library(store);
        Assert.Equal(LibraryLoadStatus.Ready, library.LoadStatus);
        Assert.Equal("Old list", Assert.Single(library.Playlists).Name);
        Assert.True(library.RenamePlaylist("old-id", "Updated"));
        Assert.Contains("\"schemaVersion\":1", store.Content);
        Assert.Equal("Updated", Assert.Single(new Library(store).Playlists).Name);
    }

    [Theory]
    [InlineData("not json", LibraryLoadStatus.Invalid)]
    [InlineData("{}", LibraryLoadStatus.Invalid)]
    [InlineData("{\"schemaVersion\":1,\"playlists\":[]}", LibraryLoadStatus.Invalid)]
    [InlineData("{\"schemaVersion\":99,\"future\":true}", LibraryLoadStatus.NewerVersion)]
    [InlineData("{\"schemaVersion\":1,\"playlists\":null}", LibraryLoadStatus.Invalid)]
    [InlineData("{\"schemaVersion\":1,\"unrecognizedData\":true}", LibraryLoadStatus.Invalid)]
    [InlineData("{\"schemaVersion\":1,\"queue\":{\"items\":[],\"currentIndex\":0}}", LibraryLoadStatus.Invalid)]
    public void DamagedOrNewerLibrariesAreNeverOverwritten(string original, LibraryLoadStatus expected)
    {
        var store = new MemoryStore { Content = original };
        var library = new Library(store);
        Assert.Equal(expected, library.LoadStatus);
        Assert.False(library.CanEdit);
        Assert.False(library.CreatePlaylist("Would overwrite", out _));
        Assert.Equal(original, store.Content);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public void UnavailableReadDoesNotAllowOverwritingExistingData()
    {
        var store = new MemoryStore { Content = "original", FailRead = true };
        var library = new Library(store);
        Assert.Equal(LibraryLoadStatus.Unavailable, library.LoadStatus);
        Assert.False(library.CreatePlaylist("Name", out _));
        Assert.Equal("original", store.Content);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public void UnreadableLibraryStillAllowsAnEphemeralQueueWithoutOverwritingData()
    {
        var store = new MemoryStore { Content = "broken content" };
        var library = new Library(store);
        Assert.False(library.CanEdit);
        Assert.True(library.PlayNow(Track("current")));
        Assert.True(library.AddToQueue(Track("next")));
        Assert.Equal("current", library.CurrentTrack!.Id);
        Assert.Equal(new[] { "current", "next" }, library.Queue.Select(item => item.Id));
        Assert.False(library.LastWriteSucceeded);
        Assert.Equal("broken content", store.Content);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public void FailedWriteIsReportedAndLaterSuccessPersistsPendingChanges()
    {
        var store = new MemoryStore { FailWrite = true };
        var library = new Library(store);
        Assert.True(library.CreatePlaylist("First", out _));
        Assert.False(library.LastWriteSucceeded);
        Assert.Null(store.Content);
        store.FailWrite = false;
        Assert.True(library.CreatePlaylist("Second", out _));
        Assert.True(library.LastWriteSucceeded);
        Assert.Equal(new[] { "First", "Second" }, new Library(store).Playlists.Select(p => p.Name));
    }

    [Fact]
    public void AtomicFileStoreRoundTripsAndCleansUpFailedReplacement()
    {
        var root = Path.Combine(Path.GetTempPath(), $"themashup-library-tests-{Guid.NewGuid():N}");
        try
        {
            var path = Path.Combine(root, "nested", "library.json");
            var library = new Library(new FileLibraryStore(path));
            Assert.True(library.CreatePlaylist("Saved", out _));
            Assert.Equal("Saved", Assert.Single(new Library(new FileLibraryStore(path)).Playlists).Name);
            Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(path)!, ".library-*.tmp"));
            var occupiedByDirectory = Path.Combine(root, "occupied");
            Directory.CreateDirectory(occupiedByDirectory);
            Assert.False(new FileLibraryStore(occupiedByDirectory).TryWrite("{}"));
            Assert.True(Directory.Exists(occupiedByDirectory));
            Assert.Empty(Directory.GetFiles(root, ".library-*.tmp"));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    private sealed class MemoryStore : ILibraryStore
    {
        public string? Content { get; set; }
        public bool FailRead { get; set; }
        public bool FailWrite { get; set; }
        public int Writes { get; private set; }
        public LibraryReadResult Read() => new(!FailRead, FailRead ? null : Content);
        public bool TryWrite(string content)
        {
            Writes++;
            if (FailWrite) return false;
            Content = content;
            return true;
        }
    }
}
