namespace TheMashup.Core;

public enum PlaybackMode { Audio, Video }
public enum PlaybackState { Idle, Resolving, Buffering, Playing, Paused, Ended, Error }
public enum RepeatMode { Off, All, One }
public enum MediaSignal { Playing, Paused, Time, Ended, Failed, Blocked, DeviceFailed }

/// <summary>Media signals carry an attempt ID so callbacks from old tracks are ignored.</summary>
public sealed record MediaDeviceEvent(long Attempt, MediaSignal Signal,
    double Position = 0, double Duration = 0, string? Message = null);

public sealed record PlaybackCandidate(Uri PlayUri, string Source, bool HasVideo, string Quality);
public sealed record PlaybackResolution(IReadOnlyList<PlaybackCandidate> Candidates, bool Degraded);

public interface IPlaybackResolver
{
    Task<PlaybackResolution> ResolveAsync(string videoId, PlaybackMode mode, string after,
        bool refresh, CancellationToken cancellationToken);
}

/// <summary>Platform-owned media player. Events must be raised on the UI thread.</summary>
public interface IMediaDevice : IDisposable
{
    event EventHandler<MediaDeviceEvent>? Changed;
    void Open(PlaybackCandidate candidate, PlaybackMode mode, long attempt, double resumeAtSeconds);
    void Play();
    void Pause();
    void Stop();
    void Seek(double seconds);
    void SetVolume(double volume);
    void SetPlaybackRate(double rate);
    void SetEqualizerPreset(string preset);
    void SetEqualizerBand(int band, double gainDb);
    void SetNormalization(bool enabled, int strength);
}

public sealed class PlaybackProviderException(string message) : Exception(message) { }
