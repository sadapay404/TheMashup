using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Avalonia;
using Avalonia.Browser;
using TheMashup.Core;
using TheMashup.UI;

[assembly: SupportedOSPlatform("browser")]

namespace TheMashup.Browser;

internal static partial class Program
{
    private static Task Main(string[] args)
    {
        App.ThemeStore = new BrowserThemeStore();
        App.LibraryStore = new BrowserLibraryStore();
        return AppBuilder.Configure<App>()
            .WithInterFont()
            .StartBrowserAppAsync("out", new BrowserPlatformOptions
            {
                RenderingMode = [BrowserRenderingMode.WebGL2, BrowserRenderingMode.WebGL1, BrowserRenderingMode.Software2D]
            });
    }
}

internal sealed partial class BrowserThemeStore : IThemeStore
{
    [JSImport("globalThis.themashupPreferences.readTheme")]
    private static partial string? ReadTheme();

    [JSImport("globalThis.themashupPreferences.writeTheme")]
    private static partial bool WriteTheme(string themeId);

    public string? Read() => ReadTheme();
    public bool TryWrite(string themeId) => WriteTheme(themeId);
}

internal sealed partial class BrowserLibraryStore : ILibraryStore
{
    [JSImport("globalThis.themashupPreferences.readLibrary")]
    private static partial string? ReadLibrary();

    [JSImport("globalThis.themashupPreferences.writeLibrary")]
    private static partial bool WriteLibrary(string content);

    public LibraryReadResult Read()
    {
        try
        {
            var value = ReadLibrary();
            return value is null ? new(false, null) : new(true, value.Length == 0 ? null : value[1..]);
        }
        catch { return new(false, null); }
    }

    public bool TryWrite(string content)
    {
        try { return WriteLibrary(content); }
        catch { return false; }
    }
}
