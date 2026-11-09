import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicApiProvider, type PublicApiInstance } from '@themashup/core';

/**
 * Regression cover for the permanently-blacklisting instance ladder.
 *
 * `PublicApiProvider` used to record a failure in a `Set` that was never cleared, so a single
 * timeout — routine on a mobile network handing over between cells — exiled that instance for the
 * whole session. The ladder then shrank with every attempt until browser search returned nothing,
 * which is exactly the "search does not work" symptom users hit.
 */
const instances: PublicApiInstance[] = [
  { id: 'a', kind: 'piped', base: 'https://a.test', musicSearch: true },
  { id: 'b', kind: 'piped', base: 'https://b.test', musicSearch: true },
];

describe('PublicApiProvider retry window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries a failed instance once the window expires instead of exiling it', async () => {
    const fresh = new PublicApiProvider(instances);
    // First pass: every host is down.
    const down = vi.fn().mockRejectedValue(new Error('blocked'));
    vi.stubGlobal('fetch', down);
    expect((await fresh.search('x')).sections).toHaveLength(0);

    // Same provider, same query, window not elapsed -> still remembers the failures.
    expect((await fresh.search('x')).sections).toHaveLength(0);
    const callsWhileCold = down.mock.calls.length;

    // Past the retry window the ladder must be attempted again.
    vi.advanceTimersByTime(61_000);
    await fresh.search('x');
    expect(down.mock.calls.length).toBeGreaterThan(callsWhileCold);
    vi.unstubAllGlobals();
  });

  it('returns the first instance that answers', async () => {
    const provider = new PublicApiProvider(instances);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('a.test')) throw new Error('down');
      return {
        ok: true,
        json: async () => ({
          items: [{ url: '/watch?v=dQw4w9WgXcQ', title: 'Song', uploaderName: 'Artist', duration: 200, thumbnail: '' }],
        }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await provider.search('song');
    expect(res.sections.length).toBeGreaterThan(0);
    expect(provider.lastUsed).toBe('b');
    vi.unstubAllGlobals();
  });
});

/**
 * The reported "No playable source" bug.
 *
 * Piped instances usually null out `url` (the direct googlevideo link is IP-bound and would 403 for
 * the user) and expose `proxyUrl` instead — which is often a *relative* path served from the instance
 * origin. The parser read only `url`, so `audio[]` filled up while `urls{}` stayed empty and every
 * track looked unplayable.
 */
describe('stream URLs from proxying instances', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (streams: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => streams }) as unknown as Response),
    );
  };

  it('uses proxyUrl when url is null, made absolute against the instance', async () => {
    const provider = new PublicApiProvider([instances[0]!]);
    reply({
      audioStreams: [{ itag: 251, mimeType: 'audio/webm', bitrate: 128000, url: null, proxyUrl: '/videoplayback?id=abc' }],
      videoStreams: [],
    });

    const info = await provider.stream('dQw4w9WgXcQ');
    expect(info).not.toBeNull();
    expect(info!.urls[251]).toBe('https://a.test/videoplayback?id=abc');
    expect(info!.audio[0]!.deliver).toBe('url');
  });

  it('passes absolute proxy urls through unchanged', async () => {
    const provider = new PublicApiProvider([instances[0]!]);
    reply({
      audioStreams: [{ itag: 251, mimeType: 'audio/webm', bitrate: 128000, proxyUrl: 'https://cdn.test/x' }],
      videoStreams: [],
    });
    expect((await provider.stream('dQw4w9WgXcQ'))!.urls[251]).toBe('https://cdn.test/x');
  });

  it('skips an instance that answers with formats but no playable URL', async () => {
    // Instance A is a proxy whose proxy is itself down: it responds, but nothing is playable.
    // The ladder must continue to B instead of reporting failure.
    const provider = new PublicApiProvider(instances);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('a.test')) {
        return {
          ok: true,
          json: async () => ({ audioStreams: [{ itag: 251, bitrate: 128000, url: null, proxyUrl: null }] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ audioStreams: [{ itag: 140, bitrate: 128000, proxyUrl: '/vp?x=1' }] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const info = await provider.stream('dQw4w9WgXcQ');
    expect(info?.profile).toBe('piped:b');
    expect(info?.urls[140]).toBe('https://b.test/vp?x=1');
  });
});
