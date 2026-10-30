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
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .WithInterFont()
        .LogToTrace();
}
