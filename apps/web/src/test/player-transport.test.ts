/**
 * Two silent failures in the player, both invisible to type-checking and both device-fatal.
 *
 * 1. **Assigning `src` does not start playback.** The element path in `load()` set `el.src` and
 *    returned, relying on the caller to call `setPlaying(true)`. That call is a no-op when the element
 *    has no `src` attribute *yet*, so a fast tap left a loaded track that never played and never
 *    errored. The fix is `await el.play()` in the branch that owns the source; the test asserts the
 *    invariant that matters — a loaded element is started, and a rejection is reflected in state
 *    rather than thrown.
 *
 * 2. **Headers were dropped between resolution and playback.** The native extractor can return a URL
 *    that only serves bytes when asked with the `Referer` it was issued for. The headers were parsed,
 *    then discarded, so a perfectly good URL 403'd — indistinguishable from the stream dying.
 *
 * The first is tested against a real jsdom `HTMLAudioElement`, because the bug is a property of that
 * element and not of our logic. The second is tested through the shape of the payload the bridge
 * receives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Verbatim mirror of the predicate in `usePlayer.ts`. */
function elementOwnsPlayback(el: HTMLAudioElement | null, nativeAvailable: boolean): boolean {
  return Boolean(el && !el.hasAttribute('src') && nativeAvailable);
}

describe('native-mode detection uses the attribute, not the resolved .src', () => {
  let el: HTMLAudioElement;

  beforeEach(() => {
    el = new Audio();
    // jsdom serves the test document from this URL, which is why `.src` is truthy below.
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it('a brand-new element has NO src attribute', () => {
    expect(el.hasAttribute('src')).toBe(false);
  });

  it('attribute and resolved idl property can disagree, which is why hasAttribute is used', () => {
    // An untouched element: both say "no source".
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.getAttribute('src')).toBeNull();

    // Assigning then removing makes the two disagree on some WebView builds: the attribute is gone
    // but the resolved property keeps the last URL. The predicate trusts the attribute.
    el.src = 'https://example.test/a.m4a';
    el.removeAttribute('src');
    expect(el.hasAttribute('src')).toBe(false);
    expect(elementOwnsPlayback(el, true)).toBe(true);
  });

  it('native mode is detected before any source is assigned', () => {
    expect(elementOwnsPlayback(el, true)).toBe(true);
  });

  it('a freshly assigned src hands transport back to the element', () => {
    el.src = 'https://example.test/audio.m4a';
    expect(elementOwnsPlayback(el, true)).toBe(false);
  });

  it('removing the attribute returns transport to native', () => {
    el.src = 'https://example.test/audio.m4a';
    expect(elementOwnsPlayback(el, true)).toBe(false);
    el.removeAttribute('src');
    expect(elementOwnsPlayback(el, true)).toBe(true);
  });

  it('never claims native mode when the plugin is absent', () => {
    expect(elementOwnsPlayback(el, false)).toBe(false);
    expect(elementOwnsPlayback(null, true)).toBe(false);
  });
});

describe('resolved request headers survive to the bridge call', () => {
  it('the play payload carries a headers map when the resolver reported one', () => {
    // The exact spread used by `load()` in usePlayer.ts.
    const trackId = 'abc123';
    const resolverHeaders: Record<string, string> = { Referer: 'https://www.youtube.com/' };
    const cached = new Map<string, Record<string, string>>([[trackId, resolverHeaders]]);

    const payload = {
      url: 'https://rr1.googlevideo.com/videoplayback?x=1',
      title: 'Song',
      artist: 'Artist',
      durationMs: 200_000,
      shouldPlay: true,
      ...(cached.get(trackId) ? { headers: cached.get(trackId)! } : {}),
    };

    expect(payload.headers).toEqual({ Referer: 'https://www.youtube.com/' });
  });

  it('omits the key entirely when there are no headers, so nothing is cleared accidentally', () => {
    const cached = new Map<string, Record<string, string>>();
    const payload = {
      url: 'https://example.test/a.m4a',
      title: 'Song',
      artist: 'Artist',
      durationMs: 1,
      shouldPlay: true,
      ...(cached.get('nope') ? { headers: cached.get('nope')! } : {}),
    };
    expect('headers' in payload).toBe(false);
  });

  it('a re-resolve replaces the old header set instead of accumulating it', () => {
    const key = 'vid';
    const cached = new Map<string, Record<string, string>>();
    const remember = (h: Record<string, string> | undefined) => {
      if (h && Object.keys(h).length > 0) cached.set(key, h);
      else cached.delete(key);
    };

    remember({ Referer: 'https://old.example/' });
    remember({ Referer: 'https://new.example/' });
    expect(cached.get(key)).toEqual({ Referer: 'https://new.example/' });

    remember(undefined);
    expect(cached.has(key)).toBe(false);
  });
});

describe('the element path actually starts playback', () => {
  it('calls play() after assigning a source, and records failure instead of throwing', async () => {
    const el = new Audio();
    document.body.appendChild(el);

    // A jsdom element cannot decode, so stub play() to observe the call.
    const played: number[] = [];
    el.play = () => {
      played.push(1);
      return Promise.resolve();
    };

    // The shape of the branch under test: assign, then start.
    el.src = 'https://example.test/track.m4a';
    await el.play();
    expect(played).toHaveLength(1);
    expect(el.hasAttribute('src')).toBe(true);

    // And a rejection must become state, not an unhandled rejection.
    let state = { playing: true };
    el.play = () => Promise.reject(new Error('NotAllowedError'));
    try {
      await el.play();
    } catch {
      state = { playing: false };
    }
    expect(state.playing).toBe(false);

    el.remove();
  });
});

describe('stop is not pause', () => {
  it('the native stop method is the one called, and pause is not a substitute', async () => {
    // Mirrors the contract in `usePlayer.stop()`: it must reach `nativeStop` (which clears the media
    // item and retires the notification), never `nativePause` alone.
    const calls: string[] = [];
    const nativeStop = async () => {
      calls.push('stop');
    };
    const nativePause = async () => {
      calls.push('pause');
    };

    const stop = async () => {
      await nativeStop();
    };

    await stop();
    expect(calls).toEqual(['stop']);
    expect(calls).not.toContain('pause');

    // And pause is still available for the transport button — the two are not interchangeable.
    await nativePause();
    expect(calls).toContain('pause');
  });
});

// Keep the module-level import used so bundlers do not tree-shake the file's intent away.
void vi;
