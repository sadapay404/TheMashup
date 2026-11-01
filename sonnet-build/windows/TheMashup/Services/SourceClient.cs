using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TheMashup.Services;

/// <summary>
/// Catalog access with failover: optional local search host -> Piped mirrors -> Invidious mirrors -> iTunes.
/// The local Node host (host.mjs) is NOT bundled; when it is absent the client silently falls back to public mirrors,
/// and if everything is unreachable it reports "not available" instead of a connection error.
/// </summary>
public sealed class SourceClient
{
    public const string NotAvailable = "Search is not available in this build. The local search host isn't bundled and no public source could be reached.";

    private static readonly string[] Piped =
    {
        "https://api.piped.private.coffee", "https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://pipedapi.leptons.xyz",
    };
    private static readonly string[] Invidious = { "https://yewtu.be", "https://inv.nadeko.net", "https://invidious.nerdvpn.de" };

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(7) };
    private readonly HttpClient _fast = new() { Timeout = TimeSpan.FromMilliseconds(1500) };
    private readonly Func<string> _hostUrl;

    public SourceClient(Func<string> hostUrl)
    {
        _hostUrl = hostUrl;
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("TheMashup/1.0");
        _fast.DefaultRequestHeaders.UserAgent.ParseAdd("TheMashup/1.0");
    }

    private async Task<JsonDocument> GetDoc(string url, HttpClient? c = null, CancellationToken ct = default)
    {
        var s = await (c ?? _http).GetStringAsync(url, ct).ConfigureAwait(false);
        return JsonDocument.Parse(s);
    }

    private static string Str(JsonElement e, string name, string def = "") =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? def : def;
    private static int? Int(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;
    private static string Enc(string s) => Uri.EscapeDataString(s);
    private static string? VideoId(string url) => Regex.Match(url ?? "", "[?&]v=([^&]+)") is { Success: true } m ? m.Groups[1].Value : null;
    private static string? Art(string? u) => u?.Replace("100x100bb", "400x400bb");
    private static string Host(string u) => Uri.TryCreate(u, UriKind.Absolute, out var x) ? x.Host : u;

    /* ---------------- search ---------------- */
    public async Task<SearchResult> SearchAsync(string q, CancellationToken ct = default)
    {
        // 1) optional local host (same JSON shape as the TheMashup web edition)
        var host = _hostUrl().Trim().TrimEnd('/');
        if (host.Length > 0)
        {
            try
            {
                var r = await _fast.GetFromJsonAsync<SearchResult>($"{host}/api/search?q={Enc(q)}", Json.Opts, ct).ConfigureAwait(false);
                if (r != null && (r.Songs.Count > 0 || r.Lyrics.Count > 0)) { r.Via.Insert(0, "local host"); return r; }
            }
            catch { /* host not running: expected in a standalone build */ }
        }

        // 2) direct sources, catalog + lyrics in parallel
        var via = new List<string>();
        var songsT = CatalogSongs(q, via, ct);
        var lyricsT = LyricSearch(q, ct);
        var aaT = ArtistsAlbums(q, ct);
        await Task.WhenAll(songsT, lyricsT, aaT).ConfigureAwait(false);
        var songs = songsT.Result;
        var seen = songs.Select(s => $"{s.Title}|{s.Artist}".ToLowerInvariant()).ToHashSet();
        var res = new SearchResult
        {
            Songs = songs,
            Lyrics = lyricsT.Result.Where(l => !seen.Contains($"{l.Title}|{l.Artist}".ToLowerInvariant())).ToList(),
            Artists = aaT.Result.Item1,
            Albums = aaT.Result.Item2,
            Via = via,
        };
        if (res.Songs.Count == 0 && res.Lyrics.Count == 0 && res.Artists.Count == 0) res.Error = NotAvailable;
        return res;
    }

    private async Task<List<Track>> CatalogSongs(string q, List<string> via, CancellationToken ct)
    {
        foreach (var b in Piped)
        {
            try
            {
                using var d = await GetDoc($"{b}/search?q={Enc(q)}&filter=music_songs", ct: ct).ConfigureAwait(false);
                if (!d.RootElement.TryGetProperty("items", out var items)) continue;
                var list = new List<Track>();
                foreach (var i in items.EnumerateArray())
                {
                    var id = VideoId(Str(i, "url"));
                    if (id is null) continue;
                    var dur = Int(i, "duration");
                    list.Add(new Track($"yt:{id}", Str(i, "title"), Str(i, "uploaderName", "Unknown").Replace(" - Topic", ""),
                        Artwork: Str(i, "thumbnail") is { Length: > 0 } t ? t : null, Duration: dur > 0 ? dur : null));
                }
                if (list.Count > 0) { via.Add(Host(b)); return list; }
            }
            catch { /* next mirror */ }
        }
        foreach (var b in Invidious)
        {
            try
            {
                using var d = await GetDoc($"{b}/api/v1/search?q={Enc(q)}&type=video", ct: ct).ConfigureAwait(false);
                var list = d.RootElement.EnumerateArray().Take(20).Select(v => new Track(
                    $"yt:{Str(v, "videoId")}", Str(v, "title"), Str(v, "author").Replace(" - Topic", ""),
                    Artwork: $"https://i.ytimg.com/vi/{Str(v, "videoId")}/hqdefault.jpg", Duration: Int(v, "lengthSeconds"))).ToList();
                if (list.Count > 0) { via.Add(Host(b)); return list; }
            }
            catch { /* next */ }
        }
        try
        {
            using var d = await GetDoc($"https://itunes.apple.com/search?term={Enc(q)}&entity=song&limit=20", ct: ct).ConfigureAwait(false);
            var list = d.RootElement.GetProperty("results").EnumerateArray().Select(ItunesTrack).Where(t => t != null).Cast<Track>().ToList();
            if (list.Count > 0) via.Add("itunes");
            return list;
        }
        catch { return new(); }
    }

    private static Track? ItunesTrack(JsonElement o)
    {
        if (!o.TryGetProperty("trackId", out var id)) return null;
        var ms = Int(o, "trackTimeMillis");
        return new Track($"it:{id.GetInt64()}", Str(o, "trackName"), Str(o, "artistName", "Unknown"), Str(o, "collectionName") is { Length: > 0 } a ? a : null,
            Art(Str(o, "artworkUrl100")), ms.HasValue ? ms / 1000 : null, Str(o, "previewUrl") is { Length: > 0 } p ? p : null);
    }

    private async Task<(List<Artist>, List<Album>)> ArtistsAlbums(string q, CancellationToken ct)
    {
        try
        {
            using var a = await GetDoc($"https://itunes.apple.com/search?term={Enc(q)}&entity=musicArtist&limit=6", ct: ct).ConfigureAwait(false);
            using var b = await GetDoc($"https://itunes.apple.com/search?term={Enc(q)}&entity=album&limit=8", ct: ct).ConfigureAwait(false);
            var artists = a.RootElement.GetProperty("results").EnumerateArray().Where(x => x.TryGetProperty("artistId", out _))
                .Select(x => new Artist(x.GetProperty("artistId").ToString(), Str(x, "artistName"))).ToList();
            var albums = b.RootElement.GetProperty("results").EnumerateArray().Where(x => x.TryGetProperty("collectionId", out _))
                .Select(x => new Album(x.GetProperty("collectionId").ToString(), Str(x, "collectionName"), Str(x, "artistName"), Art(Str(x, "artworkUrl100")))).ToList();
            return (artists, albums);
        }
        catch { return (new(), new()); }
    }

    private async Task<List<Track>> LyricSearch(string q, CancellationToken ct)
    {
        try
        {
            using var d = await GetDoc($"https://lrclib.net/api/search?q={Enc(q)}", ct: ct).ConfigureAwait(false);
            var words = q.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 2).ToArray();
            return d.RootElement.EnumerateArray().Take(12).Select(i =>
            {
                var body = Str(i, "syncedLyrics"); if (body.Length == 0) body = Str(i, "plainLyrics");
                var line = body.Split('\n').Select(l => Regex.Replace(l, @"\[[^\]]*\]", "").Trim()).Where(l => l.Length > 0)
                    .Select(l => (l, n: words.Count(w => l.ToLowerInvariant().Contains(w)))).Where(x => x.n > 0).OrderByDescending(x => x.n).Select(x => x.l).FirstOrDefault();
                var dur = i.TryGetProperty("duration", out var dd) && dd.ValueKind == JsonValueKind.Number ? (int)dd.GetDouble() : (int?)null;
                return new Track($"lr:{i.GetProperty("id").GetInt64()}", Str(i, "trackName"), Str(i, "artistName"), Str(i, "albumName") is { Length: > 0 } a ? a : null, null, dur, null, line);
            }).ToList();
        }
        catch { return new(); }
    }

    public async Task<List<string>> SuggestAsync(string q, CancellationToken ct = default)
    {
        foreach (var b in Piped)
        {
            try
            {
                using var d = await GetDoc($"{b}/suggestions?query={Enc(q)}", _fast, ct).ConfigureAwait(false);
                var l = d.RootElement.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).Take(8).ToList();
                if (l.Count > 0) return l;
            }
            catch { /* next */ }
        }
        return new();
    }

    public async Task<List<Track>> TrendingAsync()
    {
        try
        {
            using var d = await GetDoc("https://itunes.apple.com/us/rss/topsongs/limit=24/json").ConfigureAwait(false);
            var list = new List<Track>();
            foreach (var e in d.RootElement.GetProperty("feed").GetProperty("entry").EnumerateArray())
            {
                var imgs = e.GetProperty("im:image").EnumerateArray().ToList();
                string? preview = null;
                var link = e.GetProperty("link");
                foreach (var l in link.ValueKind == JsonValueKind.Array ? link.EnumerateArray().ToList() : new List<JsonElement> { link })
                {
                    var at = l.GetProperty("attributes");
                    if (Str(at, "type").StartsWith("audio")) preview = Str(at, "href");
                }
                list.Add(new Track("it:" + e.GetProperty("id").GetProperty("attributes").GetProperty("im:id").GetString(),
                    e.GetProperty("im:name").GetProperty("label").GetString() ?? "", e.GetProperty("im:artist").GetProperty("label").GetString() ?? "",
                    Artwork: Regex.Replace(imgs[^1].GetProperty("label").GetString() ?? "", @"\d+x\d+bb", "400x400bb"), PreviewUrl: preview));
            }
            return list;
        }
        catch { return new(); }
    }

    public async Task<List<Track>> RelatedAsync(Track t)
    {
        var via = new List<string>();
        var l = await CatalogSongs(t.Artist, via, default).ConfigureAwait(false);
        return l.Where(x => x.Id != t.Id && x.Title != t.Title).Take(15).ToList();
    }

    /* ---------------- stream resolution ---------------- */
    public async Task<Resolved?> ResolveAsync(Track t, int bitrateKbps = 320, bool video = false, CancellationToken ct = default)
    {
        string? vid = t.Id.StartsWith("yt:") ? t.Id[3..] : null;
        if (vid is null)
        {
            var found = await CatalogSongs($"{t.Artist} {t.Title}", new List<string>(), ct).ConfigureAwait(false);
            vid = found.FirstOrDefault(f => f.Id.StartsWith("yt:"))?.Id[3..];
        }
        var target = bitrateKbps * 1000;
        if (vid != null)
        {
            foreach (var b in Piped)
            {
                try
                {
                    using var d = await GetDoc($"{b}/streams/{vid}", ct: ct).ConfigureAwait(false);
                    var root = d.RootElement;
                    if (video && root.TryGetProperty("videoStreams", out var vs))
                    {
                        foreach (var v in vs.EnumerateArray())
                            if (v.TryGetProperty("videoOnly", out var vo) && !vo.GetBoolean() && Str(v, "mimeType").Contains("mp4")) return new Resolved(Str(v, "url"), "video", Host(b));
                    }
                    else if (!video && root.TryGetProperty("audioStreams", out var au) && au.GetArrayLength() > 0)
                    {
                        var sorted = au.EnumerateArray().OrderBy(a => Math.Abs((Int(a, "bitrate") ?? 0) - target)).ToList();
                        var pick = sorted.FirstOrDefault(a => Str(a, "mimeType").Contains("mp4"));
                        if (pick.ValueKind != JsonValueKind.Object) pick = sorted[0];
                        return new Resolved(Str(pick, "url"), "full", Host(b));
                    }
                }
                catch { /* next mirror */ }
            }
            if (!video)
            {
                foreach (var b in Invidious)
                {
                    try
                    {
                        using var d = await GetDoc($"{b}/api/v1/videos/{vid}?local=true", ct: ct).ConfigureAwait(false);
                        var fmts = d.RootElement.GetProperty("adaptiveFormats").EnumerateArray().Where(f => Str(f, "type").StartsWith("audio/")).ToList();
                        if (fmts.Count == 0) continue;
                        var f0 = fmts.OrderBy(f => Math.Abs((int.TryParse(Str(f, "bitrate"), out var br) ? br : 0) - target)).First();
                        var u = Str(f0, "url");
                        return new Resolved(u.StartsWith("http") ? u : b + u, "full", Host(b));
                    }
                    catch { /* next */ }
                }
            }
        }
        if (video) return null;
        var preview = t.PreviewUrl;
        if (preview is null)
        {
            try
            {
                using var d = await GetDoc($"https://itunes.apple.com/search?term={Enc(t.Artist + " " + t.Title)}&entity=song&limit=3", ct: ct).ConfigureAwait(false);
                preview = d.RootElement.GetProperty("results").EnumerateArray().Select(x => Str(x, "previewUrl")).FirstOrDefault(x => x.Length > 0);
            }
            catch { /* ignore */ }
        }
        return preview is null ? null : new Resolved(preview, "preview", "itunes-preview");
    }

    /* ---------------- lyrics ---------------- */
    public async Task<LyricsData> LyricsAsync(Track t)
    {
        static LyricsData From(JsonElement o)
        {
            var synced = new List<LyricLine>();
            var s = Str(o, "syncedLyrics");
            foreach (var raw in s.Split('\n'))
            {
                var ms = Regex.Matches(raw, @"\[(\d+):(\d+(?:\.\d+)?)\]");
                if (ms.Count == 0) continue;
                var text = Regex.Replace(raw, @"\[[^\]]*\]", "").Trim();
                foreach (Match m in ms)
                    synced.Add(new LyricLine(double.Parse(m.Groups[1].Value) * 60 + double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture), text));
            }
            return new LyricsData(synced.OrderBy(x => x.T).ToList(), Str(o, "plainLyrics"));
        }
        try
        {
            var u = $"https://lrclib.net/api/get?track_name={Enc(t.Title)}&artist_name={Enc(t.Artist)}" + (t.Duration is int d ? $"&duration={d}" : "");
            using var doc = await GetDoc(u).ConfigureAwait(false);
            return From(doc.RootElement);
        }
        catch
        {
            try
            {
                using var doc = await GetDoc($"https://lrclib.net/api/search?q={Enc(t.Artist + " " + t.Title)}").ConfigureAwait(false);
                var arr = doc.RootElement.EnumerateArray().ToList();
                var hit = arr.FirstOrDefault(x => Str(x, "syncedLyrics").Length > 0);
                if (hit.ValueKind != JsonValueKind.Object && arr.Count > 0) hit = arr[0];
                return hit.ValueKind == JsonValueKind.Object ? From(hit) : new LyricsData(new(), "");
            }
            catch { return new LyricsData(new(), ""); }
        }
    }

    /* ---------------- account ---------------- */
    public async Task<(bool Ok, string? Name, string? Error)> VerifyCookieAsync(string cookie)
    {
        var sapisid = Regex.Match(cookie, @"(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)").Groups[1].Value;
        if (sapisid.Length == 0) return (false, null, "Cookie is missing SAPISID / __Secure-3PAPISID.");
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        const string origin = "https://music.youtube.com";
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes($"{ts} {sapisid} {origin}"))).ToLowerInvariant();
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false");
            req.Headers.TryAddWithoutValidation("Cookie", cookie);
            req.Headers.TryAddWithoutValidation("Origin", origin);
            req.Headers.TryAddWithoutValidation("X-Origin", origin);
            req.Headers.TryAddWithoutValidation("Authorization", $"SAPISIDHASH {ts}_{hash}");
            req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36");
            req.Content = new StringContent("{\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240101.01.00\",\"hl\":\"en\"}}}", Encoding.UTF8, "application/json");
            using var resp = await _http.SendAsync(req).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return (false, null, $"Account endpoint returned HTTP {(int)resp.StatusCode}.");
            var text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            var m = Regex.Match(text, "\"accountName\":\\{\"runs\":\\[\\{\"text\":\"([^\"]+)\"");
            return m.Success ? (true, m.Groups[1].Value, null) : (false, null, "Session was not recognized (signed out or expired).");
        }
        catch (Exception ex) { return (false, null, ex.Message); }
    }
}
