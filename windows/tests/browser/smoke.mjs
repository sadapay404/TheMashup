import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
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

  if (process.env.PREVIEW_SNAPSHOT_BRIDGE === '1') {
    // Tiny diagnostic screenshot for environments where CI artifacts cannot be downloaded.
    const source = PNG.sync.read(home);
    const width = Math.floor(source.width / 2);
    const height = Math.floor(source.height / 2);
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const from = ((y * 2) * source.width + x * 2) * 4;
      const to = (y * width + x) * 4;
      source.data.copy(data, to, from, from + 4);
    }
    const preview = jpeg.encode({ data, width, height }, 35).data.toString('base64');
    const chunkSize = 3500;
    const chunks = Math.ceil(preview.length / chunkSize);
    if (chunks <= 9) {
      for (let index = 0; index < chunks; index++)
        console.log(`::notice file=windows/tests/browser/smoke.mjs,line=1::SNAPSHOT_${index + 1}_OF_${chunks}:${preview.slice(index * chunkSize, (index + 1) * chunkSize)}`);
    } else console.log(`Diagnostic screenshot too large for annotations (${chunks} chunks).`);
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
  const summary = String(error?.message || error).replaceAll('%', '%25').replaceAll('\n', '%0A').slice(0, 3000);
  console.log(`::error title=Preview smoke test::${summary}`);
  console.error('ARIA labels:', await page.locator('[aria-label]').evaluateAll(nodes => nodes.slice(0, 30).map(n => n.getAttribute('aria-label'))).catch(() => []));
  throw error;
} finally {
  await browser.close();
}
