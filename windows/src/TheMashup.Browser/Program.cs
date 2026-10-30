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
        // Main receives the browser URL from main.js; all requests stay on this
        // origin and are proxied server-side, never to the viewer's localhost.
        var origin = args.Length > 0 ? new Uri(new Uri(args[0]).GetLeftPart(UriPartial.Authority) + "/")
            : throw new InvalidOperationException("The browser preview origin is missing.");
        var http = new HttpClient();
        App.SearchService = new GatewaySearchClient(http, _ => Task.FromResult(origin));
        App.PlaybackResolver = new GatewayPlaybackClient(http, _ => Task.FromResult(origin));
        App.MediaDevice = new BrowserMediaDevice();
        App.VideoBoundsChanged = BrowserMediaDevice.SetVideoBounds;
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
