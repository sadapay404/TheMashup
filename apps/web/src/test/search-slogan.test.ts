import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two copy rules the user stated directly, and one layout rule that must not come back with them.
 *
 *  1. "find anything is written two times. Replace the top one with a slogan."
 *  2. The slogan is exactly "Search it, listen it, repeat it."
 *
 * The hero heading and the empty state are different components in the same file, which is why this
 * is asserted at the source level: it is the *pair* that has to stay distinct, and a mounted render
 * only ever shows one of them at a time.
 */
describe('search screen copy', () => {
  const source = readFileSync(
    resolve(__dirname, '../components/search/SearchScreen.tsx'),
    'utf8',
  );

  const occurrences = (needle: string) => source.split(needle).length - 1;

  it('uses the slogan as the hero heading', () => {
    expect(source).toContain('Search it, listen it, repeat it');
  });

  it('shows "Find anything" in exactly one place', () => {
    // One in the empty-state `title` prop. Comments do not count — this counts the literal string,
    // and the only literal left is the prop.
    expect(occurrences('"Find anything"')).toBe(1);
  });

  it('keeps the slogan out of the empty state', () => {
    // The empty state is the plain restatement; a slogan there would be the duplicate again, just
    // with different words.
    const emptyState = source.slice(source.indexOf('<EmptyState'));
    expect(emptyState).not.toContain('repeat it');
  });
});
