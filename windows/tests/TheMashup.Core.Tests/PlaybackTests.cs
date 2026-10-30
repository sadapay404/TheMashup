using TheMashup.Core;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class PlaybackTests
{
    private static LibraryTrack Track(string id) => new("youtube", id, $"Song {id}", "Artist", 180);
    private static PlaybackCandidate Candidate(string source, string suffix, bool video = false) =>
        new(new Uri($"https://preview.example/api/playback/stream/{suffix.PadRight(24, 'x')}"), source, video, "test");
    private static PlaybackResolution Batch(params PlaybackCandidate[] candidates) => new(candidates, false);

    [Fact]
    public async Task SearchPlayPreservesPreviousSongAndQueueButtonOnlyAddsOne()
    {
        var library = new Library(new MemoryStore());
        var device = new FakeDevice();
        var resolver = new FakeResolver((_, _, _, _) => Task.FromResult(Batch(Candidate("ytdlp", "first"))));
        using var player = new PlaybackController(library, resolver, device);
        var previous = Track("previous001");
        var selected = Track("selected001");
        var queued = Track("queued00001");
        await player.PlayNowAsync(previous);
        Assert.Empty(library.History);
        device.Emit(MediaSignal.Playing);
        Assert.Single(library.History);
        library.AddToQueue(queued);
        Assert.Equal(previous, library.CurrentTrack);
        Assert.Single(device.Opened);
        await player.PlayNowAsync(selected);
        Assert.Equal(new[] { selected, previous, queued }, library.Queue);
        Assert.Equal(0, library.CurrentQueueIndex);
        Assert.Single(library.History); // opening is not confirmed playback
        device.Emit(MediaSignal.Playing);
        Assert.Equal(new[] { selected, previous }, library.History.Select(entry => entry.Track));
        Assert.Equal(2, device.Opened.Count);
    }

    [Fact]
    public async Task SameSongReplayReusesCanonicalQueueEntryAndDoesNotStopOnHistoryWrite()
    {
        var library = new Library(new MemoryStore());
        var original = Track("same0000001");
        library.PlayNow(original);
        var device = new FakeDevice();
        using var player = new PlaybackController(library, Primary(), device);
        await player.PlayNowAsync(Track("same0000001"));
        device.Emit(MediaSignal.Playing);
        Assert.Single(library.Queue);
        Assert.Equal(PlaybackState.Playing, player.State);
        Assert.Same(original, player.Track);
    }

    [Fact]
    public async Task FailoverTriesEachCandidateThenPipedThenInvidiousWithResume()
    {
        var library = new Library(new MemoryStore());
        var device = new FakeDevice();
        var resolver = new FakeResolver((_, _, after, _) => Task.FromResult(after switch
        {
            "" => Batch(Candidate("ytdlp", "a"), Candidate("ytdlp", "b")),
            "ytdlp" => Batch(Candidate("piped", "c")),
            "piped" => Batch(Candidate("invidious", "d")),
            _ => throw new PlaybackProviderException("no more"),
        }));
        using var player = new PlaybackController(library, resolver, device);
        await player.PlayNowAsync(Track("failover001"));
        device.Emit(MediaSignal.Playing);
        device.Emit(MediaSignal.Time, 42, 180);
        var originalAttempt = device.Attempt;
        device.Emit(MediaSignal.Failed);
        Assert.Equal("ytdlp", device.Opened[^1].Candidate.Source);
        Assert.Equal(42, device.Opened[^1].ResumeAt);
        device.Emit(MediaSignal.Failed);
        Assert.Equal("piped", device.Opened[^1].Candidate.Source);
        device.Emit(MediaSignal.Failed);
        Assert.Equal("invidious", device.Opened[^1].Candidate.Source);
        Assert.Equal(new[] { "", "ytdlp", "piped" }, resolver.Calls.Select(c => c.After));
        device.Emit(MediaSignal.Playing);
        Assert.Single(library.History); // same listening session, not a new song
        device.EmitFor(originalAttempt, MediaSignal.Ended);
        Assert.Equal(PlaybackState.Playing, player.State); // stale callback ignored
    }

    [Fact]
    public async Task DeadQueueTraversalIsFiniteEvenWhenRepeatAllIsEnabled()
    {
        var library = new Library(new MemoryStore());
        library.AddToQueue(Track("dead0000001"));
        library.AddToQueue(Track("dead0000002"));
        var resolver = new FakeResolver((_, _, _, _) => throw new PlaybackProviderException("unavailable"));
        using var player = new PlaybackController(library, resolver, new FakeDevice());
        player.CycleRepeat();
        await player.PlayQueueItemAsync(0);
        Assert.Equal(2, resolver.Calls.Count);
        Assert.Equal(PlaybackState.Error, player.State);
        Assert.Equal(2, library.Queue.Count);
        Assert.Empty(library.History);
    }

    [Fact]
    public async Task VideoFailureFallsBackToRealAudioWithoutClaimingVideo()
    {
        var library = new Library(new MemoryStore());
        var device = new FakeDevice();
        var resolver = new FakeResolver((_, mode, _, _) => mode == PlaybackMode.Video
            ? throw new PlaybackProviderException("no progressive video")
            : Task.FromResult(Batch(Candidate("ytdlp", "audio"))));
        using var player = new PlaybackController(library, resolver, device);
        await player.PlayNowAsync(Track("video000001"), PlaybackMode.Video);
        Assert.Equal(PlaybackMode.Audio, player.Mode);
        Assert.False(device.Opened.Single().Candidate.HasVideo);
        device.Emit(MediaSignal.Playing);
        Assert.Contains("Video is unavailable", player.Status);
        Assert.Single(library.Queue);
    }

    [Fact]
    public async Task EndOfTrackAdvancesOnlyTheExistingQueueAndRepeatOneRestarts()
    {
        var library = new Library(new MemoryStore());
        library.AddToQueue(Track("first000001"));
        library.AddToQueue(Track("second00001"));
        var device = new FakeDevice();
        using var player = new PlaybackController(library, Primary(), device);
        await player.PlayQueueItemAsync(0);
        device.Emit(MediaSignal.Playing);
        device.Emit(MediaSignal.Ended);
        Assert.Equal(1, library.CurrentQueueIndex);
        Assert.Equal(2, library.Queue.Count);
        device.Emit(MediaSignal.Playing);
        player.CycleRepeat(); // all
        player.CycleRepeat(); // one
        device.Emit(MediaSignal.Ended);
        Assert.Equal(1, library.CurrentQueueIndex);
        Assert.Equal(0, device.LastSeek);
        Assert.Equal(1, device.PlayCalls);
        device.Emit(MediaSignal.Playing);
        Assert.Equal(3, library.History.Count);
    }

    [Fact]
    public async Task ShuffleWithoutRepeatVisitsEachExistingQueuePositionAtMostOnce()
    {
        var library = new Library(new MemoryStore());
        for (var i = 0; i < 4; i++) library.AddToQueue(Track($"shuffle000{i}"));
        var device = new FakeDevice();
        using var player = new PlaybackController(library, Primary(), device, new Random(5));
        player.ToggleShuffle();
        await player.PlayQueueItemAsync(0);
        var visited = new HashSet<int> { library.CurrentQueueIndex };
        for (var i = 0; i < 3; i++)
        {
            await player.NextAsync();
            Assert.True(visited.Add(library.CurrentQueueIndex));
        }
        var last = library.CurrentQueueIndex;
        await player.NextAsync();
        Assert.Equal(last, library.CurrentQueueIndex);
        Assert.Equal(4, library.Queue.Count);
    }

    [Fact]
    public async Task NewSelectionWinsOverLateResolverReplyAndLateMediaEvents()
    {
        var first = new TaskCompletionSource<PlaybackResolution>(TaskCreationOptions.RunContinuationsAsynchronously);
        var resolver = new FakeResolver((id, _, _, _) => id == "slow0000001" ? first.Task : Task.FromResult(Batch(Candidate("ytdlp", "fast"))));
        var device = new FakeDevice();
        using var player = new PlaybackController(new Library(new MemoryStore()), resolver, device);
        var pending = player.PlayNowAsync(Track("slow0000001"));
        await player.PlayNowAsync(Track("fast0000001"));
        var currentAttempt = device.Attempt;
        first.SetResult(Batch(Candidate("ytdlp", "slow")));
        await pending;
        Assert.Single(device.Opened);
        Assert.Equal("fast0000001", player.Track?.Id);
        device.EmitFor(currentAttempt - 1, MediaSignal.Ended);
        Assert.Equal("fast0000001", player.Track?.Id);
    }

    [Fact]
    public async Task OpeningWatchdogMovesToNextCandidateAndCurrentRemovalStops()
    {
        var library = new Library(new MemoryStore());
        var device = new FakeDevice();
        var resolver = new FakeResolver((_, _, _, _) => Task.FromResult(Batch(Candidate("ytdlp", "a"), Candidate("ytdlp", "b"))));
        using var player = new PlaybackController(library, resolver, device);
        await player.PlayNowAsync(Track("stalled0001"));
        await player.CheckHealthAsync(DateTimeOffset.UtcNow.AddSeconds(25));
        Assert.Equal(2, device.Opened.Count);
        library.RemoveFromQueue(0);
        Assert.Equal(PlaybackState.Idle, player.State);
        Assert.Null(player.Track);
    }

    [Fact]
    public async Task BlockedBrowserPlaybackIsNotMistakenForADeadCandidate()
    {
        var library = new Library(new MemoryStore());
        var device = new FakeDevice();
        using var player = new PlaybackController(library, Primary(), device);
        await player.PlayNowAsync(Track("blocked0001"));
        device.Emit(MediaSignal.Blocked);
        Assert.Equal(PlaybackState.Paused, player.State);
        Assert.Single(device.Opened);
        player.TogglePlayPause();
        Assert.Equal(1, device.PlayCalls);
        Assert.Empty(library.History);
    }

    private static FakeResolver Primary() => new((_, _, _, _) => Task.FromResult(Batch(Candidate("ytdlp", "only"))));

    private sealed class FakeResolver(Func<string, PlaybackMode, string, CancellationToken, Task<PlaybackResolution>> resolve) : IPlaybackResolver
    {
        public List<(string Id, PlaybackMode Mode, string After)> Calls { get; } = [];
        public Task<PlaybackResolution> ResolveAsync(string videoId, PlaybackMode mode, string after, bool refresh, CancellationToken cancellationToken)
        {
            Calls.Add((videoId, mode, after));
            return resolve(videoId, mode, after, cancellationToken);
        }
    }

    private sealed class FakeDevice : IMediaDevice
    {
        public event EventHandler<MediaDeviceEvent>? Changed;
        public List<(PlaybackCandidate Candidate, PlaybackMode Mode, double ResumeAt)> Opened { get; } = [];
        public long Attempt { get; private set; }
        public int PlayCalls { get; private set; }
        public double LastSeek { get; private set; } = -1;
        public void Open(PlaybackCandidate candidate, PlaybackMode mode, long attempt, double resumeAtSeconds)
        { Attempt = attempt; Opened.Add((candidate, mode, resumeAtSeconds)); }
        public void Emit(MediaSignal signal, double position = 0, double duration = 0) => EmitFor(Attempt, signal, position, duration);
        public void EmitFor(long attempt, MediaSignal signal, double position = 0, double duration = 0) =>
            Changed?.Invoke(this, new MediaDeviceEvent(attempt, signal, position, duration));
        public void Play() => PlayCalls++;
        public void Pause() { }
        public void Stop() { }
        public void Seek(double seconds) => LastSeek = seconds;
        public void SetVolume(double volume) { }
        public void Dispose() { }
    }
    private sealed class MemoryStore : ILibraryStore
    {
        private string? _value;
        public LibraryReadResult Read() => new(true, _value);
        public bool TryWrite(string content) { _value = content; return true; }
    }
}
