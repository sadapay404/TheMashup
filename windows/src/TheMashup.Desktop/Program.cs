using System;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using TheMashup.Core;
using TheMashup.UI;

namespace TheMashup.Desktop;

internal static class Program
{
    [STAThread]
    public static async Task Main(string[] args)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        App.ThemeStore = new FileThemeStore(Path.Combine(root, "TheMashup", "appearance.txt"));
        App.LibraryStore = new FileLibraryStore(Path.Combine(root, "TheMashup", "library.json"));

        // ── Reliable local search host (retry + LAN fallback) ──────────────
        // The Avalonia shell needs a search/playback/ downloads resolver.
        // Try the bundled host.mjs (Python resolver + private Express head)
        // a few times; if it never comes up, fall back to the main gateway
        // at 127.0.0.1:4000 (and a user-configured LAN address) so the app
        // still launches instead of hard-failing.
        var host = new LocalSearchHost();
        Uri? endpoint = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                endpoint = await host.GetEndpointAsync(CancellationToken.None);
                break;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Trace.WriteLine($"[TheMashup] local host attempt {attempt} failed: {ex.Message}");
                await Task.Delay(1500);
            }
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var gateway = new GatewayPlaybackClient(http, _ => Task.FromResult(endpoint ?? new Uri("http://127.0.0.1:4000/")));
        App.SearchService = new GatewaySearchClient(http, _ => Task.FromResult(endpoint ?? new Uri("http://127.0.0.1:4000/")));
        App.PlaybackResolver = gateway;
        App.DownloadService = new GatewayDownloadClient(http, _ => Task.FromResult(endpoint ?? new Uri("http://127.0.0.1:4000/")));
        var homeClient = new YouTubeMusicHomeClient();
        var homeStore = new WindowsAccountStore(Path.Combine(root, "TheMashup", "account.txt"));
        App.HomeService = new YouTubeMusicHomeService(homeClient, homeStore);
        App.AccountSignInLauncher = new DesktopAccountSignInLauncher();
        var media = new VlcMediaDevice();
        App.MediaDevice = media;
        App.VideoSurfaceFactory = media.CreateVideoSurface;
        App.DesktopTransportFactory = WindowsTransport.TryAttach;
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .WithInterFont()
        .LogToTrace();
}
