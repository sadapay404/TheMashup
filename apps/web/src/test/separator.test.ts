import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The status-bar separator.
 *
 * The original was `h-full w-full bg-[var(--color-void)]` — an opaque band in the theme's ground
 * colour. On a dark theme that is a black strip sitting above the content, which the user described
 * as looking "very weird" and "out of place".
 *
 * The replacement has to be *themed*: it derives its colour from the accent the rest of the chrome
 * uses, it is translucent at the bottom edge so there is no seam, and it must not paint a flat
 * ground-colour block at full opacity. These assertions encode exactly those three properties,
 * because the failure mode is subtle — it looks fine in one theme and like a letterbox in another.
 */
describe('status-bar separator', () => {
  const source = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  const block = source.slice(
    source.indexOf('The status-bar separator.'),
    source.indexOf('{/* Route content */}'),
  );

  it('no longer paints a solid ground-colour band', () => {
    expect(block).not.toContain('bg-[var(--color-void)]');
  });

  it('derives its tint from the accent, like every other surface', () => {
    // A raw black/void fill is what made it look bolted on.
    expect(block).toContain('var(--accent)');
    expect(block).toContain('color-mix');
  });

  it('blurs what scrolls under it, so it reads as a layer rather than a bar', () => {
    expect(block).toContain('backdropFilter');
  });

  it('fades to transparent instead of ending on a hard edge', () => {
    expect(block).toMatch(/transparent\s+100%/);
  });

  it('stays inert: it must never eat a tap or take layout space', () => {
    expect(block).toContain('pointer-events-none');
    expect(block).toContain('fixed');
  });

  it('survives the amoled theme, where a black band is invisible to itself', () => {
    // The tint is built from the accent, not from a hard-coded dark value, so it cannot vanish into
    // an all-black theme the way a `--color-void` fill would.
    expect(block).not.toMatch(/#0{3,6}\b/);
  });
});
