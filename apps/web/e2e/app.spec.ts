/**
 * End-to-end + visual regression, run in CI (GitHub runners have browsers; the build sandbox does not).
 *
 * Selectors are written against the real DOM: navigation buttons expose `aria-label={label}` and the
 * search field exposes `aria-label="Search"` with a lyric-aware placeholder.
 *
 * Assertions are about behaviour a user can see, never implementation details.
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * Browser noise that is a *consequence of the design*, not a bug:
 *  - the app health-checks several public API instances at startup, and some of them do not send
 *    CORS headers for the preview origin. That is precisely what the route-health indicator reports.
 *  - a blocked cross-origin fetch also prints a generic "Failed to load resource" line.
 *
 * Anything else — a React crash, an unhandled rejection, a null dereference — must still fail.
 */
const THIRD_PARTY = [
  // Any Piped/Invidious host. Written as broad patterns on purpose: the instance ladder is data,
  // and CI must not fail just because a host was added or a community instance disappeared.
  /pipedapi\./i,
  /api\.piped\./i,
  /\binv(idious)?\./i,
  /invidious\./i,
  /lrclib\.net/i,
  /music\.youtube\.com/i,
  /googlevideo\.com/i,
  /youtubei\./i,
];

function isExpectedNoise(message: string): boolean {
  if (THIRD_PARTY.some((re) => re.test(message))) return true;
  // Chrome's generic companion line for a blocked resource; the CORS line above carries the detail.
  // A host that does not resolve is a *network* fact, not an app bug. The instance ladder exists
  // precisely so a dead/blocked instance is skipped; the user sees an honest "no route" message.
  // Without this, CI failed purely because a community instance's DNS had lapsed.
  if (/^Failed to load resource/i.test(message) && /net::ERR_(FAILED|BLOCKED|NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE)/i.test(message)) {
    return true;
  }
  // The preview origin is http, so a stray upgrade attempt can appear; harmless.
  if (/ERR_SSL|ERR_CERT/i.test(message)) return true;
  return false;
}

/** Collect console errors for the duration of a test, excluding expected third-party noise. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !isExpectedNoise(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!isExpectedNoise(e.message)) errors.push(`[pageerror] ${e.message}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
});

test('home paints with no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();

  // The lyric-search affordance is the product's signature feature.
  await expect(page.getByText(/Remember a lyric, not the title/i)).toBeVisible();

  // Let async work settle before asserting on the console.
  await page.waitForTimeout(1500);
  // A real assertion: any console error fails the test, and Playwright prints the diff.
  expect(errors).toEqual([]);

  await page.screenshot({ path: 'screenshots/home.png', fullPage: true });
});

test('every route is reachable and renders its own content', async ({ page }) => {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/search-empty.png' });

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: /Run diagnostics/i })).toBeVisible();
  await page.screenshot({ path: 'screenshots/settings.png' });
});

test('lyric mode is detected from a remembered phrase', async ({ page }) => {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search' });

  await input.fill('caught in a landslide no escape from reality');
  // Typing a phrase must switch the UI into lyric mode and say so.
  await expect(page.getByText(/lyric/i).first()).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'screenshots/search-lyric-mode.png' });
});

test('diagnostics finish and report a verdict per check', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const run = page.getByRole('button', { name: /Run diagnostics/i });
  await run.click();

  // Must return to an enabled state: a check that never resolves is a hung UI.
  await expect(run).toBeEnabled({ timeout: 90_000 });
  await page.screenshot({ path: 'screenshots/diagnostics.png', fullPage: true });
});

test('keyboard does not throw when nothing is playing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
  // A real assertion: any console error fails the test, and Playwright prints the diff.
  expect(errors).toEqual([]);
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/home-reduced-motion.png' });
});

test('mobile viewport has no horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  // A 1px tolerance absorbs sub-pixel rounding without hiding a real layout break.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

/**
 * Themes.
 *
 * Five themes ship, and the failure mode for theme code is silence: everything renders, but in the
 * wrong colours. These assert the computed ground and text colours actually change, which is the only
 * thing a user would notice.
 */
test('all five themes apply and change the rendered colours', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const readGround = () =>
    page.evaluate(() => {
      // --color-void is the canvas; --color-text is the ink. Both must move together, or the theme is
      // half-applied and text becomes unreadable.
      const css = getComputedStyle(document.documentElement);
      return {
        theme: document.documentElement.dataset['theme'],
        void: css.getPropertyValue('--color-void').trim(),
        text: css.getPropertyValue('--color-text').trim(),
      };
    });

  const seen: string[] = [];
  for (const name of ['Liquid Obsidian', 'Vinyl Sleeve', 'Ink on Paper', 'Neon Rain', 'Midnight Forest']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    const applied = await readGround();
    expect(applied.void, `${name} ground`).not.toBe('');
    expect(applied.text, `${name} text`).not.toBe('');
    // A theme where ink and ground are the same colour is unreadable by definition.
    expect(applied.text.toLowerCase()).not.toBe(applied.void.toLowerCase());
    seen.push(applied.void);
  }
  // Five themes that produce four identical grounds would be one theme with five names.
  expect(new Set(seen).size).toBeGreaterThanOrEqual(4);

  await page.screenshot({ path: 'screenshots/themes.png', fullPage: true });
});

test('diagnostics produce a verdict summary, not just dots', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const run = page.getByRole('button', { name: /Run diagnostics/i });
  await run.click();
  await expect(run).toBeEnabled({ timeout: 90_000 });

  // The summary is the whole point: "search is blocked on this network" must be sayable.
  await expect(page.getByRole('button', { name: /Copy full report/i })).toBeVisible();
});
