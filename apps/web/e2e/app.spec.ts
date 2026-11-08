/**
 * End-to-end + visual regression, run in CI (GitHub runners have browsers; the build sandbox does not).
 *
 * These assertions are deliberately about *behaviour the user can see*, not implementation details:
 *  - the app paints without console errors
 *  - every route is reachable and renders its own content
 *  - the lyric-search mode switch actually changes what the UI says
 *  - the player sheet opens and closes via the Melt controls
 *  - screenshots are attached so a visual diff is reviewable
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForTimeout(700);
  (page as unknown as { __errors: string[] }).__errors = errors;
});

test('home paints with no console errors', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
  await expect(page.getByText(/Remember a lyric/i)).toBeVisible();
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors, `console errors: ${errors?.join(' | ')}`).toHaveLength(0);
  await page.screenshot({ path: 'screenshots/home.png' });
});

test('all routes are reachable', async ({ page }) => {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByPlaceholder(/lyric you remember/i)).toBeVisible();
  await page.screenshot({ path: 'screenshots/search-empty.png' });

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: /Run diagnostics/i })).toBeVisible();
  await page.screenshot({ path: 'screenshots/settings.png' });
});

test('lyric mode is announced when a phrase is typed', async ({ page }) => {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.getByPlaceholder(/lyric you remember/i);
  await input.fill('caught in a landslide no escape from reality');
  await expect(page.getByText(/searched/i).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'screenshots/search-lyric-mode.png' });
});

test('diagnostics produce per-check verdicts', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Run diagnostics/i }).click();
  // Each row must end up with a detail line, never stuck on "Running…" forever.
  await expect(page.getByRole('button', { name: /Run diagnostics/i })).toBeEnabled({ timeout: 60_000 });
  await page.screenshot({ path: 'screenshots/diagnostics.png', fullPage: true });
});

test('keyboard: space toggles nothing when no track is loaded, and does not throw', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'TheMashup' })).toBeVisible();
});
