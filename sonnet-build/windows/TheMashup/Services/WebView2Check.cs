using Microsoft.Win32;

namespace TheMashup.Services;

public static class WebView2Check
{
    public const string DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private const string Guid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    /// <summary>True when the Evergreen WebView2 runtime is installed. Never throws.</summary>
    public static bool IsInstalled()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            string[] keys =
            {
                $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{Guid}",
                $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{Guid}",
            };
            foreach (var k in keys)
            {
                using var lm = Registry.LocalMachine.OpenSubKey(k);
                if (lm?.GetValue("pv") is string v && v.Length > 0 && v != "0.0.0.0") return true;
            }
            using var cu = Registry.CurrentUser.OpenSubKey($@"Software\Microsoft\EdgeUpdate\Clients\{Guid}");
            return cu?.GetValue("pv") is string s && s.Length > 0 && s != "0.0.0.0";
        }
        catch { return false; }
    }
}
