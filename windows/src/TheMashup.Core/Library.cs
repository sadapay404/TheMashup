using System.Text.Json;
using System.Text.Json.Serialization;

namespace TheMashup.Core;

/// <summary>Stable catalog metadata only. Stream URLs and account credentials are never stored here.</summary>
public sealed record LibraryTrack(string Source, string Id, string Title, string Artist, int? DurationSeconds = null);

public sealed class LibraryPlaylist
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<LibraryTrack> Tracks { get; set; } = [];
}

/// <summary>Read-only playlist projection; all edits go through Library methods.</summary>
public sealed record LibraryPlaylistView(string Id, string Name, IReadOnlyList<LibraryTrack> Tracks);

public sealed class LibraryHistoryEntry
{
    public LibraryTrack? Track { get; init; }
    public DateTimeOffset PlayedAt { get; init; }
}

public sealed class LibraryQueue
{
    public List<LibraryTrack> Items { get; set; } = [];
    // -1 means no track is playing; adding to an empty queue never starts playback.
    public int CurrentIndex { get; set; } = -1;
}

public sealed class LibrarySnapshot
{
    // A missing schema version is legacy v0. New empty libraries are set to v1 by Library.
    public int SchemaVersion { get; set; }
    public List<LibraryTrack> LikedTracks { get; set; } = [];
    public List<LibraryPlaylist> Playlists { get; set; } = [];
    public List<LibraryHistoryEntry> History { get; set; } = [];
    public LibraryQueue Queue { get; set; } = new();
}

public readonly record struct LibraryReadResult(bool Success, string? Content);

public interface ILibraryStore
{
    // Success with null Content means no library has been saved yet.
    LibraryReadResult Read();
    bool TryWrite(string content);
}

public enum LibraryLoadStatus { Ready, Unavailable, Invalid, NewerVersion }

/// <summary>
/// Per-device library. Call mutations from the UI thread. History is recorded only
/// after playback really begins. Queue operations describe intent; they do not
/// start a player. Invalid/future data is never silently replaced.
/// </summary>
public sealed class Library
{
    public const int CurrentSchemaVersion = 1;
    public const int MaxPlaylistNameLength = 80;
    public const int MaxHistoryEntries = 500;
    private readonly ILibraryStore _store;
    private LibrarySnapshot _data = NewSnapshot();

