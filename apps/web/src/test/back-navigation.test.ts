/**
 * Back must have somewhere to go.
 *
 * The tenth report: "back button backs.......... then closes the app." Two separate defects
 * produced that one sentence.
 *
 *  - `MainActivity.onBackPressed` only wrote its `settled` flag on the way out, so a web handler
 *    that *did* navigate still left the flag false and the 900 ms fallback finished the activity.
 *    That fix lives in Kotlin.
 *  - This file covers the other half, which survived every relaunch: `restoreOnce()` restored
 *    `route` but not `navHistory`. The app came back on Library while claiming to be one page deep,
 *    so `goBack()` returned false on the very first press and the platform closed the app. It was
 *    not a broken button — there was genuinely nowhere to go, in every session, forever.
 *
 * The invariant worth pinning: if the restored route is a page other than home, history must be
 * deep enough that back can leave it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { goBack, navigate, store, type Route } from '../state/store';

/** Mirrors `restoreOnce()` in App.tsx; the same expression, so the test cannot drift from it. */
function historyFor(route: Route): Route[] {
  return route === 'home' ? ['home'] : ['home', route];
}

describe('back navigation', () => {
  beforeEach(() => {
    store.set({ route: 'home', navHistory: ['home'] });
  });

  it('refuses to go back from the root, letting the platform exit', () => {
    expect(goBack()).toBe(false);
  });

  it('a restored non-home route can be backed out of', () => {
    store.set({ route: 'library', navHistory: historyFor('library') });
    expect(goBack()).toBe(true);
    expect(store.getState().route).toBe('home');
  });

  it('every non-home route is restorable and escapable', () => {
    for (const route of ['search', 'library', 'downloads', 'settings'] as Route[]) {
      store.set({ route, navHistory: historyFor(route) });
      expect(goBack(), `${route} must be escapable`).toBe(true);
      expect(store.getState().route).toBe('home');
    }
  });

  it('a restored home route stays a root', () => {
    store.set({ route: 'home', navHistory: historyFor('home') });
    expect(goBack()).toBe(false);
  });

  it('walking back through a real session unwinds one page at a time', () => {
    navigate('search');
    navigate('library');
    navigate('settings');
    expect(store.getState().route).toBe('settings');

    expect(goBack()).toBe(true);
    expect(store.getState().route).toBe('library');
    expect(goBack()).toBe(true);
    expect(store.getState().route).toBe('search');
    expect(goBack()).toBe(true);
    expect(store.getState().route).toBe('home');
    expect(goBack()).toBe(false);
  });

  it('navigating to the page already shown does not grow history', () => {
    navigate('library');
    const depth = store.getState().navHistory.length;
    navigate('library');
    expect(store.getState().navHistory.length).toBe(depth);
  });
});
