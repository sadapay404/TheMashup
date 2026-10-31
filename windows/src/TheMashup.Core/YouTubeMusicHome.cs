using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TheMashup.Core;

/// <summary>A YouTube account session captured only for the account-connected Home feed.</summary>
public sealed record AccountSnapshot(string Cookie, string? Name, string? Email);

public interface IAccountStore
{
    AccountSnapshot? Read();
    bool TryWrite(AccountSnapshot snapshot);
    bool TryDelete();
}

/// <summary>Shared in-memory store for tests and platform heads without a secure store.</summary>
public sealed class InMemoryAccountStore : IAccountStore
{
    private AccountSnapshot? _snapshot;
    public AccountSnapshot? Read() => _snapshot;
    public bool TryWrite(AccountSnapshot snapshot)
    {
        _snapshot = snapshot;
        return true;
    }

    public bool TryDelete()
    {
        if (_snapshot is null) return false;
        _snapshot = null;
        return true;
    }
}

/// <summary>Authenticated YouTube Music Home shelves and collection browsing.</summary>
public sealed class YouTubeMusicHomeClient
{
    private const string ClientVersion = "1.20260707.12.00";
    private const string ApiKey = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
    private const string GoogleLoginUrlValue =
        "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true" +
        "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue" +
        "%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";

    private readonly HttpClient _client;

