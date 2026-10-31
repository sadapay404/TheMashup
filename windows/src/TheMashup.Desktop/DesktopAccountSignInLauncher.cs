using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Platform;
using TheMashup.Core;

namespace TheMashup.Desktop;

internal sealed class DesktopAccountSignInLauncher : IAccountSignInLauncher
{
    private static readonly string[] CookieDomains = { ".google.com", ".youtube.com", ".music.youtube.com" };

    public async Task<AccountSnapshot> LaunchAsync(CancellationToken cancellationToken)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var userDataFolder = Path.Combine(root, "TheMashup", "signin-webview");
        var window = new Window
        {
            Title = "Connect your YouTube account",
            Width = 920,
            Height = 680,
        };
        var webView = new NativeWebView();
        webView.EnvironmentRequested += (_, e) =>
        {
            if (e is WindowsWebView2EnvironmentRequestedEventArgs args)
            {
                args.UserDataFolder = userDataFolder;
                args.ProfileName = "signin";
                args.IsInPrivateModeEnabled = false;
            }
        };

        var completion = new TaskCompletionSource<AccountSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var linked = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var linkedToken = linked.CancellationToken;
        linkedToken.Register(() => completion.TrySetCanceled(linkedToken));
        window.Closed += (_, _) => completion.TrySetCanceled();
        webView.NavigationCompleted += async (_, _) =>
        {
            if (webView.Source?.Host != "music.youtube.com") return;
            try
            {
                var cookieManager = webView.TryGetCookieManager();
                IReadOnlyList<Cookie> cookies = cookieManager is { } manager ? await manager.GetCookiesAsync() : new CookieCollection();
                var cookie = BuildCookieHeader(cookies);
                var client = new YouTubeMusicHomeClient();
                var snapshot = await client.VerifyAsync(cookie, linkedToken);
                completion.TrySetResult(snapshot);
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        };

        window.Content = webView;
        webView.Source = new Uri(YouTubeMusicHomeClient.GoogleLoginUrl);
        window.Show();

        try
        {
            return await completion.Task.WaitAsync(linkedToken);
        }
        catch (OperationCanceledException)
        {
            throw new HomeProviderException("Sign-in was cancelled or closed.");
        }
        catch (Exception ex)
        {
            throw ex is HomeProviderException ? ex : new HomeProviderException("Could not complete YouTube sign-in. Please try again.");
        }
    }

    private static string BuildCookieHeader(IReadOnlyList<Cookie> cookies)
    {
        var parts = cookies.Cast<Cookie>()
            .Where(cookie => cookie.Name is not null && cookie.Value is not null &&
                CookieDomains.Any(domain => cookie.Domain?.Contains(domain) == true))
            .Select(cookie => $"{cookie.Name}={Uri.EscapeDataString(cookie.Value)}")
            .ToArray();
        return string.Join("; ", parts);
    }
}
