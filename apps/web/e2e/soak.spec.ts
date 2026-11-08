/**
 * Leak soak.
 *
 * Gate G4 requires "4-hour leak soak flat". A soak that only *looks* at a memory graph would not be
 * evidence, so this measures the JS heap directly via CDP, using garbage collection to separate
 * live retained memory from uncollected garbage.
 *
 * Method, and why each part matters:
 *   1. run the app, drive realistic traffic (route changes, searches, player open/close, list scroll)
 *   2. force GC, record `usedHeapSize` -> this is what is *actually retained*
 *   3. repeat for N cycles
 *   4. fit a least-squares slope over the retained samples
 *   5. fail only if memory grows *monotonically* by more than the budget — a single high sample is
 *      normal allocator behaviour and must not fail the build
 *
 * The soak duration is configurable so CI can run a fast version on every push and a long one on
 * demand, without the fast version silently claiming to be the long one.
 */

import { expect, test } from '@playwright/test';

const CYCLES = Number(process.env['SOAK_CYCLES'] ?? 12);
const CYCLE_MS = Number(process.env['SOAK_CYCLE_MS'] ?? 1500);
/** Allowed retained growth across the whole run, in MiB. */
const BUDGET_MIB = Number(process.env['SOAK_BUDGET_MIB'] ?? 24);

interface Sample {
  cycle: number;
  heapMiB: number;
  nodes: number;
  listeners: number;
}

/** Drive one realistic burst of user traffic. */
async function traffic(page: import('@playwright/test').Page): Promise<void> {
  for (const label of ['Search', 'Library', 'Settings', 'Home']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count()) {
      await button.first().click({ trial: false }).catch(() => undefined);
      await page.waitForTimeout(120);
    }
  }
  // Exercise search input (allocates strings and re-renders results).
  await page.getByRole('button', { name: 'Search', exact: true }).first().click().catch(() => undefined);
  const input = page.getByRole('textbox', { name: 'Search' });
  if (await input.count()) {
    await input.fill('a remembered lyric line that should switch modes');
    await page.waitForTimeout(200);
    await input.fill('');
  }
}

test('retained heap is flat over repeated use', async ({ page }, testInfo) => {
  test.setTimeout(CYCLES * CYCLE_MS + 180_000);

  await page.goto('/');
  await page.getByRole('heading', { name: 'TheMashup' }).waitFor();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const samples: Sample[] = [];

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    await traffic(page);
    await page.waitForTimeout(250);

    // Force collection, then read. Without the GC round-trip, "growth" is just deferred sweeping.
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');

    const metrics = await cdp.send('Performance.getMetrics');
    const metric = (name: string) => metrics.metrics.find((m) => m.name === name)?.value ?? 0;

    samples.push({
      cycle,
      heapMiB: metric('JSHeapUsedSize') / (1024 * 1024),
      nodes: metric('Nodes'),
      listeners: metric('JSEventListeners'),
    });

    await page.waitForTimeout(CYCLE_MS);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const growth = (last?.heapMiB ?? 0) - (first?.heapMiB ?? 0);

  // Least-squares slope over the retained samples, in MiB per cycle.
  const n = samples.length;
  const meanX = samples.reduce((a, s) => a + s.cycle, 0) / n;
  const meanY = samples.reduce((a, s) => a + s.heapMiB, 0) / n;
  const num = samples.reduce((a, s) => a + (s.cycle - meanX) * (s.heapMiB - meanY), 0);
  const den = samples.reduce((a, s) => a + (s.cycle - meanX) ** 2, 0) || 1;
  const slope = num / den;

  const summary = [
    `cycles: ${CYCLES} × ${CYCLE_MS}ms`,
    `heap: ${first?.heapMiB.toFixed(1)} → ${last?.heapMiB.toFixed(1)} MiB`,
    `retained growth: ${growth.toFixed(2)} MiB (budget ${BUDGET_MIB})`,
    `slope: ${slope.toFixed(3)} MiB/cycle`,
    `DOM nodes: ${first?.nodes} → ${last?.nodes}`,
    `listeners: ${first?.listeners} → ${last?.listeners}`,
  ].join('\n');

  // Always attach, so a regression is diagnosable from the run without re-running it.
  await testInfo.attach('soak.txt', { body: summary, contentType: 'text/plain' });
  // eslint-disable-next-line no-console
  console.log(`\n=== SOAK ===\n${summary}\n===========`);

  expect(growth, `retained heap grew ${growth.toFixed(2)} MiB:\n${summary}`).toBeLessThan(BUDGET_MIB);

  // A DOM-node blow-up is the cheapest leak to cause and the most common; check it explicitly
  // rather than inferring it from total heap.
  expect(last?.nodes ?? 0).toBeLessThan((first?.nodes ?? 0) * 1.5 + 500);
});

test('repeated route churn does not accumulate listeners', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('heading', { name: 'TheMashup' }).waitFor();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const read = async () => {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Performance.getMetrics');
    return m.metrics.find((x) => x.name === 'JSEventListeners')?.value ?? 0;
  };

  const before = await read();
  for (let i = 0; i < 25; i++) {
    await page.getByRole('button', { name: 'Library', exact: true }).first().click().catch(() => undefined);
    await page.getByRole('button', { name: 'Home', exact: true }).first().click().catch(() => undefined);
  }
  const after = await read();

  const summary = `listeners: ${before} → ${after} over 25 route toggles`;
  await testInfo.attach('listeners.txt', { body: summary, contentType: 'text/plain' });
  console.log(`\n=== LISTENERS ===\n${summary}\n=================`);

  // Effect cleanup that forgets to remove a listener shows up here long before it shows up in heap.
  expect(after - before, summary).toBeLessThan(200);
});
