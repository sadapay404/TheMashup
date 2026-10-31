using Avalonia;
using TheMashup.Core;
using TheMashup.UI;

namespace TheMashup.Desktop;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        App.ThemeStore = new FileThemeStore(Path.Combine(root, "TheMashup", "appearance.txt"));
        App.LibraryStore = new FileLibraryStore(Path.Combine(root, "TheMashup", "library.json"));
        using var host = new LocalSearchHost();
        using var http = new HttpClient();
        App.SearchService = new GatewaySearchClient(http, host.GetEndpointAsync);
        App.PlaybackResolver = new GatewayPlaybackClient(http, host.GetEndpointAsync);
        App.DownloadService = new GatewayDownloadClient(http, host.GetEndpointAsync);
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
