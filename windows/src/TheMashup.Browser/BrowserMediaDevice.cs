using System.Runtime.InteropServices.JavaScript;
using TheMashup.Core;

namespace TheMashup.Browser;

/// <summary>The preview uses a real same-origin HTML media element, not a Windows WebView.</summary>
internal sealed partial class BrowserMediaDevice : IMediaDevice
{
    private static BrowserMediaDevice? _current;
    public BrowserMediaDevice() => _current = this;
    public event EventHandler<MediaDeviceEvent>? Changed;

    [JSImport("globalThis.themashupMedia.open")]
    private static partial void OpenMedia(string url, bool video, double attempt, double resumeAt);
    [JSImport("globalThis.themashupMedia.play")]
    private static partial void PlayMedia();
    [JSImport("globalThis.themashupMedia.pause")]
    private static partial void PauseMedia();
    [JSImport("globalThis.themashupMedia.stop")]
    private static partial void StopMedia();
    [JSImport("globalThis.themashupMedia.seek")]
    private static partial void SeekMedia(double seconds);
    [JSImport("globalThis.themashupMedia.volume")]
    private static partial void VolumeMedia(double volume);
    [JSImport("globalThis.themashupMedia.bounds")]
    internal static partial void SetVideoBounds(double x, double y, double width, double height, bool visible);

    public void Open(PlaybackCandidate candidate, PlaybackMode mode, long attempt, double resumeAtSeconds) =>
        OpenMedia(candidate.PlayUri.ToString(), mode == PlaybackMode.Video, attempt, resumeAtSeconds);
    public void Play() => PlayMedia();
    public void Pause() => PauseMedia();
    public void Stop() => StopMedia();
    public void Seek(double seconds) => SeekMedia(seconds);
    public void SetVolume(double volume) => VolumeMedia(volume);
    public void Dispose() { StopMedia(); if (ReferenceEquals(_current, this)) _current = null; }
    internal static void Emit(double attempt, int signal, double position, double duration)
    {
        if (_current is not { } current || signal < 0 || signal > (int)MediaSignal.DeviceFailed) return;
        current.Changed?.Invoke(current, new MediaDeviceEvent((long)attempt, (MediaSignal)signal, position, duration));
    }
}

internal static partial class BrowserMediaBridge
{
    [JSExport]
    internal static void OnEvent(double attempt, int signal, double position, double duration) =>
        BrowserMediaDevice.Emit(attempt, signal, position, duration);
}
