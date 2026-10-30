import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const expectedRendererFallbacks = [];
const failedFixtureStreams = [];
const playbackResponses = [];
let searchRowY = null;
page.on('response', response => {
  const pathname = new URL(response.url()).pathname;
  if (pathname.startsWith('/api/playback/')) {
    playbackResponses.push(`${pathname.startsWith('/api/playback/stream/') ? '/api/playback/stream/[token]' : pathname} ${response.status()}`);
    if (pathname.startsWith('/api/playback/stream/') && response.status() === 410)
      failedFixtureStreams.push(pathname);
  }
});
let testStage = 'initial render and themes';
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text();
  // A headless browser may reject WebGL; Avalonia then tries software rendering.
  // The test still verifies that a real, interactive UI renders afterward.
  if (/^Failed to create render target for mode [23] : HTMLCanvasElement\.getContext returned null\.$/.test(text))
    expectedRendererFallbacks.push(text);
  else if (testStage.startsWith('fixture playback') &&
      /^Failed to load resource: the server responded with a status of 410/.test(text)) {
    // The integration fixture intentionally supplies one dead stream first.
  } else errors.push(text);
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



  await clickButton('Appearance', 60, 860);
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
    { name: 'Vinyl theme', id: 'vinyl', x: 1083, y: 360, rgb: [22, 17, 13] },
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

  testStage = 'create playlist';
  // Exercise the real library UI, including persistence through a page reload.
  await clickButton('Your library', 60, 288);
  await page.waitForTimeout(500);
  const nameInput = page.getByRole('textbox', { name: 'New playlist name', exact: true });
  if (await nameInput.count() && await nameInput.first().isVisible()) {
    await nameInput.first().fill('Focus time');
  } else {
    await page.mouse.click(450, 258);
    await page.keyboard.type('Focus time');
  }
  await clickButton('Create playlist', 1290, 258);
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('themashup.windows.library');
    return raw && JSON.parse(raw).playlists.some(item => item.name === 'Focus time');
  }, null, { timeout: 10000 });
  testStage = 'rename playlist';
  await page.waitForTimeout(400);
  await clickButton('Rename playlist action', 1230, 418);
  // Avalonia lays out the newly shown editor on a later animation frame.
  await page.waitForTimeout(350);
  const renameInput = page.getByRole('textbox', { name: 'Rename playlist', exact: true });
  if (await renameInput.count() && await renameInput.first().isVisible()) {
    await renameInput.first().fill('Deep focus');
  } else {
    await page.mouse.click(450, 418);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Deep focus');
  }
  await page.waitForTimeout(200);
  await clickButton('Save playlist name', 1210, 418);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('themashup.windows.library')).playlists[0]?.name === 'Deep focus', null, { timeout: 10000 });
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/library.png' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#out canvas').first().waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(2500);
  await clickButton('Your library', 60, 288);
  await page.waitForTimeout(500);
  const restoredLibrary = await page.evaluate(() => JSON.parse(localStorage.getItem('themashup.windows.library')));
  assert.equal(restoredLibrary.playlists[0].name, 'Deep focus', 'Playlist should survive browser reload');
  testStage = 'confirm restored playlist deletion';
  // The restored row must really be present and interactive, not just stored JSON.
  await clickButton('Delete playlist action', 1310, 418);
  await page.waitForTimeout(250);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('themashup.windows.library'))).playlists.length, 1,
    'Asking to delete must not delete until confirmed');
  await clickButton('Confirm playlist deletion', 1210, 418);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('themashup.windows.library')).playlists.length === 0, null, { timeout: 10000 });

  testStage = 'fixture catalog and lyric search';
  await clickButton('Search', 60, 191);
  await page.waitForTimeout(500);
  const searchInput = page.getByRole('textbox', { name: 'Search music', exact: true });
  if (await searchInput.count() && await searchInput.first().isVisible()) {
    await searchInput.first().fill('city hums in ultraviolet');
  } else {
    await page.mouse.click(450, 207);
    await page.keyboard.type('city hums in ultraviolet');
  }
  const catalogReply = page.waitForResponse(response =>
    response.url().includes('/api/search?') && response.url().includes('city%20hums'), { timeout: 30000 });
  const lyricReply = page.waitForResponse(response =>
    response.url().includes('/api/search/lyrics?') && response.url().includes('city%20hums'), { timeout: 30000 });
  await clickButton('Search music action', 1300, 207);
  const [catalog, lyric] = await Promise.all([catalogReply, lyricReply]);
  assert.equal(catalog.status(), 200, 'Catalog fixture endpoint should succeed through the preview origin');
  assert.equal(new URL(catalog.url()).origin, new URL(url).origin, 'Browser requests must use the preview origin');
  const lyricResult = await lyric.json();
  assert.equal(lyricResult.source, 'mock', 'Fixture responses must be explicitly labeled');
  assert.equal(lyricResult.hits[0].track.id, 'mock00000001', 'Lyric hit should be matched through the catalog');
  await page.waitForTimeout(600);
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/search.png' });

  testStage = 'fixture playback search';
  if (await searchInput.count() && await searchInput.first().isVisible()) {
    await searchInput.first().fill('midnight');
  } else {
    await page.mouse.click(450, 207);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('midnight');
  }
  const playbackSearchReply = page.waitForResponse(response =>
    response.url().includes('/api/search?') && response.url().includes('midnight'), { timeout: 30000 });
  await clickButton('Search music action', 1300, 207);
  assert.equal((await playbackSearchReply).status(), 200);
  await page.waitForTimeout(1200);

  testStage = 'fixture playback audio failover';
  const libraryKey = 'themashup.windows.library';
  searchRowY = null;
  const playResult = page.getByRole('button', { name: 'Play search result', exact: true });
  if (await playResult.count() && await playResult.first().isVisible()) {
    const box = await playResult.first().boundingBox();
    searchRowY = box ? box.y + box.height / 2 : null;
    await playResult.first().click();
  } else {
    // Avalonia's canvas does not expose every accessibility node on every
    // browser version. Click only in the title column until play-now persists.
    for (const y of [420, 430, 440, 470, 500, 530, 560, 590, 620]) {
      await page.mouse.click(470, y);
      await page.waitForTimeout(400);
      const queued = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').queue?.items?.length || 0, libraryKey);
      if (queued) { searchRowY = y; break; }
    }
  }
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').history?.length === 1, libraryKey, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('#browser-video-host video');
    return video && !video.paused && video.currentTime > 0 && video.readyState >= 2;
  }, null, { timeout: 30_000 });
  assert.ok(failedFixtureStreams.length >= 1, 'the dead first stream must be tried before successful audio');
  const audio = await page.evaluate(() => {
    const video = document.querySelector('#browser-video-host video');
    return { src: video.currentSrc, attempt: video.dataset.attempt, time: video.currentTime };
  });
  assert.equal(new URL(audio.src).origin, new URL(url).origin);
  assert.match(new URL(audio.src).pathname, /^\/api\/playback\/stream\//);

  testStage = 'fixture playback explicit queue';
  const addResult = page.getByRole('button', { name: 'Add song to queue', exact: true });
  if (await addResult.count() && await addResult.first().isVisible()) await addResult.first().click();
  else {
    assert.notEqual(searchRowY, null, 'the title-row position is needed for the canvas queue control');
    await page.mouse.click(1320, searchRowY);
  }
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').queue?.items?.length === 2, libraryKey, { timeout: 10_000 });
  const afterQueue = await page.evaluate(key => ({
    library: JSON.parse(localStorage.getItem(key)),
    attempt: document.querySelector('#browser-video-host video')?.dataset.attempt,
  }), libraryKey);
  assert.equal(afterQueue.library.queue.currentIndex, 0);
  assert.equal(afterQueue.library.history.length, 1);
  assert.equal(afterQueue.attempt, audio.attempt, 'adding one queue item must not interrupt playback');

  testStage = 'fixture playback video mode';
  await clickButton('Switch audio or video', 1245, 875);
  await page.waitForFunction(() => {
    const host = document.getElementById('browser-video-host');
    const video = host?.querySelector('video');
    const bounds = host?.getBoundingClientRect();
    return video && !video.paused && video.videoWidth > 0 && video.videoHeight > 0 &&
      getComputedStyle(host).display !== 'none' && bounds.width > 0 && bounds.height > 0;
  }, null, { timeout: 30_000 });
  testStage = 'fixture playback pause and resume';
  await clickButton('Play or pause', 1245, 827);
  await page.waitForFunction(() => document.querySelector('#browser-video-host video')?.paused, null, { timeout: 10_000 });
  await clickButton('Play or pause', 1245, 827);
  await page.waitForFunction(() => {
    const video = document.querySelector('#browser-video-host video');
    return video && !video.paused;
  }, null, { timeout: 10_000 });
  testStage = 'fixture playback next queued song';
  await clickButton('Next song', 1275, 827);
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').queue?.currentIndex === 1, libraryKey, { timeout: 10_000 });

  await page.setViewportSize({ width: 760, height: 600 });
  await page.waitForTimeout(800);
  const canvas = await page.locator('#out canvas').first().boundingBox();
  assert.ok(canvas && canvas.width >= 740 && canvas.height >= 580, 'Canvas should resize to the available viewport');
  await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/compact.png' });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
  if (expectedRendererFallbacks.length) console.log(`Software renderer fallback used (${expectedRendererFallbacks.length} WebGL attempts unavailable).`);
  console.log('PASS: shared browser UI; themes/playlists; fixture search, actual audio failover, explicit queue, history, video, pause/resume and next; viewport resize.');
  console.log('::notice title=Windows browser checks::Themes, playlists, fixture search, audio failover, queue/history, video and controls passed (not a live-provider or Windows runtime test).');
} catch (error) {
  const failedShot = await page.screenshot({ type: 'png', path: 'tests/browser/screenshots/failure.png' }).catch(() => null);
  const state = await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('themashup.windows.library') || '{}');
    const el = document.querySelector('#browser-video-host video');
    return { queue: lib.queue, history: lib.history?.length, media: el && {
      paused: el.paused, currentTime: el.currentTime, readyState: el.readyState,
      error: el.error?.code, video: el.dataset.video, attempt: el.dataset.attempt,
    } };
  }).catch(() => ({}));
  const diagnostics = JSON.stringify({ searchRowY, state, playbackResponses, errors }).replaceAll('%', '%25').slice(0, 3000);
  console.log(`::error title=Browser playback state::${diagnostics}`);
  // Temporary CI diagnostic: artifacts are hosted on an inaccessible storage
  // domain in this sandbox. Split a downsampled screenshot across annotations.
  if (failedShot && process.env.DEBUG_SCREENSHOT_BRIDGE === '1') {
    const src = PNG.sync.read(failedShot);
    const dst = new PNG({ width: Math.floor(src.width / 2), height: Math.floor(src.height / 2) });
    for (let y = 0; y < dst.height; y++) for (let x = 0; x < dst.width; x++) {
      const si = ((y * 2) * src.width + x * 2) * 4, di = (y * dst.width + x) * 4;
      for (let c = 0; c < 3; c++) dst.data[di + c] = src.data[si + c] & 0xf8;
      dst.data[di + 3] = 255;
    }
    const encoded = PNG.sync.write(dst).toString('base64');
    const parts = encoded.match(/.{1,2800}/g) || [];
    if (parts.length <= 35) for (let i = 0; i < parts.length; i++)
      console.log(`::notice title=Debug image ${String(i + 1).padStart(2, '0')}/${parts.length}::${parts[i]}`);
  }
  console.error('Browser runtime errors:', errors.join(' | ') || '(none)');
  const summary = `${testStage}: ${error?.stack || error}`.replaceAll('%', '%25').replaceAll('\n', '%0A').slice(0, 3000);
  console.log(`::error title=Preview smoke test::${summary}`);
  console.error('ARIA labels:', await page.locator('[aria-label]').evaluateAll(nodes => nodes.slice(0, 30).map(n => n.getAttribute('aria-label'))).catch(() => []));
  throw error;
} finally {
  await browser.close();
}