    public YouTubeMusicHomeClient(HttpClient? client = null)
    {
        _client = client ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = new Uri("https://music.youtube.com/"),
        };
    }

    public static string GoogleLoginUrl => GoogleLoginUrlValue;

    public static string? SessionId(string? cookie)
    {
        if (string.IsNullOrWhiteSpace(cookie)) return null;
        var values = cookie.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(part => part.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0].Trim(), parts => parts[1].Trim(), StringComparer.OrdinalIgnoreCase);
        foreach (var name in new[] { "SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID" })
            if (values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value))
                return value;
        return null;
    }

    public async Task<AccountSnapshot> VerifyAsync(string cookie, CancellationToken cancellationToken)
    {
        var root = await PostAsync(cookie, "account/account_menu",
            $$$$"""{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"{{{{ClientVersion}}}}","hl":"en"}}}""",
            cancellationToken);
        if (!HasAccountIdentity(root))
            throw new HomeProviderException("Could not verify the signed-in YouTube account. Please sign in again.");
        return new AccountSnapshot(cookie, FindAccountName(root), FindAccountEmail(root));
    }

    public async Task<HomeFeed> LoadFeedAsync(string cookie, CancellationToken cancellationToken)
    {
        await VerifyAsync(cookie, cancellationToken);
        var root = await PostAsync(cookie, "browse",
            $$$$"""{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"{{{{ClientVersion}}}}","hl":"en"}},"browseId":"FEmusic_home"}""",
            cancellationToken);
        var shelves = HomeParser.Parse(root);
        if (shelves.Count == 0)
            throw new HomeProviderException("YouTube Music returned no recommendations. Retry or reconnect your account.");
        return new HomeFeed(shelves);
    }

    public async Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string cookie, string browseId,
        CancellationToken cancellationToken)
    {
        var root = await PostAsync(cookie, "browse",
            $$$$"""{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"{{{{ClientVersion}}}}","hl":"en"}},"browseId":"{{{{browseId}}}}"}""",
            cancellationToken);
        return HomeParser.ParseCollection(root);
    }

    private async Task<JsonElement> PostAsync(string cookie, string endpoint, string body,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(cookie) || SessionId(cookie) is null)
            throw new HomeProviderException("Please reconnect your YouTube account.");

        var time = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var sessionId = SessionId(cookie)!;
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(
            $"{time} {sessionId} https://music.youtube.com"))).ToLowerInvariant();
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://music.youtube.com/youtubei/v1/{endpoint}?key={ApiKey}&prettyPrint=false")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Cookie", cookie);
        request.Headers.TryAddWithoutValidation("Authorization", $"SAPISIDHASH {time}_{hash}");
        request.Headers.TryAddWithoutValidation("Origin", "https://music.youtube.com");
        request.Headers.TryAddWithoutValidation("X-Origin", "https://music.youtube.com");
        request.Headers.TryAddWithoutValidation("Referer", "https://music.youtube.com/");
        request.Headers.TryAddWithoutValidation("X-Goog-Api-Format-Version", "1");
        request.Headers.TryAddWithoutValidation("X-Goog-AuthUser", "0");
        request.Headers.TryAddWithoutValidation("X-YouTube-Client-Name", "67");
        request.Headers.TryAddWithoutValidation("X-YouTube-Client-Version", ClientVersion);
        request.Headers.TryAddWithoutValidation("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/140.0");

        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HomeProviderException($"YouTube Music returned HTTP {(int)response.StatusCode}; reconnect or retry.");
        using var document = JsonDocument.Parse(text);
        var root = document.RootElement.Clone();
        var responseContext = root.TryGetProperty("responseContext", out var context) ? context : default;
        var webContext = responseContext.ValueKind == JsonValueKind.Object &&
                         responseContext.TryGetProperty("mainAppWebResponseContext", out var main) ? main : default;
        if (webContext.ValueKind == JsonValueKind.Object &&
            webContext.TryGetProperty("loggedOut", out var loggedOut) &&
            loggedOut.ValueKind == JsonValueKind.True)
            throw new HomeProviderException("Your YouTube session has expired. Reconnect your account.");
        return root;
    }

    private static bool HasAccountIdentity(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("activeAccountHeaderRenderer", out var account) &&
            account.ValueKind == JsonValueKind.Object)
        {
            foreach (var field in new[] { "accountName", "email", "channelHandle" })
                if (FindDeepText(account, field) is { Length: > 0 }) return true;
        }
        return Walk(root, element =>
        {
            if (element.ValueKind != JsonValueKind.Object ||
                !element.TryGetProperty("activeAccountHeaderRenderer", out var account) ||
                account.ValueKind != JsonValueKind.Object) return false;
            foreach (var field in new[] { "accountName", "email", "channelHandle" })
                if (FindDeepText(account, field) is { Length: > 0 }) return true;
            return false;
        });
    }

    private static string? FindAccountName(JsonElement root)
    {
        foreach (var field in new[] { "accountName", "channelHandle", "email" })
        {
            var value = FindDeepText(root, field);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return null;
    }

    private static string? FindAccountEmail(JsonElement root)
    {
        var email = FindDeepText(root, "email");
        return string.IsNullOrWhiteSpace(email) || !email.Contains('@') ? null : email;
    }

    private static string? FindDeepText(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(propertyName, out var target))
            {
                var value = ExtractText(target);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            foreach (var property in element.EnumerateObject())
            {
                var value = FindDeepText(property.Value, propertyName);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var value = FindDeepText(item, propertyName);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        return null;
    }

    private static string? ExtractText(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Object:
                if (element.TryGetProperty("simpleText", out var simple) && simple.ValueKind == JsonValueKind.String)
                    return simple.GetString();
                if (element.TryGetProperty("text", out var text)) return ExtractText(text);
                if (element.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array)
                {
                    var parts = runs.EnumerateArray().Select(ExtractText).Where(value => !string.IsNullOrWhiteSpace(value));
                    return string.Concat(parts);
                }
                return null;
            default:
                return null;
        }
    }

    private static bool Walk(JsonElement element, Func<JsonElement, bool> visit)
    {
        if (visit(element)) return true;
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject())
                if (Walk(property.Value, visit)) return true;
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray())
                if (Walk(item, visit)) return true;
        return false;
    }
}

public sealed record HomeTrack(string Id, string Title, string Artist, string? Album, string? Artwork, int? DurationSeconds)
{
    public CatalogTrack ToCatalogTrack() => new()
    {
        Id = Id,
        Source = "youtube",
        Title = Title,
        Artist = Artist,
        Album = Album,
        DurationSeconds = DurationSeconds,
        Artwork = Artwork,
    };
}

public abstract record HomeItem;
public sealed record HomeSong(HomeTrack Track) : HomeItem;
public sealed record HomeCollection(string BrowseId, string Title, string? Artwork) : HomeItem;
public sealed record HomeShelf(string Title, IReadOnlyList<HomeItem> Items);
public sealed record HomeFeed(IReadOnlyList<HomeShelf> Shelves);

