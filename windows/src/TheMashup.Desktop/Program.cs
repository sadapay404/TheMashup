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
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .WithInterFont()
        .LogToTrace();
}
