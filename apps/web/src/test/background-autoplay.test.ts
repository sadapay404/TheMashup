/**
 * Background autoplay.
 *
 * The report: "the autoplay stops when running in BG; I have to manually open the app for the next
 * song to play automatically." Thirty seconds or thirty minutes, identical.
 *
 * The cause was architectural, and that is why no amount of battery-exemption helped. ExoPlayer held
 * exactly ONE media item; the queue lived in the WebView. At the end of a track the service posted
 * `ended` to the page and called `next()` there. In the background the page is suspended, so nothing
 * ran — the service was not throttled, it was waiting for an instruction that could not arrive.
 *
 * These tests pin the shape of the fix, because it is easy to "simplify" back into the broken design:
 * the service must own a lookahead and must be able to resolve the next track without the page.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');

const service = read('apps/android/android/app/src/main/java/app/themashup/music/playback/PlaybackService.kt');
const plugin = read('apps/android/android/app/src/main/java/app/themashup/music/playback/NativeEvents.kt');
const native = read('apps/web/src/lib/native.ts');
const player = read('apps/web/src/hooks/usePlayer.ts');

describe('the native service advances without the page', () => {
  it('keeps lookahead on the player instead of a single item', () => {
    /*
     * The whole defect in one line: `setMediaItem` (replace) with nothing ever appended means the
     * player has nowhere to go at end-of-track. Appending is what lets ExoPlayer roll on by itself.
     */
    expect(service).toContain('fun append(');
    expect(service).toContain('p.addMediaItem(item)');
    // Gapless across items is required for the append to be useful at all.
    expect(service).toContain('setPauseAtEndOfMediaItems(false)');
  });

  it('refills the lookahead on every track transition', () => {
    /*
     * A one-shot prefetch is a fix that works for exactly one song and then fails. The refill has to
     * be driven by the transition, which is the moment the previous item was consumed.
     */
    const at = service.indexOf('override fun onMediaItemTransition');
    expect(at).toBeGreaterThan(-1);
    expect(service.slice(at, at + 1600)).toContain('prefetchNext()');
  });

  it('prefetches as soon as a track is ready, not only at the end', () => {
    // Pre-appending before the end is what makes the hand-off gapless; reacting to ENDED is the
    // fallback, not the mechanism.
    expect(service).toMatch(/STATE_READY[\s\S]{0,500}prefetchNext\(\)/);
    expect(service).toContain('onEndedWithNothingQueued()');
  });

  it('resolves the next stream natively, with no bridge round-trip', () => {
    // If this ever goes through the WebView, backgrounding breaks again silently.
    expect(service).toContain('Extractor.resolveStream');
    expect(service).toContain('private suspend fun resolveForBackground');
  });

  it('prefers a downloaded file so the queue survives with no signal', () => {
    expect(service).toContain('next.localPath?.let');
    expect(service).toContain('android.net.Uri.fromFile');
  });

  it('starts the appended item when the track had already ended', () => {
    /*
     * `addMediaItem` alone does not move the playhead: appended to a finished player the queue grows
     * while the speaker stays silent. The seek-and-play branch is what makes the fallback audible.
     */
    expect(service).toContain('val atEnd = p.playbackState == Player.STATE_ENDED');
    expect(service).toMatch(/atEnd\)[\s\S]{0,500}p\.seekTo\(addAt, 0L\)/);
  });

  it('does not retry a track it cannot resolve', () => {
    /*
     * A background loop that retries a dead id forever drains the battery the user was told to
     * exempt. One attempt, then it stops and reports.
     */
    expect(service).toMatch(/playable == null[\s\S]{0,900}return@launch/);
  });

  it('puts the track back when it could not be resolved', () => {
    /*
     * Taking an entry off the list and then failing on it silently *skips* that song: the next
     * prefetch starts from the one after it and neither is ever heard. The entry has to go back.
     */
    expect(service).toMatch(/playable == null[\s\S]{0,900}PlaybackService\.rewindUpcoming\(\)/);
    expect(service).toContain('fun rewindUpcoming()');
  });

  it('honours repeat-one natively', () => {
    // The page is not running, so the service is the only thing that can replay.
    expect(service).toContain('soloRepeat');
    expect(service).toContain('fun replayCurrent(');
    expect(plugin).toContain('fun setRepeat(');
  });

  it('serialises the cursor so a song cannot be appended twice', () => {
    expect(service).toContain('@Synchronized');
    expect(service).toMatch(/@Synchronized[\s\S]{0,300}private fun nextUpcoming\(\)/);
  });

  it('resets the cursor when the page loads a track itself', () => {
    /*
     * Otherwise the addressable list belongs to the previous queue and the service can pre-append a
     * song from a playlist the user has navigated away from.
     */
    expect(service).toContain('resetUpcomingCursor()');
    expect(service).toMatch(/resetUpcomingCursor\(\)[\s\S]{0,300}p\.setMediaItem\(item\)/);
  });
});