/// <summary>Account-scoped Home recommendations. The browser head uses fixtures only.</summary>
public interface IHomeRecommendationsService
{
    bool IsConnected { get; }
    string? AccountDisplayName { get; }
    Task ConnectAsync(AccountSnapshot snapshot, CancellationToken cancellationToken);
    Task<HomeFeed> LoadFeedAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string browseId, CancellationToken cancellationToken);
    void SignOut();
}

public sealed class HomeProviderException(string message) : Exception(message);

public sealed class YouTubeMusicHomeService(YouTubeMusicHomeClient client, IAccountStore store) : IHomeRecommendationsService
{
    private readonly object _gate = new();
    private HomeFeed? _feed;
    private string? _feedCookie;
    private readonly Dictionary<string, IReadOnlyList<CatalogTrack>> _collections = new(StringComparer.Ordinal);

    public bool IsConnected => !string.IsNullOrWhiteSpace(store.Read()?.Cookie);
    public string? AccountDisplayName => store.Read()?.Name ?? store.Read()?.Email;

    public async Task ConnectAsync(AccountSnapshot snapshot, CancellationToken cancellationToken)
    {
        var verified = await client.VerifyAsync(snapshot.Cookie, cancellationToken);
        if (!store.TryWrite(verified)) throw new HomeProviderException("Could not save the connected account.");
        ClearCache();
    }

    public async Task<HomeFeed> LoadFeedAsync(CancellationToken cancellationToken)
    {
        var snapshot = store.Read() ?? throw new HomeProviderException("Connect your YouTube account to see recommendations.");
        lock (_gate)
        {
            if (_feed is not null && _feedCookie == snapshot.Cookie) return _feed;
        }
        var feed = await client.LoadFeedAsync(snapshot.Cookie, cancellationToken);
        lock (_gate)
        {
            _feed = feed;
            _feedCookie = snapshot.Cookie;
            _collections.Clear();
        }
        return feed;
    }

    public async Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string browseId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(browseId)) throw new HomeProviderException("This collection has no browse ID.");
        var snapshot = store.Read() ?? throw new HomeProviderException("Connect your YouTube account first.");
        lock (_gate)
        {
            if (_collections.TryGetValue(browseId, out var cached)) return cached;
        }
        var tracks = await client.LoadCollectionAsync(snapshot.Cookie, browseId, cancellationToken);
        lock (_gate) _collections[browseId] = tracks;
        return tracks;
    }

    public void SignOut()
    {
        store.TryDelete();
        ClearCache();
    }

    private void ClearCache()
    {
        lock (_gate)
        {
            _feed = null;
            _feedCookie = null;
            _collections.Clear();
        }
    }
}

public sealed class UnavailableHomeService : IHomeRecommendationsService
{
    public bool IsConnected => false;
    public string? AccountDisplayName => null;
    public Task ConnectAsync(AccountSnapshot snapshot, CancellationToken cancellationToken) =>
        Task.FromException(new HomeProviderException("Account sign-in is not available in this build."));
    public Task<HomeFeed> LoadFeedAsync(CancellationToken cancellationToken) =>
        Task.FromException<HomeFeed>(new HomeProviderException("Account recommendations are not available in this build."));
    public Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string browseId, CancellationToken cancellationToken) =>
        Task.FromException<IReadOnlyList<CatalogTrack>>(new HomeProviderException("Account recommendations are not available in this build."));
    public void SignOut() { }
}

