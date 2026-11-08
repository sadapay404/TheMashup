/** jsdom shims for APIs the app legitimately uses but jsdom does not implement. */

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// matchMedia (framer-motion probes it for reduced-motion)
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// IntersectionObserver (virtualisation / scroll-into-view)
if (!('IntersectionObserver' in window)) {
  class MockIO {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: MockIO });
}

// Element.scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// HTMLMediaElement: jsdom cannot decode audio, so implement just enough for the player to boot.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
  configurable: true,
  get: () => 210,
});

// Web Audio is not implemented in jsdom: the app must degrade, and we assert that it does.
if (!('AudioContext' in window)) {
  Object.defineProperty(window, 'AudioContext', { writable: true, value: undefined });
}

// crypto for visitorData
if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: (arr: Uint8Array) => arr.fill(7), randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  });
}

// Storage API used by Diagnostics.
if (!navigator.storage) {
  Object.defineProperty(navigator, 'storage', {
    writable: true,
    value: { persist: async () => true, estimate: async () => ({ usage: 1024, quota: 1e9 }) },
  });
}