describe('the page keeps the service supplied', () => {
  it('pushes the upcoming tracks on every queue change', () => {
    expect(native).toContain('export async function nativeSetUpcoming');
    expect(player).toContain('nativeSetUpcoming(upcoming, 0)');
    // A bounded window: a second full copy of the queue is a source of truth that can drift.
    expect(player).toContain('s.queue.slice(from, from + NEXT_WINDOW)');
    // Big enough that a suspended page is not the thing keeping the session alive.
    expect(player).toMatch(/NEXT_WINDOW = 10;/);
  });

  it('does not re-send an identical list on every download progress tick', () => {
    /*
     * `downloads` is a dependency so a finished job becomes a local path, but an in-flight download
     * fires many updates a second. Without the signature check each one crosses the bridge.
     */
    expect(player).toContain('lastUpcomingKey');
    expect(player).toContain('if (key === lastUpcomingKey.current) return;');
  });

  it('sends an empty list at the end of the queue rather than nothing', () => {
    // "Nothing to send" and "this is the end" must not look the same to the service.
    expect(player).toContain('nativeSetUpcoming([], 0)');
  });

  it('hands over local paths for downloaded tracks', () => {
    expect(player).toContain('localPath: onDisk.path');
  });

  it('re-pushes when downloads change, not only when the queue does', () => {
    /*
     * `downloads.length` in the dependency array looks equivalent and is not: the length does not
     * change when a finished job gains its `path`, so the service would be handed a remote id for a
     * song that is already on disk.
     */
    expect(player).toMatch(/\}, \[queue, index, repeat, shuffle, downloads\]\);/);
    expect(player).not.toContain('downloads.length]');
  });

  it('mirrors repeat to the service', () => {
    expect(native).toContain('export async function nativeSetRepeat');
    expect(player).toContain('nativeSetRepeat(repeat)');
  });

  it('catches its index up to what the service played while suspended', () => {
    /*
     * Without this, reopening the app shows the track from before the background session and the
     * next render can restart a song that has already finished.
     */
    expect(native).toContain('export async function nativeDrainAppended');
    expect(player).toContain('nativeDrainAppended()');
    expect(plugin).toContain('fun drainAppended(');
  });
});

describe('the service can actually be told', () => {
  it('exposes setUpcoming over the bridge', () => {
    expect(plugin).toContain('fun setUpcoming(');
    expect(plugin).toContain('PlaybackService.setUpcoming(');
    expect(native).toContain("invoke('MashupPlayer', 'setUpcoming'");
  });

  it('survives a malformed extractor payload', () => {
    // A JSON shape change must not kill a background session mid-album.
    expect(service).toContain('unreadable extractor payload');
  });
});

