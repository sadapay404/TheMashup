/**
 * Notifications.
 *
 * The requirement: notifications must always arrive — downloads, playback, anything important. The
 * app had exactly two, and both were accidents of other features (the download foreground service and
 * the Media3 session). Every message the user was actually being told something by was a toast that
 * only existed for four seconds, on screen, inside the WebView.
 *
 * These tests pin the routing rules and the bridge contract. They cannot prove a phone buzzes; they
 * can prove a message that matters is not silently dropped on the way there, and that a message that
 * does not matter does not train the user to ignore the shade.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_ID_RANGE,
  clearNotification,
  deservesNotification,
  notificationsAvailable,
} from '../lib/notifications';

/**
 * The module caches "we already asked for permission" for the life of the page — correct in production,
 * wrong across tests. Re-importing resets that state without adding a test-only export to the module.
 */
async function freshModule() {
  vi.resetModules();
  return import('../lib/notifications');
}

type ShowCall = Record<string, unknown>;

function installPlugin(overrides: Record<string, unknown> = {}) {
  const calls: ShowCall[] = [];
  const canceled: number[] = [];
  const plugin = {
    show: vi.fn(async (args: ShowCall) => {
      calls.push(args);
      return { shown: true };
    }),
    cancel: vi.fn(async (args: { id?: number }) => {
      if (typeof args.id === 'number') canceled.push(args.id);
    }),
    status: vi.fn(async () => ({ granted: true, canAsk: false })),
    requestPermission: vi.fn(async () => ({ granted: true })),
    takePendingRoute: vi.fn(async () => ({ route: null })),
    ...overrides,
  };
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { MashupNotify: plugin },
  };
  (window as unknown as { Capacitor: { Plugins: Record<string, unknown> } }).Capacitor.Plugins.MashupUi = {
    insets: async () => ({ top: 32, bottom: 16, left: 0, right: 0, reliable: true }),
  };
  return { plugin, calls, canceled };
}

function uninstallPlugin() {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
}

afterEach(() => {
  uninstallPlugin();
  vi.restoreAllMocks();
});

describe('which messages are worth a notification', () => {
  it('always surfaces a failure', () => {
    expect(deservesNotification('error', 'Download failed')).toBe(true);
    expect(deservesNotification('error', 'Native player error — HTTP 403')).toBe(true);
  });

  it('surfaces a result: something was saved, moved or imported', () => {
    for (const text of [
      'Saved Jhol',
      'Downloaded 12 tracks',
      'Moved to Road Trip',
      'Cleared 4 finished',
      'Imported 3 tracks',
    ]) {
      expect(deservesNotification('success', text)).toBe(true);
    }
  });

  it('keeps a micro-confirmation as a toast only', () => {
    // "Added to queue" is feedback, not news. Pushing every one into the shade is how an app teaches
    // its users to swipe notifications away without reading them.
    for (const text of ['Added to your likes', 'Shuffled']) {
      expect(deservesNotification('success', text)).toBe(false);
    }
    expect(deservesNotification('info', 'Via corsproxy.io')).toBe(false);
  });
});

describe('the bridge', () => {
  let mod: typeof import('../lib/notifications');

  beforeEach(async () => {
    uninstallPlugin();
    mod = await freshModule();
  });

  it('is a no-op on the web build, and says so instead of throwing', async () => {
    expect(await mod.notificationsAvailable()).toBe(false);
    await expect(mod.postNotification({ title: 'Saved Jhol' })).resolves.toBe(false);
    await expect(mod.clearNotification()).resolves.toBeUndefined();
  });

  it('posts through the plugin on the device', async () => {
    const { calls } = installPlugin();
    // The first call also asks for permission, which the fake grants.
    const shown = await mod.postNotification({
      title: 'Downloaded',
      body: 'Jhol',
      channel: 'alerts',
      route: 'downloads',
      progress: 40,
    });
    expect(shown).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      title: 'Downloaded',
      body: 'Jhol',
      channel: 'alerts',
      route: 'downloads',
      progress: 40,
    });
  });

  it('keeps its ids clear of the native rows', async () => {
    // 4211/4212/1 belong to the Kotlin side. A status message that reused one of them would erase the
    // download progress the user is watching.
    expect(NOTIFICATION_ID_RANGE.first).toBeGreaterThan(4212);
    expect(NOTIFICATION_ID_RANGE.status).toBeGreaterThanOrEqual(NOTIFICATION_ID_RANGE.first);
    expect(NOTIFICATION_ID_RANGE.status).toBeLessThanOrEqual(NOTIFICATION_ID_RANGE.last);
  });

  it('clamps an out-of-range id instead of trusting the caller', async () => {
    const { calls } = installPlugin();
    await mod.postNotification({ title: 'x', id: 7 });
    await mod.postNotification({ title: 'y', id: 999_999 });
    expect(calls[0]!.id).toBe(NOTIFICATION_ID_RANGE.first);
    expect(calls[1]!.id).toBe(NOTIFICATION_ID_RANGE.last);
  });

  it('does not ask for permission twice', async () => {
    const { plugin } = installPlugin();
    await mod.postNotification({ title: 'a' });
    await mod.postNotification({ title: 'b' });
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('silently does nothing when the plugin rejects', async () => {
    installPlugin({
      show: async () => {
        throw new Error('boom');
      },
      requestPermission: async () => ({ granted: true }),
    });
    await expect(mod.postNotification({ title: 'x' })).resolves.toBe(false);
  });

  it('reports not-shown when the user has notifications off', async () => {
    installPlugin({ requestPermission: async () => ({ granted: false }) });
    // A caller (the download sheet) can then say so honestly rather than pretending it worked.
    expect(await mod.postNotification({ title: 'x' })).toBe(false);
  });
});

describe('tapping a notification', () => {
  let mod: typeof import('../lib/notifications');

  beforeEach(async () => {
    uninstallPlugin();
    mod = await freshModule();
  });

  it('routes to the screen the message was about', async () => {
    installPlugin({ takePendingRoute: async () => ({ route: 'downloads' }) });
    const seen: string[] = [];
    expect(await mod.takePendingRoute((r) => seen.push(r))).toBe(true);
    expect(seen).toEqual(['downloads']);
  });

  it('does nothing when no tap is waiting', async () => {
    installPlugin();
    const apply = vi.fn();
    expect(await mod.takePendingRoute(apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('is a no-op on the web build', async () => {
    const apply = vi.fn();
    expect(await mod.takePendingRoute(apply)).toBe(false);
  });
});
