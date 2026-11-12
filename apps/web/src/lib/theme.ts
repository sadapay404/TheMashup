/**
 * Themes.
 *
 * The design system derives colour from artwork (docs/04), which means a theme cannot simply swap two
 * hex values: it must define the *surface* palette that artwork accents are composited onto. These
 * five themes differ in three things that matter:
 *
 *   1. **Ground** — how dark or light the canvas is. `paper` is genuinely light, which is why the
 *      component library no longer hardcodes `bg-white/*` (that was invisible-on-white before).
 *   2. **Wash** — the neutral overlay hue. White on dark grounds, black on light ones. Every glass
 *      surface, chip and row uses it, so a light theme keeps the same visual rhythm inverted.
 *   3. **On-accent** — the foreground used on solid accent fills. Black works for bright accents and
 *      fails badly on a deep neon one, so each theme states it.
 *
 * A theme is applied by setting `data-theme` on <html>; all values live in `styles/tokens.css`.
 */

import type { ThemeId } from '@/state/store';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  /** One line the user sees in Settings — states the intent, not marketing. */
  blurb: string;
  /** Swatches for the picker: ground, raised, accent seed, text. */
  swatch: [string, string, string, string];
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'obsidian',
    name: 'Liquid Obsidian',
    blurb: 'Ink-black glass, colour pulled from the artwork. The original.',
    swatch: ['#07070a', '#131319', '#8b7bff', '#f4f4f6'],
    dark: true,
  },
  {
    id: 'vinyl',
    name: 'Vinyl Sleeve',
    blurb: 'Warm charcoal and aged paper, like a record sleeve on a shelf.',
    swatch: ['#14100c', '#221b14', '#d99a4e', '#f3e9d9'],
    dark: true,
  },
  {
    id: 'paper',
    name: 'Ink on Paper',
    blurb: 'A true light theme: warm paper stock with ink text.',
    swatch: ['#f6f1e7', '#ffffff', '#1d4ed8', '#1a1712'],
    dark: false,
  },
  {
    id: 'cyberpunk',
    name: 'Neon Rain',
    blurb: 'Deep violet night with hot magenta and cyan edge lighting.',
    swatch: ['#05010d', '#120a24', '#ff2e88', '#e9e6ff'],
    dark: true,
  },
  {
    id: 'forest',
    name: 'Midnight Forest',
    blurb: 'Mossy deep green, low contrast, easy on the eyes at night.',
    swatch: ['#06110d', '#0d1d16', '#4ade80', '#e3f2e8'],
    dark: true,
  },
];

export const DEFAULT_THEME: ThemeId = 'obsidian';

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/**
 * Apply a theme to the document.
 *
 * `data-theme` drives the token block in CSS. `data-amoled` is kept separate and orthogonal: true
 * black is an *additional* crushing of the ground, available on the dark themes only, because forcing
 * it on `paper` would invert the theme into nonsense.
 */
export function applyTheme(id: ThemeId, amoled: boolean): void {
  const root = document.documentElement;
  const meta = themeMeta(id);
  root.dataset['theme'] = id;
  root.dataset['amoled'] = String(Boolean(amoled) && meta.dark);
  // Tells the browser whether native widgets (scrollbars, form controls, focus rings) should render
  // dark. Without this, a light theme shows dark scrollbars and unreadable autofill.
  root.style.colorScheme = meta.dark ? 'dark' : 'light';

  /*
   * The system bar follows the theme.
   *
   * `theme-color` is what Android paints the status bar with on a WebView that draws edge-to-edge. The
   * page background changes with the theme — `paper` is a genuine light theme — so a hardcoded
   * `#07070a` in index.html left a black bar over a cream app the moment the user picked it. The bar is
   * transparent in styles.xml, so this is the colour that shows through the separator strip.
   */
  const ground = getComputedStyle(root).getPropertyValue('--color-void').trim();
  if (ground) {
    let tag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'theme-color';
      document.head.appendChild(tag);
    }
    tag.content = ground;
  }
}
