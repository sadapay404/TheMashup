import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const expectedRendererFallbacks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text();
  // A headless browser may reject WebGL; Avalonia then tries software rendering.
  // The test still verifies that a real, interactive UI renders afterward.
  if (/^Failed to create render target for mode [23] : HTMLCanvasElement\.getContext returned null\.$/.test(text))
    expectedRendererFallbacks.push(text);
  else errors.push(text);
});
await mkdir('tests/browser/screenshots', { recursive: true });

async function load() {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#out canvas').first().waitFor({ state: 'visible', timeout: 120000 });
  // The canvas is created before Avalonia finishes its first frame.
  await page.waitForTimeout(2500);
  await page.locator('#loading-message').waitFor({ state: 'hidden', timeout: 10000 });
}

async function clickButton(name, fallbackX, fallbackY) {
  const roleButton = page.getByRole('button', { name, exact: true });
  if (await roleButton.count() && await roleButton.first().isVisible()) {
    await roleButton.first().click({ timeout: 10000 });
  } else {
    // Avalonia renders to a canvas; not all versions expose a complete ARIA tree.
    await page.mouse.click(fallbackX, fallbackY);
  }
}

function brightness(pngBuffer, x, y) {
  const png = PNG.sync.read(pngBuffer);
  const offset = (png.width * y + x) * 4;
  return (png.data[offset] + png.data[offset + 1] + png.data[offset + 2]) / 3;
}

try {
  await load();
  const home = await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/home.png' });
  assert.ok(brightness(home, 250, 80) < 80, 'Default theme should render a dark app surface');



  await clickButton('Appearance', 60, 715);
  await page.waitForTimeout(500);
  await clickButton('Paper and Ink theme', 525, 360);
  await page.waitForFunction(() => localStorage.getItem('themashup.windows.theme') === 'paper-ink', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const paper = await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/paper-theme.png' });
  assert.ok(brightness(paper, 250, 80) > 160, 'Paper theme should update the actual rendered UI');

  // Exercise every real theme card, including the wrapped second row.
  const themeCases = [
    { name: 'Neon Cyber theme', id: 'neon', x: 713, y: 360, rgb: [4, 6, 11] },
    { name: 'Aurora theme', id: 'aurora', x: 899, y: 360, rgb: [10, 16, 34] },
    { name: 'Vinyl theme', id: 'vinyl', x: 340, y: 540, rgb: [22, 17, 13] },
    { name: 'Frosted Glass theme', id: 'frosted', x: 340, y: 360, rgb: [10, 10, 15] },
    { name: 'Paper and Ink theme', id: 'paper-ink', x: 525, y: 360, rgb: [244, 239, 228] },
  ];
  for (const theme of themeCases) {
    await clickButton(theme.name, theme.x, theme.y);
    await page.waitForFunction(id => localStorage.getItem('themashup.windows.theme') === id, theme.id, { timeout: 10000 });
    await page.waitForTimeout(300);
    const sample = PNG.sync.read(await page.screenshot({ type: 'png', clip: { x: 250, y: 80, width: 1, height: 1 } })).data;
    assert.ok(theme.rgb.every((channel, index) => Math.abs(sample[index] - channel) <= 6),
      `${theme.id} should update the rendered background, got ${Array.from(sample.slice(0, 3))}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#out canvas').first().waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => localStorage.getItem('themashup.windows.theme')), 'paper-ink');
  const restored = await page.screenshot({ type: 'png' });
  assert.ok(brightness(restored, 250, 80) > 160, 'The chosen theme should be restored after reload');

  await page.setViewportSize({ width: 760, height: 600 });
  await page.waitForTimeout(800);
  const canvas = await page.locator('#out canvas').first().boundingBox();
  assert.ok(canvas && canvas.width >= 740 && canvas.height >= 580, 'Canvas should resize to the available viewport');
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/compact.png' });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
  if (expectedRendererFallbacks.length) console.log(`Software renderer fallback used (${expectedRendererFallbacks.length} WebGL attempts unavailable).`);
  console.log('PASS: Avalonia browser starts; all five themes render; selection survives reload; viewport resizes.');
  console.log('::notice title=Windows browser checks::All five themes, browser reload persistence and viewport resize passed.');
} catch (error) {
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/failure.png' }).catch(() => {});
  console.error('Browser runtime errors:', errors.join(' | ') || '(none)');
  const summary = String(error?.message || error).replaceAll('%', '%25').replaceAll('\n', '%0A').slice(0, 3000);
  console.log(`::error title=Preview smoke test::${summary}`);
  console.error('ARIA labels:', await page.locator('[aria-label]').evaluateAll(nodes => nodes.slice(0, 30).map(n => n.getAttribute('aria-label'))).catch(() => []));
  throw error;
} finally {
  await browser.close();
}
