import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Responsiveness.
 *
 * The app is a list renderer over a local store; it has no business feeling slow. Three costs were
 * found and removed, and each is easy to reintroduce because all three look completely reasonable:
 *
 *  1. `App` subscribed to `positionSec`, so every second of playback re-rendered the whole shell —
 *     route tree, AnimatePresence, dock, and every screen's props — on the UI thread.
 *  2. Route changes used `AnimatePresence mode="wait"`, which runs exit then enter *in series*, so
 *     every tab press paid for both animations before showing anything.
 *  3. A `backdrop-filter` blurred the page behind a fixed status-bar strip, forcing a re-sample of
 *     everything scrolling underneath on every frame.
 *
 * These are structural assertions on purpose: the numbers can be tuned, but if any of these three
 * structures comes back, the jank comes back with it.
 */
describe('responsiveness', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  const card = readFileSync(resolve(__dirname, '../components/player/SongCard.tsx'), 'utf8');
  const feed = readFileSync(resolve(__dirname, '../hooks/useHomeFeed.ts'), 'utf8');

  it('the shell does not subscribe to the per-second playhead', () => {
    expect(app).not.toContain('useApp((s) => s.positionSec)');
    expect(app).not.toContain('useApp((s) => s.durationSec)');
  });

  it('the element that draws progress subscribes to it instead', () => {
    expect(card).toContain('useApp((s) => s.positionSec)');
    expect(card).toContain('ProgressHairline');
  });

  it('route transitions overlap instead of queueing', () => {
    // "wait" holds the outgoing screen until its exit finishes; the incoming one cannot even mount.
    expect(app).toContain('mode="popLayout"');
    expect(app).not.toContain('mode="wait"');
  });

  it('route transitions are a short tween, not a spring that settles by decay', () => {
    const m = /const routeTransition = \{ duration: ([\d.]+)/.exec(app);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(0.25);
  });

  it('the feed refetch key is memoised, not rebuilt on every render', () => {
    /*
     * The Home feed is a network call. Without a stable key it re-fires on every render of Home,
     * which is every store change — a browse request per toast. The key is memoised on the inputs it
     * actually reads, and the effect depends on that key rather than on the objects behind it.
     */
    expect(feed).toContain('useMemo');
    expect(feed).toMatch(/\[history\.length, affinity\]/);
  });

  it('seeds are derived from history without re-sorting it per render', () => {
    /*
     * The rule is about the component body: `pickSeeds` sorts the whole history, and running that on
     * every render was the original cost. Module-level helpers (pinned row ordering) legitimately
     * sort, so the assertion is scoped to the hook function itself.
     */
    const body = feed.slice(feed.indexOf('export function useHomeFeed'));
    const hookBody = body.slice(0, body.indexOf('return state;'));
    expect(hookBody).not.toContain('sort(');
  });
});
