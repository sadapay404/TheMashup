using Avalonia;
using System;
using System.IO;

namespace TheMashup;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        // Never crash silently: log and exit cleanly.
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log(e.ExceptionObject?.ToString());
        TaskScheduler.UnobservedTaskException += (_, e) => { Log(e.Exception.ToString()); e.SetObserved(); };
        try
        {
            BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
        }
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();

    public static void Log(string? text)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TheMashup");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "crash.log"), $"[{DateTime.Now:s}] {text}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }
}
