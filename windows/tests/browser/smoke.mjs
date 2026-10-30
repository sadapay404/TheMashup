import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await mkdir('tests/browser/screenshots', { recursive: true });

async function load() {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#out canvas').first().waitFor({ state: 'visible', timeout: 120000 });
  // The canvas is created before Avalonia finishes its first frame.
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('#loading-message').count(), 0, 'Loading splash must be removed');
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

  if (process.env.PREVIEW_SNAPSHOT_BRIDGE === '1') {
    const preview = (await page.screenshot({ type: 'jpeg', quality: 40 })).toString('base64');
    const chunkSize = 28000;
    const chunks = Math.ceil(preview.length / chunkSize);
    if (chunks <= 8) {
      for (let index = 0; index < chunks; index++)
        console.log(`::notice file=windows/tests/browser/smoke.mjs,line=1::SNAPSHOT_${index + 1}_OF_${chunks}:${preview.slice(index * chunkSize, (index + 1) * chunkSize)}`);
    }
  }

  await clickButton('Appearance', 60, 715);
  await page.waitForTimeout(500);
  await clickButton('Paper and Ink theme', 525, 360);
  await page.waitForFunction(() => localStorage.getItem('themashup.windows.theme') === 'paper-ink', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const paper = await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/paper-theme.png' });
  assert.ok(brightness(paper, 250, 80) > 160, 'Paper theme should update the actual rendered UI');

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
  console.log('PASS: Avalonia browser starts, theme changes and survives reload, and viewport resizes.');
} catch (error) {
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/failure.png' }).catch(() => {});
  console.error('Browser runtime errors:', errors.join(' | ') || '(none)');
  console.error('ARIA labels:', await page.locator('[aria-label]').evaluateAll(nodes => nodes.slice(0, 30).map(n => n.getAttribute('aria-label'))).catch(() => []));
  throw error;
} finally {
  await browser.close();
}
