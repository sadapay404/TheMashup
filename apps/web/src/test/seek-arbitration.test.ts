import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Seeking, end to end.
 *
 * Reported as: "playback can't be skipped. If I wanna listen music from mid, it won't let me and
 * starts from 0:00."
 *
 * There were two writers of the playhead and no arbitration between them:
 *
 *  - `seek()` optimistically writes the target into the store and tells Media3;
 *  - a 1 Hz poll asks Media3 for its position and writes *that* back.
 *
 * The poll's answer describes the player as it was when the question was asked, and Media3 answers
 * before it has necessarily processed the seek (a seek into unbuffered audio is a network request).
 * So the poll kept writing the old offset back, and the next `load()` used it as the resume point —
 * which is why the song restarted rather than continuing from where it was told to.
 *
 * These assertions pin the arbitration rather than the implementation: a seek must suppress the
 * poll for a bounded window, and the suppression must be temporary.
 */
describe('seek does not get overwritten by the position poll', () => {
  const hooks = readFileSync(resolve(__dirname, '../hooks/usePlayer.ts'), 'utf8');
  const native = readFileSync(
    resolve(__dirname, '../../../android/android/app/src/main/java/app/themashup/music/playback/PlaybackService.kt'),
    'utf8',
  );

  it('has a settle window rather than trusting the poll immediately', () => {
    expect(hooks).toMatch(/SEEK_SETTLE_MS\s*=\s*\d+/);
  });

  it('records the target before the native call, not after', () => {
    // If the guard were set after `await nativeSeek(...)`, the poll racing the call would still win.
    const seekFn = hooks.slice(hooks.indexOf('const seek = useCallback'), hooks.indexOf('const seekBy'));
    const guardAt = seekFn.indexOf('seekGuard.current =');
    const callAt = seekFn.indexOf('nativeSeek(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(callAt);
  });

  it('skips the position write while settling but still updates duration', () => {
    // Duration never depends on the playhead, so suppressing it too would leave the bar's scale
    // wrong for the rest of the song.
    const tick = hooks.slice(hooks.indexOf('const settling ='), hooks.indexOf('const st = await nativeState()'));
    expect(tick).toContain('SEEK_SETTLE_MS');
    expect(hooks).toMatch(/if \(settling\) \{[\s\S]{0,260}durationSec/);
  });

  it('releases the guard, so a stuck flag cannot freeze the progress bar', () => {
    expect(hooks).toContain('if (guard !== null) seekGuard.current = null;');
  });

  it('the native side agrees with the optimistic value instead of reverting it', () => {
    // `getState()` calls refreshCache() → snapshot(player). If the seek had not been applied yet,
    // that snapshot wrote the old offset back over the target.
    const seekTo = native.slice(native.indexOf('fun seekTo(ms: Long)'));
    expect(seekTo).toContain('p.seekTo(target)');
    expect(seekTo).toMatch(/p\.seekTo\(target\)\s*\n\s*snapshot\(p\)/);
  });
});
