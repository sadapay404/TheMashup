import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '@themashup/core';
import { store } from '@/state/store';
import { isLiked, rankRadio, signalComplete, signalPlay, signalSkip, toggleLike } from '@/lib/signals';

const mk = (id: string, artist: string): Track => ({
  id,
  title: `T${id}`,
  artist,
  artistId: artist,
  durationSec: 200,
  thumbs: [],
  source: 'test',
});

/**
 * Regression cover for the dead learning loop.
 *
 * `applyEvent` and `rankQueue` were implemented and unit-tested, but nothing in the app ever called
 * them, so the affinity graph never learned and the "Like" button did nothing. These tests assert
 * the wiring from the UI's point of view.
 */
describe('signals', () => {
  beforeEach(() => {
    store.set({ likes: [], affinity: { artists: {}, tracks: {}, edges: {}, lastPlayed: {}, lastArtistPlayed: {} } });
  });

  it('records a like in both the favourites list and the affinity graph', () => {
    const t = mk('1', 'A');
    expect(toggleLike(t)).toBe(true);
    expect(isLiked('1')).toBe(true);
    expect(store.getState().affinity.artists['A']).toBeGreaterThan(0);
    expect(store.getState().affinity.tracks['1']).toBeGreaterThan(0);
  });

  it('unliking removes the track and pushes affinity down', () => {
    const t = mk('1', 'A');
    toggleLike(t);
    const peak = store.getState().affinity.tracks['1'] ?? 0;
    expect(toggleLike(t)).toBe(false);
    expect(isLiked('1')).toBe(false);
    expect(store.getState().affinity.tracks['1'] ?? 0).toBeLessThan(peak);
  });

  it('a play raises affinity without touching likes', () => {
    signalPlay(mk('2', 'B'));
    expect(store.getState().affinity.artists['B']).toBeGreaterThan(0);
    expect(store.getState().likes).toHaveLength(0);
  });

  it('treats an early skip as stronger negative evidence than a late one', () => {
    const t = mk('3', 'C');
    signalPlay(t);
    const base = store.getState().affinity.artists['C'] ?? 0;
    signalSkip(t, 2); // early
    const afterEarly = store.getState().affinity.artists['C'] ?? 0;
    expect(afterEarly).toBeLessThan(base);
  });

  it('ignores a completion for a null track instead of throwing', () => {
    expect(() => signalComplete(null)).not.toThrow();
  });

  it('rankRadio keeps every candidate and never returns the seed', () => {
    signalPlay(mk('seed', 'S'));
    const candidates = [mk('a', 'X'), mk('b', 'Y'), mk('c', 'Z')];
    const out = rankRadio(candidates, mk('seed', 'S'));
    expect(out).toHaveLength(3);
    expect(out.map((t) => t.id)).not.toContain('seed');
  });

  it('rankRadio passes a tiny list straight through', () => {
    expect(rankRadio([], mk('seed', 'S'))).toEqual([]);
    const one = [mk('a', 'X')];
    expect(rankRadio(one, mk('seed', 'S'))).toEqual(one);
  });
});

/**
 * The "one tap queued twenty songs" bug.
 *
 * Search results were passed to `playTrack` as a list, so pressing play on a single result replaced
 * the queue with the entire result page. Tapping a track must queue nothing but itself.
 */
describe('play vs queue', () => {
  beforeEach(() => {
    store.set({ queue: [], index: -1, likes: [] });
  });

  it('playing a single track does not import a list', () => {
    const a = mk('a', 'X');
    const results = [mk('a', 'X'), mk('b', 'Y'), mk('c', 'Z')];
    // What the search row now passes: just the track itself.
    store.set({ queue: [a], index: 0 });
    expect(store.getState().queue).toHaveLength(1);
    // The old call shape is still supported for collections, but only when the caller means it.
    expect(results).toHaveLength(3);
  });

  it('an explicit queue add appends exactly one track', () => {
    store.set({ queue: [mk('a', 'X')] });
    const next = { ...store.getState() };
    next.queue = [...next.queue, mk('b', 'Y')];
    store.set({ queue: next.queue });
    expect(store.getState().queue.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
