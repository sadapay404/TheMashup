using System.Text.Json.Serialization;

namespace TheMashup.Core;

/// <summary>Stable metadata returned by the existing catalog resolver.</summary>
public sealed class CatalogTrack
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("source")] public string Source { get; init; } = "";
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("artist_names")] public string Artist { get; init; } = "";
    [JsonPropertyName("duration_sec")] public int? DurationSeconds { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("album")] public string? Album { get; init; }

    // The catalog sources all return YouTube IDs, including fallback mirrors.
    // Persist the same identity even when a different mirror answers later.
    public LibraryTrack ToLibraryTrack() => new("youtube", Id, Title, Artist, DurationSeconds);
    public bool IsUsable => !string.IsNullOrWhiteSpace(Id) && !string.IsNullOrWhiteSpace(Title) &&
        !string.IsNullOrWhiteSpace(Artist);
}

public sealed class CatalogArtist
{
    [JsonPropertyName("name")] public string Name { get; init; } = "";
}

public sealed class CatalogAlbum
{
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("artist")] public string Artist { get; init; } = "";
}

public sealed class CatalogSearchResult
{
    [JsonPropertyName("tracks")] public CatalogTrack[]? Tracks { get; init; }
    [JsonPropertyName("artists")] public CatalogArtist[]? Artists { get; init; }
    [JsonPropertyName("albums")] public CatalogAlbum[]? Albums { get; init; }
    [JsonPropertyName("warnings")] public string[]? Warnings { get; init; }
}

public sealed class SuggestionResult
{
    [JsonPropertyName("suggestions")] public string[]? Suggestions { get; init; }
}

public sealed class LyricSearchHit
{
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("artist")] public string Artist { get; init; } = "";
    [JsonPropertyName("snippet")] public string Snippet { get; init; } = "";
    // Null means the lyric provider found a candidate but catalog matching failed.
    [JsonPropertyName("track")] public CatalogTrack? Track { get; init; }
}

public sealed class LyricSearchResult
{
    [JsonPropertyName("hits")] public LyricSearchHit[]? Hits { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("warnings")] public string[]? Warnings { get; init; }
}

public sealed class TimedLyricLine
{
    [JsonPropertyName("time")] public double Time { get; init; }
    [JsonPropertyName("text")] public string Text { get; init; } = "";
}

public sealed class LyricDocument
{
    [JsonPropertyName("plain")] public string? Plain { get; init; }
    [JsonPropertyName("synced")] public TimedLyricLine[]? Synced { get; init; }
    [JsonPropertyName("instrumental")] public bool Instrumental { get; init; }
    [JsonPropertyName("provider")] public string? Provider { get; init; }
}

public interface ISearchService
{
    Task<CatalogSearchResult> SearchAsync(string query, CancellationToken cancellationToken);
    Task<SuggestionResult> SuggestAsync(string query, CancellationToken cancellationToken);
    Task<LyricSearchResult> SearchLyricsAsync(string query, CancellationToken cancellationToken);
    Task<LyricDocument?> GetLyricsAsync(CatalogTrack track, CancellationToken cancellationToken);
}

/// <summary>Provider/transport failure, distinct from a legitimate empty result.</summary>
public sealed class SearchProviderException(string message) : Exception(message) { }
