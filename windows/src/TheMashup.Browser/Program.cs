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
