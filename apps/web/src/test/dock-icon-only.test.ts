import { describe, expect, it } from 'vitest';
import { DOCK_H, DOCK_ICON, DOCK_ITEM_H, DOCK_ITEM_W, DOCK_PADDING } from '@/lib/layout';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The dock is icon-only at the user's request: "remove text from the dock, keep and enlarge only the
 * icons". Three things have to hold at once, and each has been broken by a plausible-looking edit:
 *
 *  1. no text label is rendered (the request);
 *  2. the icon is genuinely larger than before, not merely equal (the request);
 *  3. the accessibility name survives (otherwise five icon buttons have no names at all).
 *
 * The third one is not in the user's wording, but removing it would be a regression dressed up as a
 * feature, so it is pinned here.
 */
describe('dock: icon-only', () => {
  const source = readFileSync(
    resolve(__dirname, '../components/shell/SmartDock.tsx'),
    'utf8',
  );

  it('renders no visible label text', () => {
    // A *rendered* label is the interpolation sitting as a text node between JSX tags. `aria-label`
    // also contains the substring, so a plain `toContain` would fail on the thing we require.
    expect(source).not.toMatch(/>\s*\{label\}\s*</);
  });

  it('keeps the label for assistive technology', () => {
    expect(source).toContain('aria-label={label}');
  });

  it('grows the icon rather than keeping the labelled size', () => {
    // 21 was the size next to a text label; anything <= 21 has not been enlarged.
    expect(DOCK_ICON).toBeGreaterThan(21);
    expect(source).toContain('width={DOCK_ICON}');
  });

  it('keeps every destination a square target, so no dead space replaces the words', () => {
    expect(DOCK_ITEM_W).toBe(DOCK_ITEM_H);
    // And the container still fits exactly the item plus its padding — the buffer geometry and the
    // long-press detent maths both read these constants.
    expect(DOCK_H).toBe(DOCK_ITEM_H + DOCK_PADDING * 2);
  });
});
