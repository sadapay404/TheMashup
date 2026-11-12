import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sign-in must always be reachable.
 *
 * The reported failure was not "sign-in gave a bad result" — it was "the account picker does not work
 * and neither does the Google page, so there is no way to sign in". Both entry points are checked
 * here at the source level, because the defect was structural: one route was wired to an intent
 * contract that means "add an account", and the other treated "no picker" as "user cancelled" and
 * returned silently. Neither is a runtime-shape bug a mock would catch.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const settings = read('components/settings/SettingsScreen.tsx');
const native = read('lib/native.ts');

describe('account picker', () => {
  const kt = read('../../../apps/android/android/app/src/main/java/app/themashup/music/auth/AccountPlugin.kt');

  it('asks the system to pick a handler instead of asking it to add an account', () => {
    /*
     * `newChooseAccountIntent` with a non-null allowableAccountTypes opens **Add account**. That is
     * the bug behind "the picker never worked": the device asked the user to sign in again rather
     * than listing accounts it already had.
     */
    expect(kt).toContain('ACTION_PICK_ACTIVITY');
    expect(kt).toContain('EXTRA_INTENT');
  });

  it('follows the two-step picker contract', () => {
    // ACTION_PICK_ACTIVITY returns the *intent* to run, not the account. Treating that result as the
    // answer yields a null account every time.
    expect(kt).toContain('accountChosen');
    expect(kt).toMatch(/getParcelableExtra\(Intent\.EXTRA_INTENT\)/);
  });

  it('uses the Android 14 choose-not-add overload', () => {
    expect(kt).toContain('allowAccountAddition');
    // It must be false: true is the add-account flow again.
    expect(kt).toMatch(/false, \/\/ allowAccountAddition = false/);
  });

  it('reports an unavailable picker instead of pretending the user cancelled', () => {
    /*
     * The silent dead end. `{started:false}` with no reason became `null` in JS, which every caller
     * read as "cancelled" — so on devices without a picker the button did nothing at all and said
     * nothing.
     */
    expect(kt).toContain('"no-picker"');
    expect(native).toContain("kind: 'unavailable'");
    expect(native).toContain("kind: 'cancelled'");
  });

  it('falls back to the Google page when no picker exists', () => {
    /*
     * The whole fix for "no way to sign up": there is now no device state in which tapping sign-in
     * is a no-op. The two handled cases return; everything else — including `unavailable` — reaches
     * the Google page.
     */
    const fn = settings.slice(settings.indexOf('const doSignIn = async ()'));
    const body = fn.slice(0, fn.indexOf('const openWebSignIn'));
    expect(body).toContain('nativePickAccount');
    // Both non-fallback outcomes return, so the tail is reachable only for `unavailable`.
    expect(body).toMatch(/kind === 'picked'[\s\S]{0,120}return;/);
    expect(body).toMatch(/kind === 'cancelled'[\s\S]{0,160}return;/);
    expect(body).toContain('await openWebSignIn()');
  });

  it('still offers the Google page as an explicit second route', () => {
    expect(settings).toContain('openWebSignIn');
    expect(settings).toContain('nativeSignIn');
  });
});

describe('search responsiveness', () => {
  const transport = read('../../../packages/core/src/net/transport.ts');
  const piped = read('../../../packages/core/src/net/piped.ts');
  const service = read('lib/service.ts');
  const screen = read('components/search/SearchScreen.tsx');

  it('bounds a single route', () => {
    // Every route used to run to the 12 s socket timeout, or — native — have no bound at all.
    expect(transport).toContain('ROUTE_TIMEOUT_MS');
    expect(transport).toMatch(/withTimeout\(this\.native\(req, signal\), ROUTE_TIMEOUT_MS/);
  });

  it('bounds the whole ladder, not just each attempt', () => {
    // One budget for the traversal: N routes × their own timeout is still unbounded in aggregate.
    expect(transport).toContain('CHAIN_BUDGET_MS');
    expect(transport).toMatch(/limit\.expired/);
  });

  it('bounds the public-mirror ladder', () => {
    // Ten instances × 9 s sequentially is the "takes a long long time" report.
    expect(piped).toContain('LADDER_BUDGET_MS');
    expect(piped).toContain('RACE_WIDTH');
    expect(piped).toContain('Promise.any');
  });

  it('races the two search strategies instead of queueing them', () => {
    expect(service).toContain('Promise.any');
    // The losing strategy is aborted, so it stops costing a rate-limit token.
    expect(service).toMatch(/stopAll|abort\(\)/);
  });

  it('the search screen aborts a superseded query', () => {
    // Without this, five keystrokes' worth of searches keep running while the sixth waits.
    expect(screen).toContain('new AbortController()');
    expect(screen).toMatch(/service\.search\(debounced, filter, abort\.signal\)/);
    expect(screen).toMatch(/abort\.abort\(\)/);
  });

  it('an aborted request is never counted as a network fault', () => {
    // Otherwise superseding a keystroke would open breakers and mark every mirror dead.
    expect(transport).toMatch(/signal\?\.aborted\) throw new DOMException\('aborted', 'AbortError'\)/);
    expect(piped).toMatch(/AbortError|aborted/);
  });
});
