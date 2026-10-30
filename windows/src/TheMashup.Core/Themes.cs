namespace TheMashup.Core;

/// <summary>UI-neutral color tokens shared by the desktop and browser heads.</summary>
public sealed record ThemePalette(
    string Id,
    string Name,
    string Description,
    string Background,
    string Sidebar,
    string Surface,
    string RaisedSurface,
    string Text,
    string Muted,
    string Subtle,
    string Accent,
    string AccentSecondary,
    string AccentText,
    string Border,
    string HeroStart,
    string HeroEnd,
    bool IsLight = false);

public static class ThemeCatalog
{
    // IDs and principal colors match the existing TheMashup themes.
    private static readonly ThemePalette[] AllThemes =
    [
        new("frosted", "Frosted Glass", "Dark · glass",
            "#0A0A0F", "#101018", "#15151F", "#1D1D2A", "#F4F4F8", "#A3A3B5", "#88889E",
            "#9B80FF", "#4DD0FF", "#0B0B12", "#2C2C3B", "#282442", "#171724"),
        new("paper-ink", "Paper & Ink", "Light · typographic",
            "#F4EFE4", "#ECE5D6", "#FFFDF7", "#EDE6DA", "#211C14", "#6C6353", "#796F5F",
            "#B3441F", "#2F5D50", "#FFFDF7", "#D6CDBE", "#EBDAC6", "#F9F2E6", true),
        new("neon", "Neon Cyber", "Dark · electric",
            "#04060B", "#080C14", "#0C141A", "#102125", "#E8FEFF", "#8ACDC8", "#75A7A3",
            "#00DDB0", "#FF3EC8", "#02120E", "#1B4742", "#10302C", "#0B161C"),
        new("aurora", "Aurora", "Dark · atmospheric",
            "#0A1022", "#0E1730", "#121D39", "#1A294A", "#EEF2FF", "#A8B9DF", "#8A9BC5",
            "#6EE7FF", "#B490FF", "#06121A", "#2B3E68", "#18334D", "#1E2144"),
        new("vinyl", "Vinyl", "Warm · retro",
            "#16110D", "#1D1712", "#261D17", "#30251D", "#F3E9DC", "#BFAE99", "#A59581",
            "#E8A33D", "#BD5959", "#1A1109", "#48392C", "#493024", "#281E18")
    ];

    public static IReadOnlyList<ThemePalette> All { get; } = Array.AsReadOnly(AllThemes);
    public static ThemePalette Default => AllThemes[0];
    public static ThemePalette? Find(string? id) => AllThemes.FirstOrDefault(theme => theme.Id == id);
}

public interface IThemeStore
{
    string? Read();
    bool TryWrite(string themeId);
}

/// <summary>Selection state; a failed write is visible to the caller, not silently reported as saved.</summary>
public sealed class ThemeSelection
{
    private readonly IThemeStore _store;

    public ThemeSelection(IThemeStore store)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        string? saved = null;
        try { saved = _store.Read(); }
        catch { /* Unreadable preferences must not prevent the app from opening. */ }
        Current = ThemeCatalog.Find(saved) ?? ThemeCatalog.Default;
    }

    public ThemePalette Current { get; private set; }
    public bool LastWriteSucceeded { get; private set; } = true;
    public event EventHandler? Changed;

    public bool Select(string? themeId)
    {
        var next = ThemeCatalog.Find(themeId);
        if (next is null) return false;

        Current = next;
        try { LastWriteSucceeded = _store.TryWrite(next.Id); }
        catch { LastWriteSucceeded = false; }
        Changed?.Invoke(this, EventArgs.Empty);
        return true;
    }
}