/// <summary>Deterministic preview feed used by the browser head and unit tests.</summary>
public sealed class FixtureHomeService : IHomeRecommendationsService
{
    private static readonly CatalogTrack[] AllTracks =
    [
        new() { Id = "mock00000001", Source = "youtube", Title = "Mirage", Artist = "Chrome Gardens", Album = "Chrome Gardens", DurationSeconds = 214, Artwork = "https://picsum.photos/seed/mirage/512" },
        new() { Id = "mock00000002", Source = "youtube", Title = "Paper Crowns", Artist = "Elder & Vine", Album = "Quiet Riot Season", DurationSeconds = 187, Artwork = "https://picsum.photos/seed/crowns/512" },
        new() { Id = "mock00000003", Source = "youtube", Title = "Neon Tide", Artist = "Kite Society", Album = "Afterglow Club", DurationSeconds = 231, Artwork = "https://picsum.photos/seed/tide/512" },
        new() { Id = "mock00000004", Source = "youtube", Title = "Slow Orbit", Artist = "Marbles in Space", Album = "Zero G Disco", DurationSeconds = 198, Artwork = "https://picsum.photos/seed/orbit/512" },
        new() { Id = "mock00000005", Source = "youtube", Title = "Ink & Honey", Artist = "The Foxglove Union", Album = "Field Notes", DurationSeconds = 244, Artwork = "https://picsum.photos/seed/honey/512" },
        new() { Id = "mock00000006", Source = "youtube", Title = "Glasshouse Summer", Artist = "Nova Arcade", Album = "Chrome Gardens", DurationSeconds = 205, Artwork = "https://picsum.photos/seed/summer/512" },
    ];

    public bool IsConnected { get; private set; }
    public string? AccountDisplayName => IsConnected ? "Preview account" : null;

    public Task ConnectAsync(AccountSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(snapshot.Cookie)) return Task.FromException(new HomeProviderException("Sign in failed."));
        IsConnected = true;
        return Task.CompletedTask;
    }

    public Task<HomeFeed> LoadFeedAsync(CancellationToken cancellationToken)
    {
        if (!IsConnected) return Task.FromException<HomeFeed>(new HomeProviderException("Connect your YouTube account to see recommendations."));
        var shelves = new List<HomeShelf>
        {
            new("Made for you",
            [
                new HomeSong(Track(0)),
                new HomeSong(Track(1)),
                new HomeCollection("MPREb_preview", "Chrome Gardens", Track(0).Artwork),
            ]),
            new("Jump back in",
            [
                new HomeSong(Track(2)),
                new HomeSong(Track(3)),
                new HomeCollection("VLL_preview", "Zero G Disco", Track(3).Artwork),
            ]),
            new("New discoveries",
            [
                new HomeSong(Track(4)),
                new HomeSong(Track(5)),
            ]),
        };
        return Task.FromResult(new HomeFeed(shelves));
    }

    public Task<IReadOnlyList<CatalogTrack>> LoadCollectionAsync(string browseId, CancellationToken cancellationToken)
    {
        if (!IsConnected) return Task.FromException<IReadOnlyList<CatalogTrack>>(new HomeProviderException("Connect your YouTube account first."));
        IReadOnlyList<CatalogTrack> tracks = browseId switch
        {
            "MPREb_preview" => AllTracks.Take(3).ToArray(),
            "VLL_preview" => AllTracks.Skip(3).ToArray(),
            _ => AllTracks.Where(track => track.Id == browseId).ToArray(),
        };
        return Task.FromResult(tracks);
    }

    public void SignOut() => IsConnected = false;

    private static HomeTrack Track(int index) => new(
        AllTracks[index].Id, AllTracks[index].Title, AllTracks[index].Artist, AllTracks[index].Album,
        AllTracks[index].Artwork, AllTracks[index].DurationSeconds);
}

/// <summary>Parses WEB_REMIX Home shelves and collection pages without exposing raw streams.</summary>
public static class HomeParser
{
    public static List<HomeShelf> Parse(JsonElement root)
    {
        var shelves = new List<HomeShelf>();
        CollectShelves(root, shelves);
        return shelves;
    }

