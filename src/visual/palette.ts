import * as THREE from 'three';

export interface Palette {
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { name: 'Neon', colors: ['#ff2d95', '#8a2dff', '#2dd4ff', '#39ff88'] },
  { name: 'Sunset', colors: ['#ff4d6d', '#ff922b', '#ffd23f', '#ff5da2'] },
  { name: 'Ocean', colors: ['#0466c8', '#0496ff', '#34e5ff', '#48cae4'] },
  { name: 'Aurora', colors: ['#39ff14', '#00e5ff', '#8a2be2', '#ff5edb'] },
  { name: 'Fire', colors: ['#ffd60a', '#ff8500', '#ff5400', '#ff0054'] },
  { name: 'Mono', colors: ['#0a2540', '#3a86ff', '#9bd1ff', '#ffffff'] },
];

export function paletteNames(): string[] {
  return PALETTES.map((p) => p.name);
}

export function getPalette(name: string): Palette {
  return PALETTES.find((p) => p.name === name) ?? PALETTES[0]!;
}

const _a = new THREE.Color();
const _b = new THREE.Color();

/** Sample a gradient across the palette colours at t in [0,1]. */
export function sampleGradient(colors: string[], t: number, out: THREE.Color = new THREE.Color()): THREE.Color {
  const n = colors.length;
  if (n === 0) return out.set('#ffffff');
  if (n === 1) return out.set(colors[0]!);
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (n - 1);
  const i = Math.min(n - 2, Math.floor(scaled));
  const f = scaled - i;
  _a.set(colors[i]!);
  _b.set(colors[i + 1]!);
  return out.copy(_a).lerp(_b, f);
}

/** Shift hue (0..1 wrap) and scale saturation of a colour, in place. */
export function adjustHSL(color: THREE.Color, hueShift: number, satScale: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.h = (hsl.h + hueShift) % 1;
  if (hsl.h < 0) hsl.h += 1;
  hsl.s = Math.max(0, Math.min(1, hsl.s * satScale));
  return color.setHSL(hsl.h, hsl.s, hsl.l);
}
