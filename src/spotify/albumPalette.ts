const SAMPLE = 40; // px — plenty for colour statistics, cheap to scan
const BUCKETS = 24; // 15° hue buckets

interface Bucket {
  weight: number;
  r: number;
  g: number;
  b: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/**
 * Pull a neon-friendly 3–4 colour palette out of album art: the most saturated
 * hue families, weighted by how vivid they are, lifted to glow on a dark
 * background. Returns null when the cover is essentially monochrome or the image
 * can't be read (e.g. no CORS), so the user's own palette stays in place.
 */
export async function extractAlbumPalette(url: string): Promise<string[] | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null; // tainted canvas
  }

  const buckets: Bucket[] = Array.from({ length: BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.1 || l > 0.93 || s < 0.22) continue; // drop black/white/grey
    const w = s * (1 - Math.abs(l - 0.5) * 1.3);
    if (w <= 0) continue;
    const bk = buckets[Math.min(BUCKETS - 1, Math.floor(h * BUCKETS))]!;
    bk.weight += w;
    bk.r += r * w;
    bk.g += g * w;
    bk.b += b * w;
  }

  const ranked = buckets
    .map((bk, idx) => ({ ...bk, idx }))
    .filter((bk) => bk.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((s, bk) => s + bk.weight, 0);
  if (ranked.length === 0 || total < SAMPLE * SAMPLE * 0.02) return null; // near-monochrome cover

  const picked: { h: number; s: number; l: number }[] = [];
  for (const bk of ranked) {
    if (bk.weight < total * 0.04) break;
    const [h, s, l] = rgbToHsl(bk.r / bk.weight, bk.g / bk.weight, bk.b / bk.weight);
    const clash = picked.some((p) => {
      const d = Math.abs(p.h - h);
      return Math.min(d, 1 - d) < 30 / 360;
    });
    if (!clash) picked.push({ h, s, l });
    if (picked.length === 4) break;
  }
  if (picked.length === 0) return null;
  if (picked.length === 1) {
    // One dominant hue: add a complementary pair so gradients still travel.
    const h = picked[0]!.h;
    picked.push({ h: (h + 0.42) % 1, s: 0.9, l: 0.58 }, { h: (h + 0.58) % 1, s: 0.9, l: 0.58 });
  }

  // Neon-ify (the visuals live on a near-black background) and order by hue for a smooth gradient.
  return picked
    .sort((a, b) => a.h - b.h)
    .map((c) => hslToHex(c.h, Math.max(0.82, c.s), Math.max(0.5, Math.min(0.66, c.l))));
}