    private static void CollectShelves(JsonElement node, List<HomeShelf> shelves)
    {
        if (node.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in node.EnumerateObject())
            {
                if (property.Name is "musicCarouselShelfRenderer" or "musicShelfRenderer" &&
                    property.Value.ValueKind == JsonValueKind.Object)
                {
                    var title = ExtractShelfTitle(property.Value) ?? "Recommended for you";
                    var items = new List<HomeItem>();
                    if (property.Value.TryGetProperty("contents", out var contents)) CollectItems(contents, items);
                    var unique = items.DistinctBy(item => item switch
                    {
                        HomeSong song => $"song:{song.Track.Id}",
                        HomeCollection collection => $"collection:{collection.BrowseId}",
                        _ => "",
                    }).ToList();
                    if (unique.Count > 0) shelves.Add(new HomeShelf(title, unique));
                }
                else CollectShelves(property.Value, shelves);
            }
        }
        else if (node.ValueKind == JsonValueKind.Array)
            foreach (var item in node.EnumerateArray()) CollectShelves(item, shelves);
    }

    public static IReadOnlyList<CatalogTrack> ParseCollection(JsonElement root)
    {
        var items = new List<HomeItem>();
        CollectItems(root, items);
        var header = FindObject(root, "musicResponsiveHeaderRenderer") ?? FindObject(root, "musicDetailHeaderRenderer");
        var subtitle = header is { } headerElement && headerElement.TryGetProperty("subtitle", out var value) ? ExtractText(value) : null;
        var isAlbum = subtitle?.Contains("Album", StringComparison.OrdinalIgnoreCase) == true;
        var albumArtist = isAlbum && header is { } headerElement && headerElement.TryGetProperty("straplineTextOne", out var strapline)
            ? ExtractText(strapline) : null;
        var albumTitle = isAlbum && header is { } headerElement && headerElement.TryGetProperty("title", out var title)
            ? ExtractText(title) : null;
        var albumArt = isAlbum && header is { } headerElement && headerElement.TryGetProperty("thumbnail", out var thumbnail)
            ? ExtractThumbnail(thumbnail) : null;

        return items.OfType<HomeSong>().Select(song =>
        {
            var track = song.Track;
            var artwork = track.Artwork ?? albumArt ?? $"https://i.ytimg.com/vi/{track.Id}/hqdefault.jpg";
            var artist = albumArtist is { Length: > 0 } &&
                         string.Equals(track.Artist, "Unknown artist", StringComparison.OrdinalIgnoreCase)
                ? albumArtist : track.Artist;
            return new CatalogTrack
            {
                Id = track.Id,
                Source = "youtube",
                Title = track.Title,
                Artist = artist,
                Album = track.Album ?? albumTitle,
                DurationSeconds = track.DurationSeconds,
                Artwork = artwork,
            };
        }).DistinctBy(track => track.Id).ToArray();
    }

    private static string? ExtractShelfTitle(JsonElement shelf)
    {
        if (shelf.TryGetProperty("header", out var header) &&
            header.ValueKind == JsonValueKind.Object &&
            header.TryGetProperty("musicCarouselShelfBasicHeaderRenderer", out var basicHeader))
            return FindDeepText(basicHeader, "title");
        return shelf.TryGetProperty("title", out var title) ? ExtractText(title) : null;
    }

    private static void CollectItems(JsonElement node, List<HomeItem> items)
    {
        if (node.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in node.EnumerateObject())
            {
                if (property.Name is "musicTwoRowItemRenderer" or "musicResponsiveListItemRenderer")
                {
                    var item = ParseItem(property.Value);
                    if (item is not null) items.Add(item);
                }
                else CollectItems(property.Value, items);
            }
        }
        else if (node.ValueKind == JsonValueKind.Array)
            foreach (var item in node.EnumerateArray()) CollectItems(item, items);
    }

    private static HomeItem? ParseItem(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        var videoId = FindDeepText(element, "videoId");
        var browseId = FindDeepText(element, "browseId");
        if (!string.IsNullOrWhiteSpace(videoId))
            return new HomeSong(new HomeTrack(videoId,
                FindDeepText(element, "title") ?? "Unknown title",
                FindArtistNames(element),
                FindAlbumName(element),
                ExtractThumbnail(element),
                ParseDuration(FindDeepText(element, "lengthText") ?? FindDeepText(element, "duration"))));
        if (!string.IsNullOrWhiteSpace(browseId))
            return new HomeCollection(browseId,
                FindDeepText(element, "title") ?? "Collection",
                ExtractThumbnail(element));
        return null;
    }

    private static string FindArtistNames(JsonElement element)
    {
        var runs = FindDeepArray(element, "runs");
        if (runs is not null)
        {
            var names = runs.SelectMany(run => ExtractRuns(run)).Where(value => !string.IsNullOrWhiteSpace(value));
            var artist = string.Join(", ", names);
            if (artist.Length > 0) return artist;
        }
        var subtitle = FindDeepText(element, "subtitle");
        if (!string.IsNullOrWhiteSpace(subtitle)) return subtitle;
        return "Unknown artist";
    }

    private static string? FindAlbumName(JsonElement element)
    {
        if (element.TryGetProperty("album", out var album))
        {
            var value = ExtractText(album);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return FindDeepText(element, "album");
    }

    private static string? ExtractThumbnail(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (element.TryGetProperty("thumbnails", out var thumbnails) && thumbnails.ValueKind == JsonValueKind.Array)
        {
            var candidates = new List<(string Url, int Area)>();
            foreach (var thumbnail in thumbnails.EnumerateArray())
            {
                if (thumbnail.ValueKind != JsonValueKind.Object ||
                    !thumbnail.TryGetProperty("url", out var url) ||
                    url.ValueKind != JsonValueKind.String)
                    continue;
                var candidateUrl = url.GetString();
                if (string.IsNullOrWhiteSpace(candidateUrl)) continue;
                candidates.Add((candidateUrl, GetInt(thumbnail, "width") * GetInt(thumbnail, "height")));
            }
            if (candidates.Count == 0) return null;
            return candidates.OrderByDescending(candidate => candidate.Area).First().Url;
        }
        if (element.TryGetProperty("thumbnail", out var thumbnail)) return ExtractThumbnail(thumbnail);
        return FindDeepText(element, "url");
    }

    private static int GetInt(JsonElement element, string property)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value))
            return value.ValueKind == JsonValueKind.Number ? value.GetInt32() : 0;
        return 0;
    }

    private static IEnumerable<string> ExtractRuns(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String) return [element.GetString() ?? ""];
        if (element.ValueKind != JsonValueKind.Object) return [];
        if (element.TryGetProperty("text", out var text)) return ExtractRuns(text);
        if (element.TryGetProperty("simpleText", out var simple) && simple.ValueKind == JsonValueKind.String)
            return [simple.GetString() ?? ""];
        return [];
    }

    private static JsonElement? FindDeepArray(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(propertyName, out var target) && target.ValueKind == JsonValueKind.Array) return target;
            foreach (var property in element.EnumerateObject())
            {
                var value = FindDeepArray(property.Value, propertyName);
                if (value is not null) return value;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray())
            {
                var value = FindDeepArray(item, propertyName);
                if (value is not null) return value;
            }
        return null;
    }

    private static JsonElement? FindObject(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(propertyName, out var target) && target.ValueKind == JsonValueKind.Object) return target;
            foreach (var property in element.EnumerateObject())
            {
                var value = FindObject(property.Value, propertyName);
                if (value is not null) return value;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray())
            {
                var value = FindObject(item, propertyName);
                if (value is not null) return value;
            }
        return null;
    }

    private static string? FindDeepText(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(propertyName, out var target))
            {
                var value = ExtractText(target);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            foreach (var property in element.EnumerateObject())
            {
                var value = FindDeepText(property.Value, propertyName);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray())
            {
                var value = FindDeepText(item, propertyName);
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        return null;
    }

    private static string? ExtractText(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Object:
                if (element.TryGetProperty("simpleText", out var simple) && simple.ValueKind == JsonValueKind.String)
                    return simple.GetString();
                if (element.TryGetProperty("text", out var text)) return ExtractText(text);
                if (element.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array)
                    return string.Concat(runs.EnumerateArray().SelectMany(ExtractRuns));
                return null;
            default:
                return null;
        }
    }

    private static int? ParseDuration(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (int.TryParse(value, out var seconds) && seconds > 0) return seconds;
        var parts = value.Split(':');
        if (parts.Length is >= 2 and <= 3 && parts.All(part => int.TryParse(part, out _)))
        {
            var total = 0;
            foreach (var part in parts) total = total * 60 + int.Parse(part);
            return total > 0 ? total : null;
        }
        return null;
    }

    private static void Walk(JsonElement element, Func<JsonElement, bool> visit)
    {
        if (visit(element)) return;
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject()) Walk(property.Value, visit);
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray()) Walk(item, visit);
    }
}
