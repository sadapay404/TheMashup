import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * "The app lags", "search is slow", "the home page is one row".
 *
 * These are source-level assertions because the defects were structural — a component subscribing
 * that should not, an animation applied 144 times, a network round trip issued for an answer already
 * in memory. A rendered assertion would pass on a fast machine and tell us nothing about a phone.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('home renders a full page', () => {
  const home = read('components/home/HomeScreen.tsx');
  const hook = read('hooks/useHomeFeed.ts');

  it('allows a real home-page worth of rows', () => {
    // Six was a magazine layout, not a front page.
    expect(hook).toMatch(/MAX_SHELVES = 12/);
  });

  it('does not attach an animation to every card', () => {
    /*
     * Twelve rows of twelve is 144 nodes. Giving each a spring plus a whileTap gesture means 144
     * concurrent animations on mount — the most expensive thing on the page by far.
     */
    // Start after the explanatory comment, so the prose describing the old approach is not matched.
    const cards = home.slice(home.indexOf('shelf.tracks.map'));
    const start = cards.indexOf('<button');
    const card = cards.slice(start, cards.indexOf('</button>') + 9);
    expect(start).toBeGreaterThan(-1);
    // A JSX element named motion.button would appear as `<motion.button` at the start of this slice.
    expect(card.startsWith('<motion.button')).toBe(false);
    expect(card).not.toContain('whileTap');
    // Press feedback still exists, via CSS, which costs nothing while idle.
    expect(card).toContain('active:scale');
  });

  it('still only fetches local radio when the page is thin', () => {
    /*
     * The fallback costs three radio round trips. The library fetch is in a Promise.all with the home
     * feed — both are single requests and the Featured group must not wait behind the feed — but the
     * *radio* cost is still deferred until the page is known to be short.
     */
    expect(hook).toMatch(/if \(yt\.length >= 3\) return;/);
    expect(hook).toContain('localShelf(history, affinity)');
  });

  it('keeps YouTube order and appends the local row underneath', () => {
    expect(hook).toMatch(/\[\.\.\.yt, \.\.\.local\]/);
  });
});

describe('the store subscription is stable', () => {
  const store = read('state/store.ts');

  it('does not re-create the snapshot getter on every render', () => {
    /*
     * The selector is nearly always an inline arrow, so its identity changed on every render. Passing
     * it as a dependency meant `getSnapshot` changed too, and useSyncExternalStore tore down and
     * re-added a subscription each time — several times a second while playback ticked.
     */
    const fn = store.slice(store.indexOf('export function useApp'));
    expect(fn).toContain('selectorRef');
    expect(fn).toMatch(/\[selectorRef\.current\]|\[\]/);
    expect(fn).not.toMatch(/\[selector\]/);
  });
});

describe('search does not repeat work', () => {
  const service = read('lib/service.ts');

  it('caches successful results for the session', () => {
    expect(service).toContain('searchCache');
    expect(service).toContain('SEARCH_CACHE_MAX');
  });

  it('returns a cached result before touching the ladder', () => {
    const fn = service.slice(service.indexOf('async search('));
    const cacheRead = fn.indexOf('const cached = this.searchCache.get');
    const race = fn.indexOf('const controllers');
    expect(cacheRead).toBeGreaterThan(-1);
    // The lookup must come before any request setup, not after it.
    expect(cacheRead).toBeLessThan(race);
  });

  it('never caches a failure', () => {
    // Caching an outage would pin it for the whole session, and a retry is exactly what the user does.
    const fn = service.slice(service.indexOf('async search('));
    const set = fn.indexOf('this.searchCache.set');
    const okGuard = fn.slice(0, set).lastIndexOf('outcome.ok');
    expect(okGuard).toBeGreaterThan(-1);
  });

  it('clears the cache when the account changes', () => {
    expect(service).toMatch(/setCookie[\s\S]{0,200}searchCache\.clear\(\)/);
  });
});
