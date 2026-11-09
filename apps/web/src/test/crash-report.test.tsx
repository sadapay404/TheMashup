/**
 * Crash report panel.
 *
 * The failure mode this guards against is subtle and serious: a panel that shows "no crash recorded"
 * when it actually could not read anything. Those are different answers and only one of them means
 * the app is healthy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { store } from '../state/store';
import { CrashReport } from '../components/settings/CrashReport';

const installCapacitor = (plugins: Record<string, unknown>) => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: plugins,
  };
};

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

beforeEach(() => {
  store.set({ toast: null });
});

describe('CrashReport', () => {
  it('says the platform cannot report, rather than that nothing crashed', async () => {
    // No Capacitor global at all: the browser case.
    render(<CrashReport />);
    await waitFor(() => {
      expect(screen.getByText(/only exists in the Android build/i)).toBeTruthy();
    });
    expect(screen.queryByText(/No crash is recorded/i)).toBeNull();
  });

  it('says no crash was recorded when the device genuinely has none', async () => {
    installCapacitor({
      MashupLog: {
        info: async () => ({ package: 'app.themashup.music', versionName: '0.3.0', versionCode: 22, sdk: 34, device: 'Pixel 7', debuggable: true }),
        crashes: async () => ({ found: false, text: '' }),
      },
    });
    render(<CrashReport />);
    await waitFor(() => expect(screen.getByText(/No crash is recorded/i)).toBeTruthy());
    expect(screen.getByText(/0.3.0 \(22\)/)).toBeTruthy();
  });

  it('shows the recorded crash and offers to copy it', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    installCapacitor({
      MashupLog: {
        info: async () => ({ package: 'app.themashup.music', versionName: '0.3.0', versionCode: 22, sdk: 34, device: 'Pixel 7', debuggable: false }),
        crashes: async () => ({
          found: true,
          text: '=== TheMashup crash ===\ntime: 2026-11-09 12:00\ntime: 2026-11-09 12:00:01\njava.lang.IllegalStateException: boom',
        }),
      },
    });

    render(<CrashReport />);
    await waitFor(() => expect(screen.getByText(/Last crash/i)).toBeTruthy());

    screen.getByText('Copy crash report').click();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const sent = writeText.mock.calls[0]![0];
    // The report has to carry the build identity, or it cannot be tied to an APK.
    expect(sent).toContain('build: 0.3.0 (22)');
    expect(sent).toContain('IllegalStateException: boom');
  });

  it('does not claim a crash when the plugin call itself fails', async () => {
    installCapacitor({
      MashupLog: {
        info: async () => {
          throw new Error('missing');
        },
        crashes: async () => {
          throw new Error('missing');
        },
      },
    });
    render(<CrashReport />);
    await waitFor(() => expect(screen.getByText(/only exists in the Android build/i)).toBeTruthy());
  });
});
