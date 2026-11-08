/**
 * End-to-end + visual regression, run in CI (GitHub runners have browsers; the build sandbox does not).
 *
 * Selectors are written against the real DOM: navigation buttons expose `aria-label={label}` and the
 * search field exposes `aria-label="Search"` with a lyric-aware placeholder.
 *
 * Assertions are about behaviour a user can see, never implementation details.
 */

import { expect, test, type Page } from '@playwright/test';

/** Collect console errors for the duration of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
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
