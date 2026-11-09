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