describe('the UI follows a transition it did not cause', () => {
  it('reports the new track by id, not by index', () => {
    /*
     * Once items are trimmed from the front of the player, a player index is not a queue index. The
     * id is the only thing that survives that trimming.
     */
    expect(service).toContain('setMediaId(next.id)');
    expect(service).toContain('NativeEvents.post("nowPlaying"');
  });

  it('never reloads a track the player already started', () => {
    /*
     * `load()` here would re-resolve the song and restart it from zero: "it goes to the next track
     * and then plays it from the beginning". Only the index may move.
     */
    const at = player.indexOf("onNativeEvent('nowPlaying'");
    expect(at).toBeGreaterThan(-1);
    const handler = player.slice(at, at + 900);
    expect(handler).toContain('store.set({ index: at');
    expect(handler).not.toContain('load(');
  });

  it('unsubscribes on teardown', () => {
    expect(player).toContain('offNowPlaying();');
  });

  it('sends the track id to the native player', () => {
    expect(player).toContain('id: t.id,');
    expect(plugin).toContain('videoId = call.getString("id")');
  });
});

describe('a limitation is never a silent dead end', () => {
  it('says when this APK cannot autoplay in the background', () => {
    /*
     * The `standard` flavour ships no GPL extractor, so it cannot turn a video id into a URL without
     * the page. That is a real limitation of that build — but a session that simply stops is
     * indistinguishable from a bug, which is how it would be reported.
     */
    expect(service).toContain('autoplayUnavailable');
    expect(service).toContain('Extractor.available');
    expect(native).toContain("| 'autoplayUnavailable'");
    expect(player).toContain('withNativeExtractor APK');
  });

  it('still continues through downloaded songs with no extractor at all', () => {
    // The local-path branch returns before the extractor is ever consulted.
    const at = service.indexOf('private suspend fun resolveForBackground');
    // Until the next function declaration: the slice has to cover the whole body or the second
    // indexOf silently returns -1 and the assertion passes for the wrong reason.
    const end = service.indexOf('private fun parseExtractorJson');
    const body = service.slice(at, end);
    expect(body).toContain('localPath');
    const local = body.indexOf('localPath');
    const extractor = body.indexOf('Extractor.available');
    expect(extractor).toBeGreaterThan(-1);
    expect(local).toBeLessThan(extractor);
  });
});

describe('the Kotlin actually links', () => {
  /*
   * There is no JVM in the development sandbox, so the compiler is CI — and a single unresolved
   * reference costs a full build cycle to discover. These are the two mistakes that were actually
   * made while writing this: calling a companion member unqualified from the top-level bridge object,
   * and naming a symbol after it had been renamed.
   */
  it('qualifies companion members used from the bridge object', () => {
    const bridgeAt = service.indexOf('internal object PlaybackBridge');
    expect(bridgeAt).toBeGreaterThan(-1);
    const bridge = service.slice(bridgeAt);
    // Anything the companion owns must be reached through the class name.
    expect(bridge).toContain('PlaybackService.resetUpcomingCursor()');
    expect(bridge).not.toMatch(/[^.]\bresetUpcomingCursor\(\)/);
  });

  it('has no reference to a renamed symbol', () => {
    expect(service).not.toContain('nextUpcomingIndexReset');
    // Called from a coroutine inside the service, so it needs the same qualification.
    expect(service).toContain('PlaybackService.rewindUpcoming()');
    expect(service).toContain('resetUpcomingCursor');
  });

  it('declares the shared types at top level, not inside the companion', () => {
    /*
     * A class nested in a companion object is reachable only as `Outer.Companion.Inner`, so
     * `PlaybackService.Playable` in a signature would not resolve. Top-level is the only spelling
     * that works from the service, the companion and the plugin alike.
     */
    const companionAt = service.indexOf('companion object {');
    const companionEnd = service.indexOf('internal object PlaybackBridge');
    const companion = service.slice(companionAt, companionEnd);
    expect(companion).not.toContain('data class UpcomingTrack');
    expect(companion).not.toContain('data class Playable');
    // ...and they are declared before the service class that uses them.
    expect(service.indexOf('data class Playable')).toBeLessThan(service.indexOf('class PlaybackService'));
  });

  it('does not reference the nested spelling anywhere', () => {
    expect(service).not.toContain('PlaybackService.Playable');
    expect(service).not.toContain('PlaybackService.UpcomingTrack');
    expect(plugin).not.toContain('PlaybackService.UpcomingTrack');
    expect(plugin).not.toContain('PlaybackService.Playable');
  });
});
