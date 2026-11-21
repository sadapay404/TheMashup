import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * "Downloads are super slow", and the three home rows the user asked for by name.
 *
 * Both are asserted at source level. The download defect is a *concurrency* property — it cannot be
 * observed in a unit test without a real CDN, and a timing assertion on localhost would pass with a
 * single connection. What can be checked is that the phone path actually issues parallel ranged
 * requests, and that every way of failing to do so still works.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const service = read('../../../apps/android/android/app/src/main/java/app/themashup/music/download/DownloadService.kt');
const hook = read('hooks/useHomeFeed.ts');
const home = read('components/home/HomeScreen.tsx');

describe('native downloads use the whole connection', () => {
  it('splits the file across concurrent ranged requests', () => {
    /*
     * It was a single sequential stream. One TCP connection to a YouTube CDN edge is throttled
     * per-connection well before it fills the phone's link, so a 4 MB track crawled — the reported
     * "super slow". The browser path already did this; the path that actually runs on the phone
     * never did.
     */
    expect(service).toContain('fetchParallel');
    expect(service).toMatch(/PARALLEL_CHUNKS = 4/);
    expect(service).toMatch(/header\("Range", "bytes=\$from-\$to"\)/);
  });

  it('only splits when the server actually serves ranges', () => {
    // A 200 to a ranged request means the whole body is coming; splitting there would corrupt the file.
    expect(service).toContain('contentRange');
    expect(service).toMatch(/response\.code == 206 && contentRange != null/);
  });

  it('keeps a working single-connection path for servers that refuse ranges', () => {
    // The optimisation must never be able to make a download fail that used to work.
    expect(service).toContain('copySequential');
    expect(service).toMatch(/else \{\s*downloaded = copySequential/);
  });

  it('does not bother splitting small files', () => {
    expect(service).toMatch(/total > MIN_SPLIT_BYTES/);
    expect(service).toMatch(/MIN_SPLIT_BYTES = 1L \* 1024L \* 1024L/);
  });

  it('refuses a worker that did not get a partial response', () => {
    // Writing a 200 body at a chunk offset would put the wrong bytes in the middle of the file.
    expect(service).toMatch(/response\.code != 206/);
  });

  it('never lets a worker exception kill the process', () => {
    /*
     * A bare Thread with an uncaught throw reaches the default handler, and this app installs one
     * that writes a boot-log crash — one 403 on one range would look like the app crashing.
     */
    expect(service).toContain('AtomicReference<Throwable?>');
    expect(service).toMatch(/failure\.compareAndSet\(null, t\)/);
    expect(service).toMatch(/failure\.get\(\)\?\.let \{ throw it \}/);
  });

  it('reports progress from all workers, not just one', () => {
    // A single worker's offset would make the bar jump backwards when its chunk finished.
    expect(service).toContain('AtomicLong');
    expect(service).toMatch(/done\.addAndGet/);
  });
});

describe('the three requested rows come first, in order', () => {
  it('pins forgotten favourites, then desi hip-hop, then featured playlists', () => {
    const pin = hook.slice(hook.indexOf('const PINNED'));
    const forgotten = pin.indexOf('forgotten');
    const desi = pin.indexOf('desi');
    const featured = pin.indexOf('featured');
    expect(forgotten).toBeGreaterThan(-1);
    expect(forgotten).toBeLessThan(desi);
    expect(desi).toBeLessThan(featured);
  });

  it('matches YouTube’s own spelling loosely rather than exactly', () => {
    // "favorites" and "favourites" both occur, and a strict match would fail silently on one of them.
    expect(hook).toMatch(/forgotten\\s\*favou\?rites\?/i);
    expect(hook).toMatch(/desi\\s\*hip\[-\\s\]\?hop/i);
  });

  it('does not invent a pinned row YouTube did not send', () => {
    // pinOrder only reorders; it must never add a shelf. (featuredRows does add rows, which is a
    // different job — those come from the user's own library, not from a guess.)
    // Extract just the pinOrder body, up to the next top-level function.
    const fn = hook.slice(hook.indexOf('function pinOrder'));
    const body = fn.slice(0, fn.indexOf('function pinnedRows'));
    expect(body).not.toContain('push');
    expect(body).toContain('sort');
  });

  it('keeps a playlist-only shelf alive through normalisation', () => {
    // Requiring tracks here is what deleted these rows in the first place.
    expect(hook).toMatch(/s\.tracks\.length > 0 \|\| \(s\.playlists\?\.length \?\? 0\) > 0/);
  });
});

describe('home renders playlist rows', () => {
  it('draws playlist cards, not just songs', () => {
    expect(home).toContain('shelf.playlists');
    expect(home).toContain('openPlaylist');
  });

  it('resolves a playlist on tap rather than prefetching a dozen of them', () => {
    // The page can show a dozen playlist rows; resolving them all on load would be a dozen requests
    // for cards the user may never touch.
    expect(home).toMatch(/service\.playlistTracks\(pl\.id\)/);
    expect(home).toContain('openingId');
  });
});
