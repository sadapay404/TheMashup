/**
 * Art-derived palette (design system §1).
 *
 * Small, dependency-free median-cut-ish sampler over a downscaled canvas. Runs once per track
 * (~1 ms at 32×32) and writes CSS custom properties, so every surface re-tints in one paint.
 */

const cache = new Map<string, { accent: string; accent2: string; dark: boolean }>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslCss(h: number, s: number, l: number, a = 1): string {
  return a === 1 ? `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)` : `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}% / ${a})`;
}

export async function extractPalette(imageUrl: string): Promise<{ accent: string; accent2: string; dark: boolean } | null> {
  const hit = cache.get(imageUrl);
  if (hit) return hit;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = imageUrl;
    await img.decode();

    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Bucket by hue, weight by saturation; ignore near-grey and near-black pixels.
    const buckets = new Map<number, { n: number; s: number; l: number; w: number }>();
    let sumL = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const [h, s, l] = rgbToHsl(r, g, b);
      sumL += l;
      count++;
      if (s < 18 || l < 12 || l > 92) continue;
      const key = Math.round(h / 24) * 24;
      const bucket = buckets.get(key) ?? { n: 0, s: 0, l: 0, w: 0 };
      bucket.n++;
      bucket.s += s;
      bucket.l += l;
      bucket.w += s * (1 - Math.abs(l - 55) / 100);
      buckets.set(key, bucket);
    }

    const ranked = [...buckets.entries()].sort((a, b) => b[1].w - a[1].w);
    const primary = ranked[0]?.[1];
    const secondary = ranked[1]?.[1] ?? primary;
    const avgL = count ? sumL / count : 0;

    if (!primary) {
      const res = { accent: 'hsl(258 90% 68%)', accent2: 'hsl(288 90% 70%)', dark: true };
      cache.set(imageUrl, res);
      return res;
    }

    // Force into a usable band: 78% saturation, 62% lightness (design system §2.1).
    const h1 = ranked[0]?.[0] ?? 258;
    const h2 = ranked[1]?.[0] ?? h1 + 30;
    const res = {
      accent: hslCss(h1, 78, 62),
      accent2: hslCss(h2, 78, 66),
      dark: avgL < 45,
    };
    cache.set(imageUrl, res);
    return res;
  } catch {
    // No canvas (CORS-tainted image) → keep the previous palette rather than flashing grey.
    return null;
  }
}

/**
 * Apply an artwork-derived palette.
 *
 * The extracted accent sits at 62% lightness with black text, which is right on a dark ground. On the
 * light `paper` theme that same accent is too pale to read against paper stock, so the accent is
 * darkened and the foreground flipped. Doing this here — rather than in CSS — keeps the extractor
 * theme-agnostic while still guaranteeing contrast in every theme.
 */
export function applyPalette(p: { accent: string; accent2: string } | null): void {
  if (!p || typeof document === 'undefined') return;
  const root = document.documentElement;
  const light = root.dataset['theme'] === 'paper';

  const accent = light ? darkenForPaper(p.accent) : p.accent;
  const accent2 = light ? darkenForPaper(p.accent2) : p.accent2;

  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', accent2);
  root.style.setProperty('--accent-soft', `color-mix(in oklab, ${accent} ${light ? 12 : 18}%, transparent)`);
  root.style.setProperty('--accent-glow', `color-mix(in oklab, ${accent} 42%, transparent)`);
  root.style.setProperty('--on-accent', light ? '#ffffff' : '#000000');
}

/** Drop an `hsl(h s% l%)` accent to a legible lightness on paper. Passes anything else through. */
function darkenForPaper(color: string): string {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(color.trim());
  if (!m) return color;
  const l = Math.min(46, Number(m[3]) * 0.62);
  return `hsl(${m[1]} ${Math.min(88, Number(m[2]) + 6)}% ${l.toFixed(1)}%)`;
}
