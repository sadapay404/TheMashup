/**
 * Dynamic accent colors sampled from album artwork (Canvas API).
 * Cross-origin-safe: if the image taints the canvas we simply keep the
 * theme accent — the blurred-art background layer still adapts visually.
 */

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 360;
  return h;
}

export function fallbackArtColors(seed: string): [string, string] {
  const h = hashHue(seed);
  return [`hsl(${h} 72% 58%)`, `hsl(${(h + 52) % 360} 68% 46%)`];
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  n: number;
}

/** Extract two dominant, reasonably saturated colors → sets --art-1 / --art-2. */
export async function applyArtworkAccent(
  el: HTMLElement | null,
  url: string | undefined,
  seed = "themashup",
): Promise<void> {
  if (!el) return;
  if (!url) {
    const [a, b] = fallbackArtColors(seed);
    el.style.setProperty("--art-1", a);
    el.style.setProperty("--art-2", b);
    return;
  }
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const size = 20;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets: Bucket[] = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (max + min) / 2 / 255;
      if (sat < 0.22 || lum < 0.12 || lum > 0.92) continue; // skip gray / black / white
      const hue = rgbToHue(r, g, b);
      const bucket = buckets[Math.min(11, Math.floor(hue / 30))];
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n++;
    }
    const ranked = buckets
      .map((bk) => ({ bk, score: bk.n * (1 + bk.n / 40) }))
      .filter((x) => x.bk.n > 0)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) throw new Error("no saturated pixels");
    const c1 = avg(ranked[0].bk);
    const c2 = ranked[1] ? avg(ranked[1].bk) : shift(c1);
    el.style.setProperty("--art-1", c1);
    el.style.setProperty("--art-2", c2);
  } catch {
    const [a, b] = fallbackArtColors(seed);
    el.style.setProperty("--art-1", a);
    el.style.setProperty("--art-2", b);
  }
}

function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return (h + 360) % 360;
}

function avg(b: Bucket): string {
  const r = Math.round(b.r / b.n);
  const g = Math.round(b.g / b.n);
  const bl = Math.round(b.b / b.n);
  return `rgb(${r} ${g} ${bl})`;
}

function shift(c: string): string {
  const m = c.match(/\d+/g);
  if (!m) return "rgb(139 108 255)";
  const [r, g, b] = m.map(Number);
  return `rgb(${Math.round((r + g) / 2)} ${Math.round((g + b) / 2)} ${Math.round((r + b) / 2)})`;
}
