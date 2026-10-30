using LibVLCSharp.Shared;
using Xunit;

namespace TheMashup.Windows.Tests;

public sealed class NativePlaybackTests
{
    [Fact]
    public async Task WindowsX64LibVlcDecodesARealLocalWavAndSupportsPauseAndSeek()
    {
        Assert.True(OperatingSystem.IsWindows());
        Assert.True(Environment.Is64BitProcess);
        var path = Path.Combine(Path.GetTempPath(), $"themashup-native-{Guid.NewGuid():N}.wav");
        await File.WriteAllBytesAsync(path, WavTone(seconds: 8));
        try
        {
            LibVLCSharp.Shared.Core.Initialize();
            // The hosted runner has no physical audio device. VLC still opens,
            // decodes and advances the WAV; only output is directed to /dev/null.
            using var vlc = new LibVLC("--aout=adummy", "--no-video");
            using var media = new Media(vlc, new Uri(path));
            using var player = new MediaPlayer(vlc) { Media = media };
            var playing = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var moving = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var paused = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var sought = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var failed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            player.Playing += (_, _) => playing.TrySetResult();
            player.TimeChanged += (_, e) =>
            {
                if (e.Time > 100) moving.TrySetResult();
                if (e.Time >= 2200) sought.TrySetResult();
            };
            player.Paused += (_, _) => paused.TrySetResult();
            player.EncounteredError += (_, _) => failed.TrySetResult();
            Assert.True(player.Play());
            await RequireSignal(playing.Task, failed.Task);
            await RequireSignal(moving.Task, failed.Task);
            player.SetPause(true);
            await RequireSignal(paused.Task, failed.Task);
            Assert.True(player.IsSeekable);
            player.Time = 2500;
            player.SetPause(false);
            await RequireSignal(sought.Task, failed.Task);
            // Stop from the test thread, never from a VLC native callback.
            player.Stop();
        }
        finally { File.Delete(path); }
    }

    private static async Task RequireSignal(Task expected, Task failed)
    {
        var timeout = Task.Delay(TimeSpan.FromSeconds(20));
        var completed = await Task.WhenAny(expected, failed, timeout);
        Assert.Same(expected, completed);
        await expected;
    }

    private static byte[] WavTone(int seconds)
    {
        const int rate = 8000;
        var sampleCount = rate * seconds;
        using var memory = new MemoryStream();
        using var writer = new BinaryWriter(memory);
        writer.Write("RIFF"u8); writer.Write(36 + sampleCount * 2); writer.Write("WAVE"u8);
        writer.Write("fmt "u8); writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(rate); writer.Write(rate * 2); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(sampleCount * 2);
        for (var i = 0; i < sampleCount; i++) writer.Write((short)(Math.Sin(2 * Math.PI * 440 * i / rate) * 3000));
        return memory.ToArray();
    }
}