    public Library(ILibraryStore store)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        Load();
    }

    public event EventHandler? Changed;
    public LibraryLoadStatus LoadStatus { get; private set; } = LibraryLoadStatus.Ready;
    public bool CanEdit => LoadStatus == LibraryLoadStatus.Ready;
    public bool LastWriteSucceeded { get; private set; } = true;
    public IReadOnlyList<LibraryTrack> LikedTracks => _data.LikedTracks.AsReadOnly();
    public IReadOnlyList<LibraryPlaylistView> Playlists => _data.Playlists
        .Select(item => new LibraryPlaylistView(item.Id, item.Name, item.Tracks.AsReadOnly())).ToArray();
    public IReadOnlyList<LibraryHistoryEntry> History => _data.History.AsReadOnly();
    public IReadOnlyList<LibraryTrack> Queue => _data.Queue.Items.AsReadOnly();
    // Runtime-only revision for queue traversal; moving the cursor or writing
    // history does not invalidate a shuffle cycle.
    public long QueueVersion { get; private set; }
    public int CurrentQueueIndex => _data.Queue.CurrentIndex;
    public LibraryTrack? CurrentTrack => CurrentQueueIndex >= 0 ? _data.Queue.Items[CurrentQueueIndex] : null;

    public bool CreatePlaylist(string? name, out string? id)
    {
        id = null;
        if (!CanEdit || !TryName(name, out var clean)) return false;
        id = Guid.NewGuid().ToString("N");
        _data.Playlists.Add(new LibraryPlaylist { Id = id, Name = clean });
        SaveAndNotify();
        return true;
    }

    public bool RenamePlaylist(string id, string? name)
    {
        if (!CanEdit || !TryName(name, out var clean)) return false;
        var playlist = _data.Playlists.FirstOrDefault(item => item.Id == id);
        if (playlist is null) return false;
        if (playlist.Name == clean) return true;
        playlist.Name = clean;
        SaveAndNotify();
        return true;
    }

    public bool DeletePlaylist(string id)
    {
        if (!CanEdit) return false;
        var playlist = _data.Playlists.FirstOrDefault(item => item.Id == id);
        if (playlist is null) return false;
        _data.Playlists.Remove(playlist);
        SaveAndNotify();
        return true;
    }

    public bool AddToPlaylist(string id, LibraryTrack track)
    {
        if (!CanEdit || !IsValidTrack(track)) return false;
        var playlist = _data.Playlists.FirstOrDefault(item => item.Id == id);
        if (playlist is null) return false;
        // A playlist may intentionally contain the same song more than once.
        playlist.Tracks.Add(track);
        SaveAndNotify();
        return true;
    }

    public bool RemoveFromPlaylist(string id, int index)
    {
        if (!CanEdit) return false;
        var playlist = _data.Playlists.FirstOrDefault(item => item.Id == id);
        if (playlist is null || index < 0 || index >= playlist.Tracks.Count) return false;
        playlist.Tracks.RemoveAt(index);
        SaveAndNotify();
        return true;
    }

    public bool IsLiked(LibraryTrack? track) => track is not null && _data.LikedTracks.Any(item => SameTrack(item, track));

    public bool SetLiked(LibraryTrack track, bool liked)
    {
        if (!CanEdit || !IsValidTrack(track)) return false;
        var index = _data.LikedTracks.FindIndex(item => SameTrack(item, track));
        if (liked && index < 0) _data.LikedTracks.Add(track);
        else if (!liked && index >= 0) _data.LikedTracks.RemoveAt(index);
        else return true;
        SaveAndNotify();
        return true;
    }

    /// <summary>Call only when the playback engine confirms that playback actually began.</summary>
    public bool RecordPlay(LibraryTrack track, DateTimeOffset playedAt)
    {
        if (!CanEdit || !IsValidTrack(track)) return false;
        _data.History.Insert(0, new LibraryHistoryEntry { Track = track, PlayedAt = playedAt });
        if (_data.History.Count > MaxHistoryEntries)
            _data.History.RemoveRange(MaxHistoryEntries, _data.History.Count - MaxHistoryEntries);
        SaveAndNotify();
        return true;
    }

    public bool ClearHistory()
    {
        if (!CanEdit) return false;
        if (_data.History.Count == 0) return true;
        _data.History.Clear();
        SaveAndNotify();
        return true;
    }

    /// <summary>Append exactly one song; never start or change the current track.</summary>
    public bool AddToQueue(LibraryTrack track)
    {
        if (!IsValidTrack(track)) return false;
        _data.Queue.Items.Add(track);
        QueueVersion++;
        SaveAndNotify();
        return true;
    }

    /// <summary>
    /// A search-result play acts on that result only. When another song is current,
    /// it is placed immediately after the new current song; existing queued songs remain.
    /// </summary>
    public bool PlayNow(LibraryTrack track)
    {
        if (!IsValidTrack(track)) return false;
        var queue = _data.Queue;
        if (queue.CurrentIndex >= 0 && SameTrack(queue.Items[queue.CurrentIndex], track))
        {
            // Replaying the current song must not create a duplicate queue entry.
            return true;
        }
        var position = queue.CurrentIndex >= 0 ? queue.CurrentIndex : 0;
        queue.Items.Insert(position, track);
        QueueVersion++;
        queue.CurrentIndex = position;
        SaveAndNotify();
        return true;
    }

    /// <summary>Move the queue cursor without inserting or deleting songs.</summary>
    public bool SetCurrentQueueIndex(int index)
    {
        if (index < -1 || index >= _data.Queue.Items.Count) return false;
        if (_data.Queue.CurrentIndex == index) return true;
        _data.Queue.CurrentIndex = index;
        SaveAndNotify();
        return true;
    }

    public bool RemoveFromQueue(int index)
    {
        if (index < 0 || index >= _data.Queue.Items.Count) return false;
        var queue = _data.Queue;
        queue.Items.RemoveAt(index);
        QueueVersion++;
        if (index == queue.CurrentIndex) queue.CurrentIndex = -1;
        else if (index < queue.CurrentIndex) queue.CurrentIndex--;
        SaveAndNotify();
        return true;
    }

    private void Load()
    {
        LibraryReadResult read;
        try { read = _store.Read(); }
        catch { LoadStatus = LibraryLoadStatus.Unavailable; return; }
        if (!read.Success) { LoadStatus = LibraryLoadStatus.Unavailable; return; }
        if (read.Content is null) return;

        try
        {
            using var json = JsonDocument.Parse(read.Content);
            if (json.RootElement.ValueKind != JsonValueKind.Object) { LoadStatus = LibraryLoadStatus.Invalid; return; }
            var version = 0;
            if (json.RootElement.TryGetProperty("schemaVersion", out var versionElement) &&
                (!versionElement.TryGetInt32(out version) || version < 0))
            {
                LoadStatus = LibraryLoadStatus.Invalid;
                return;
            }
            if (version > CurrentSchemaVersion) { LoadStatus = LibraryLoadStatus.NewerVersion; return; }
            // Known versions have a complete set of required collections. A
            // partially valid JSON object must not cause missing data to be
            // treated as empty and overwritten on the next save.
            if (!json.RootElement.TryGetProperty("playlists", out _) ||
                !json.RootElement.TryGetProperty("likedTracks", out _) ||
                !json.RootElement.TryGetProperty("history", out _) ||
                (version >= 1 && !json.RootElement.TryGetProperty("queue", out _)))
            {
                LoadStatus = LibraryLoadStatus.Invalid;
                return;
            }
            var restored = JsonSerializer.Deserialize(read.Content, LibraryJsonContext.Default.LibrarySnapshot);
            if (restored is null || !IsValidSnapshot(restored)) { LoadStatus = LibraryLoadStatus.Invalid; return; }
            // v0 uses the same collections but predates the explicit schema version.
            // The upgrade is persisted on the next successful user change.
            restored.SchemaVersion = CurrentSchemaVersion;
            _data = restored;
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or ArgumentException or InvalidOperationException)
        {
            LoadStatus = LibraryLoadStatus.Invalid;
        }
    }

    private void SaveAndNotify()
    {
        // Playback can keep an in-memory queue even if the on-disk library is
        // unreadable; it must never overwrite the unreadable original.
        if (!CanEdit)
        {
            LastWriteSucceeded = false;
            Changed?.Invoke(this, EventArgs.Empty);
            return;
        }
        try
        {
            var content = JsonSerializer.Serialize(_data, LibraryJsonContext.Default.LibrarySnapshot);
            LastWriteSucceeded = _store.TryWrite(content);
        }
        catch { LastWriteSucceeded = false; }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static LibrarySnapshot NewSnapshot() => new() { SchemaVersion = CurrentSchemaVersion };

    private static bool TryName(string? value, out string name)
    {
        name = value?.Trim() ?? "";
        return name.Length is > 0 and <= MaxPlaylistNameLength;
    }

    private static bool IsValidTrack(LibraryTrack? track) => track is not null &&
        !string.IsNullOrWhiteSpace(track.Source) && track.Source.Length <= 40 &&
        !string.IsNullOrWhiteSpace(track.Id) && track.Id.Length <= 300 &&
        !string.IsNullOrWhiteSpace(track.Title) && track.Title.Length <= 512 &&
        track.Artist is not null && track.Artist.Length <= 512 &&
        (track.DurationSeconds is null or >= 0);

    private static bool SameTrack(LibraryTrack a, LibraryTrack b) => a.Source == b.Source && a.Id == b.Id;

    private static bool IsValidSnapshot(LibrarySnapshot data)
    {
        if (data.LikedTracks is null || data.Playlists is null || data.History is null ||
            data.Queue is null || data.Queue.Items is null) return false;
        if (!data.LikedTracks.All(IsValidTrack) || !data.Queue.Items.All(IsValidTrack)) return false;
        if (data.LikedTracks.Select(item => (item.Source, item.Id)).Distinct().Count() != data.LikedTracks.Count) return false;
        if (data.Queue.CurrentIndex < -1 || data.Queue.CurrentIndex >= data.Queue.Items.Count) return false;
        if (data.Playlists.Any(item => item is null || string.IsNullOrWhiteSpace(item.Id) ||
            !TryName(item.Name, out _) || item.Tracks is null || !item.Tracks.All(IsValidTrack))) return false;
        if (data.Playlists.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != data.Playlists.Count) return false;
        return data.History.All(item => item is not null && IsValidTrack(item.Track));
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow)]
[JsonSerializable(typeof(LibrarySnapshot))]
internal partial class LibraryJsonContext : JsonSerializerContext { }
