using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Styling;
using TheMashup.Core;
using TheMashup.UI.Views;

namespace TheMashup.UI;

public partial class App : Application
{
    // Each platform head supplies a real local store before initializing Avalonia.
    public static IThemeStore? ThemeStore { get; set; }
    public static ILibraryStore? LibraryStore { get; set; }
    public static ISearchService? SearchService { get; set; }
    public static IPlaybackResolver? PlaybackResolver { get; set; }
    public static IMediaDevice? MediaDevice { get; set; }
    public static Func<Control>? VideoSurfaceFactory { get; set; }
    public static Action<double, double, double, double, bool>? VideoBoundsChanged { get; set; }
    public static Func<Window, PlaybackController, IDisposable?>? DesktopTransportFactory { get; set; }

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        var selection = new ThemeSelection(ThemeStore ??
            throw new InvalidOperationException("A platform theme store is required."));
        ApplyTheme(selection.Current);
        selection.Changed += (_, _) => ApplyTheme(selection.Current);
        var library = new Library(LibraryStore ??
            throw new InvalidOperationException("A platform library store is required."));
        var model = new ShellViewModel(selection, library, SearchService, PlaybackResolver, MediaDevice);

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var window = new MainWindow { DataContext = model };
            desktop.MainWindow = window;
            IDisposable? transport = null;
            window.Opened += (_, _) =>
            {
                if (model.Player.Controller is { } controller)
                    transport = DesktopTransportFactory?.Invoke(window, controller);
            };
            desktop.Exit += (_, _) => { transport?.Dispose(); model.Search.Dispose(); model.Player.Dispose(); };
        }
        else if (ApplicationLifetime is ISingleViewApplicationLifetime browser)
            browser.MainView = new MainView { DataContext = model };

        base.OnFrameworkInitializationCompleted();
    }

    private void ApplyTheme(ThemePalette theme)
    {
        var colors = new Dictionary<string, string>
        {
            ["AppBackground"] = theme.Background,
            ["SidebarBackground"] = theme.Sidebar,
            ["Surface"] = theme.Surface,
            ["RaisedSurface"] = theme.RaisedSurface,
            ["PrimaryText"] = theme.Text,
            ["MutedText"] = theme.Muted,
            ["SubtleText"] = theme.Subtle,
            ["Accent"] = theme.Accent,
            ["AccentSecondary"] = theme.AccentSecondary,
            ["AccentText"] = theme.AccentText,
            ["Outline"] = theme.Border,
            ["HeroStart"] = theme.HeroStart,
            ["HeroEnd"] = theme.HeroEnd,
        };
        foreach (var (name, value) in colors)
            Resources[name] = new SolidColorBrush(Color.Parse(value));
        RequestedThemeVariant = theme.IsLight ? ThemeVariant.Light : ThemeVariant.Dark;
    }
}
