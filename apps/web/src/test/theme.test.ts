import { describe, expect, it } from 'vitest';
import { applyTheme, THEMES, themeMeta, DEFAULT_THEME } from '@/lib/theme';

/**
 * Theme application is the kind of code that looks fine and then silently does nothing — the AMOLED
 * toggle in this codebase was persisted nowhere and applied nowhere on load, so it reset on every
 * reload. These tests assert the observable effect on the document, not internal state.
 */
describe('themes', () => {
  it('ships five distinct themes', () => {
    expect(THEMES).toHaveLength(5);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(5);
    expect(THEMES.map((t) => t.id)).toContain(DEFAULT_THEME);
  });

  it('every theme gives a full four-swatch preview', () => {
    for (const t of THEMES) {
      expect(t.swatch).toHaveLength(4);
      for (const c of t.swatch) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('applyTheme writes data-theme and the colour scheme', () => {
    applyTheme('paper', false);
    expect(document.documentElement.dataset['theme']).toBe('paper');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyTheme('cyberpunk', false);
    expect(document.documentElement.dataset['theme']).toBe('cyberpunk');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('refuses AMOLED on a light theme instead of half-inverting it', () => {
    applyTheme('paper', true);
    expect(document.documentElement.dataset['amoled']).toBe('false');

    applyTheme('vinyl', true);
    expect(document.documentElement.dataset['amoled']).toBe('true');
  });

  it('falls back to the default theme for an unknown id', () => {
    // Guards against a persisted id from a future/removed theme leaving the UI unstyled.
    const meta = themeMeta('nope' as never);
    expect(meta.id).toBe(THEMES[0]!.id);
  });
});
