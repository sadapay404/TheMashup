/**
 * Auto-recovery tests.
 *
 * The brief requires "auto-recovery state persistence" and "defensive coding". Persistence is the
 * easiest feature to get subtly wrong, because the failure modes are invisible in normal use:
 * a corrupt blob, a schema change, a full disk, or a queue that no longer matches its index.
 *
 * Every test here simulates a hostile or degraded storage layer, not the happy path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPersisted, loadPersisted, startAutosave } from '../lib/persist';
import { store, type AppState } from '../state/store';

const KEY = 'mashup.state.v1';

const track = {
  id: 'vid00000001',
  title: 'Wonderwall',
  artist: 'Oasis',
  album: 'Whatever',
  durationSec: 258,
  thumbs: [{ url: 'https://example.test/a.jpg', width: 60, height: 60 }],
};

function seed(overrides: Partial<AppState> = {}): void {
  store.set({
    route: 'library',
    queue: [track],
    index: 0,
    positionSec: 42,
    volume: 0.5,
    muted: false,
    repeat: 'all',
    shuffle: true,
    rate: 1,
    history: [track],
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('loadPersisted', () => {
  it('returns null when nothing was saved', () => {
    expect(loadPersisted()).toBeNull();
  });

  it('round-trips a session through a save', () => {
    const stop = startAutosave(store.getState, store.subscribe);
    // Autosave is change-driven: `seed()` ran before subscription, so make one real change.
    store.set({ positionSec: 42 });
    vi.advanceTimersByTime(5000);
    stop();

    const saved = loadPersisted();
    expect(saved).not.toBeNull();
    expect(saved?.queue[0]?.title).toBe('Wonderwall');
    expect(saved?.positionSec).toBe(42);
    expect(saved?.repeat).toBe('all');
  });

  it('discards a corrupt blob instead of throwing', () => {
    localStorage.setItem(KEY, '{"v":1,"queue":[TRUNCATED');
    expect(() => loadPersisted()).not.toThrow();
    expect(loadPersisted()).toBeNull();
    // The bad blob is removed so the next save starts clean.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('discards an unknown schema version', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 99, queue: [track], index: 0 }));
    expect(loadPersisted()).toBeNull();
  });

  it('rejects entries that are not tracks', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, queue: [{ id: 'x' }, null, 42, track], index: 0 }),
    );
    const saved = loadPersisted();
    // Only the well-formed track survives.
    expect(saved?.queue).toHaveLength(1);
    expect(saved?.queue[0]?.id).toBe('vid00000001');
  });

  it('clamps an out-of-range index rather than returning a dangling one', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, queue: [track], index: 9999 }));
    const saved = loadPersisted();
    expect(saved?.index).toBe(0);
  });

  it('clamps volume and rate into their valid ranges', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, queue: [track], index: 0, volume: 42, rate: -7 }),
    );
    const saved = loadPersisted();
    expect(saved?.volume).toBe(1);
    expect(saved?.rate).toBe(0.5);
  });

  it('falls back to defaults for unknown enum values', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, queue: [track], index: 0, route: '../etc/passwd', repeat: 'sideways' }),
    );
    const saved = loadPersisted();
    expect(saved?.route).toBe('home');
    expect(saved?.repeat).toBe('off');
  });

  it('keeps the queue bounded so storage cannot grow without limit', () => {
    const many = Array.from({ length: 500 }, (_v, i) => ({ ...track, id: `vid${i}` }));
    localStorage.setItem(KEY, JSON.stringify({ v: 1, queue: many, index: 0 }));
    expect(loadPersisted()?.queue.length).toBe(200);
  });

  it('survives a storage layer that throws on read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    expect(() => loadPersisted()).not.toThrow();
    expect(loadPersisted()).toBeNull();
    spy.mockRestore();
  });
});

describe('startAutosave', () => {
  it('does not write on every state change (throttled)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const stop = startAutosave(store.getState, store.subscribe);

    for (let i = 0; i < 50; i++) store.set({ positionSec: i });
    vi.advanceTimersByTime(10);

    // 50 changes inside one throttle window must produce at most one write.
    expect(setItem.mock.calls.length).toBeLessThanOrEqual(1);
    stop();
    setItem.mockRestore();
  });

  it('flushes when stopped, so a teardown never loses the last change', () => {
    const stop = startAutosave(store.getState, store.subscribe);
    store.set({ positionSec: 99 });
    stop();
    expect(loadPersisted()?.positionSec).toBe(99);
  });

  it('falls back to a slim payload when the quota is exceeded', () => {
    const real = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      calls++;
      // First write fails as if the quota were full; the retry succeeds.
      if (calls === 1) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      return real.call(this, k, v);
    });

    const stop = startAutosave(store.getState, store.subscribe);
    store.set({ positionSec: 7 });
    stop();

    const saved = loadPersisted();
    expect(saved?.positionSec).toBe(7);
    // The slim retry drops the heavy fields.
    expect(saved?.history).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('never lets a storage failure escape to the caller', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('total failure');
    });
    const stop = startAutosave(store.getState, store.subscribe);
    expect(() => {
      store.set({ positionSec: 3 });
      stop();
    }).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('clearPersisted', () => {
  it('removes the saved blob', () => {
    const stop = startAutosave(store.getState, store.subscribe);
    store.set({ positionSec: 5 });
    stop();
    expect(localStorage.getItem(KEY)).not.toBeNull();
    clearPersisted();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
