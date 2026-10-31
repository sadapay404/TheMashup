using System.Diagnostics;
using TheMashup.Core;

namespace TheMashup.Desktop;

/// <summary>
/// Starts the search-only Express/FastAPI development host on demand. No user
/// starts a separate service or enters a LAN address. Final packaging must bundle
/// the Node/Python runtimes and dependencies; that is deliberately not done yet.
/// </summary>
internal sealed class LocalSearchHost : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Process? _process;
    private Uri? _endpoint;
    private bool _disposed;

    public async Task<Uri> GetEndpointAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_process is { HasExited: false } && _endpoint is not null) return _endpoint;
            StopProcess();
            var script = FindHostScript();
            if (script is null) throw new SearchProviderException("The local search host is not included in this build.");
            var start = new ProcessStartInfo
            {
                FileName = Environment.GetEnvironmentVariable("THEMASHUP_NODE_PATH") ?? "node",
                WorkingDirectory = Path.GetDirectoryName(script)!,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            start.ArgumentList.Add(script);
            // The host exits if this pipe closes, including on an app crash.
            start.Environment["THEMASHUP_PARENT_PIPE"] = "1";
            var process = new Process { StartInfo = start };
            _process = process;
            try
            {
                if (!process.Start()) throw new InvalidOperationException("Could not start the local search host.");
                process.ErrorDataReceived += (_, e) => { if (e.Data is not null) Trace.WriteLine(e.Data); };
                process.BeginErrorReadLine();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(35));
                var line = await process.StandardOutput.ReadLineAsync(timeout.Token);
                const string prefix = "THEMASHUP_HOST_PORT=";
                if (line is null || !line.StartsWith(prefix, StringComparison.Ordinal) ||
                    !int.TryParse(line[prefix.Length..], out var port) || port is < 1 or > 65535)
                    throw new InvalidOperationException("The local search host did not report a port.");
                _endpoint = new Uri($"http://127.0.0.1:{port}/");
                // Drain any future diagnostics so an unexpected output cannot block it.
                _ = DrainOutputAsync(process);
                return _endpoint;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                StopProcess();
                throw;
            }
            catch (Exception)
            {
                StopProcess();
                throw new SearchProviderException("The local search host could not start. This development build needs its Node and Python dependencies.");
            }
        }
        finally { _gate.Release(); }
    }

    private static async Task DrainOutputAsync(Process process)
    {
        try { while (await process.StandardOutput.ReadLineAsync() is not null) { } }
        catch (Exception) { /* process closed during shutdown */ }
    }

    private static string? FindHostScript()
    {
        var explicitPath = Environment.GetEnvironmentVariable("THEMASHUP_SEARCH_HOST");
        if (!string.IsNullOrWhiteSpace(explicitPath) && File.Exists(explicitPath)) return Path.GetFullPath(explicitPath);

        // Look next to the executable first (publish output bundles host.mjs as content).
        var baseDir = AppContext.BaseDirectory;
        var candidate = Path.Combine(baseDir, "host.mjs");
        if (File.Exists(candidate)) return candidate;

        // Fall back to walking up the directory tree (source-tree layout).
        for (var dir = new DirectoryInfo(baseDir); dir is not null; dir = dir.Parent)
        {
            candidate = Path.Combine(dir.FullName, "windows", "services", "host.mjs");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private void StopProcess()
    {
        var process = _process;
        _process = null; _endpoint = null;
        if (process is null) return;
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
        finally { process.Dispose(); }
    }

    public void Dispose()
    {
        _disposed = true;
        StopProcess();
    }
}
