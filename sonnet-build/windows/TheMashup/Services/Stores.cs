using System.Text.Json;
using System.Text.Json.Serialization;

namespace TheMashup.Services;

public sealed class AppSettings
{
    public string Theme { get; set; } = "frosted";
    public int Crossfade { get; set; } = 3;
    public bool Gapless { get; set; } = true;
    public bool Normalize { get; set; }
    public int NormStrength { get; set; } = 50;
    public double Rate { get; set; } = 1.0;
    public string Eq { get; set; } = "flat";
    public int Volume { get; set; } = 80;
    public RepeatMode Repeat { get; set; } = RepeatMode.Off;
    public bool Shuffle { get; set; }
    public string Cookie { get; set; } = "";
    public string AccountName { get; set; } = "";
    public string HostUrl { get; set; } = "http://127.0.0.1:8787";
    public string DownloadQuality { get; set; } = "192";
}

public static class AppPaths
{
    public static string Root { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TheMashup");
    public static string Downloads { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "TheMashup");
}

internal static class Json
{
    public static readonly JsonSerializerOptions Opts = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };
}

/// <summary>File-backed settings (%AppData%\TheMashup\settings.json). Theme choice persists here.</summary>
public static class SettingsStore
{
    private static string FilePath => Path.Combine(AppPaths.Root, "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), Json.Opts) ?? new();
        }
        catch (Exception ex) { Program.Log("settings load: " + ex.Message); }
        return new AppSettings();
    }

    public static void Save(AppSettings s)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(s, Json.Opts));
        }
        catch (Exception ex) { Program.Log("settings save: " + ex.Message); }
    }
}

public sealed class PlaylistData
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public List<Track> Tracks { get; set; } = new();
}

public sealed class DownloadedTrack
{
    public Track Track { get; set; } = new("", "", "");
    public string Quality { get; set; } = "";
    public string Path { get; set; } = "";
    public long Size { get; set; }
}

public sealed class LibraryData
{
    public List<Track> Liked { get; set; } = new();
    public List<Track> History { get; set; } = new();
    public List<PlaylistData> Playlists { get; set; } = new();
    public List<DownloadedTrack> Downloads { get; set; } = new();
}

/// <summary>Playlists, liked songs, history (last 50) and downloads, persisted to library.json.</summary>
public sealed class LibraryStore
{
    private static string FilePath => Path.Combine(AppPaths.Root, "library.json");
    public LibraryData Data { get; private set; } = new();
    public event Action? Changed;

    public LibraryStore()
    {
        try
        {
            if (File.Exists(FilePath)) Data = JsonSerializer.Deserialize<LibraryData>(File.ReadAllText(FilePath), Json.Opts) ?? new();
            Data.Downloads.RemoveAll(d => !File.Exists(d.Path));
        }
        catch (Exception ex) { Program.Log("library load: " + ex.Message); Data = new(); }
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Data, Json.Opts));
        }
        catch (Exception ex) { Program.Log("library save: " + ex.Message); }
        Changed?.Invoke();
    }

    public bool IsLiked(string id) => Data.Liked.Any(t => t.Id == id);
    public void ToggleLike(Track t)
    {
        if (Data.Liked.RemoveAll(x => x.Id == t.Id) > 0) { Save(); return; }
        Data.Liked.Insert(0, t);
        Save();
    }

    public void AddHistory(Track t) { Data.History.Insert(0, t); if (Data.History.Count > 50) Data.History.RemoveRange(50, Data.History.Count - 50); Save(); }
    public void ClearHistory() { Data.History.Clear(); Save(); }

    public PlaylistData CreatePlaylist(string name)
    {
        var p = new PlaylistData { Id = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Name = name.Trim() };
        Data.Playlists.Add(p);
        Save();
        return p;
    }

    public void RenamePlaylist(long id, string name) { var p = Data.Playlists.FirstOrDefault(x => x.Id == id); if (p != null && name.Trim().Length > 0) { p.Name = name.Trim(); Save(); } }
    public void DeletePlaylist(long id) { Data.Playlists.RemoveAll(x => x.Id == id); Save(); }
    public void AddToPlaylist(long id, Track t) { var p = Data.Playlists.FirstOrDefault(x => x.Id == id); if (p != null && p.Tracks.All(x => x.Id != t.Id)) { p.Tracks.Add(t); Save(); } }
    public void RemoveFromPlaylist(long id, string trackId) { var p = Data.Playlists.FirstOrDefault(x => x.Id == id); if (p != null) { p.Tracks.RemoveAll(x => x.Id == trackId); Save(); } }

    public void AddDownload(DownloadedTrack d)
    {
        Data.Downloads.RemoveAll(x => x.Track.Id == d.Track.Id && x.Quality == d.Quality);
        Data.Downloads.Insert(0, d);
        Save();
    }

    public void RemoveDownload(DownloadedTrack d)
    {
        try { File.Delete(d.Path); } catch { /* ignore */ }
        Data.Downloads.RemoveAll(x => x.Path == d.Path);
        Save();
    }

    public string? DownloadedPath(string trackId) =>
        Data.Downloads.FirstOrDefault(d => d.Track.Id == trackId && File.Exists(d.Path))?.Path;
}
