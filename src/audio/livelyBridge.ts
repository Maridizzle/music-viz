// Lively Wallpaper (https://github.com/rocksdanister/lively) runs a web page as the
// desktop background and pushes the PC's system audio into it by calling a global
// `livelyAudioListener(audioArray)` on the page: a 128-entry array of decimals,
// normally 0..1 (the docs warn it can exceed 1, so we clamp). Lively starts its
// analyser (NAudio WASAPI loopback → FFT → 128 linear bins) for wallpapers whose
// LivelyInfo.json has `"Type": 2` (webaudio); no extra arguments are needed and
// adding `--audio` there actually breaks launch (duplicate option). See lively/.
//
// This module registers that global and keeps the latest spectrum. The engine reads
// it every frame instead of a Web Audio analyser, so no capture permission, no
// clicks, and no WASAPI loopback are needed: Lively already did the listening.

export const LIVELY_BANDS = 128;

/** Set at build time by vite.config.ts for the packaged wallpaper (LIVELY=1). */
export const isLivelyBuild: boolean = import.meta.env.VITE_MV_LIVELY === '1';

const latest = new Float32Array(LIVELY_BANDS);
let lastCallMs = 0;
let onFirst: (() => void) | null = null;
let seen = false;

function livelyAudioListener(audioArray: ArrayLike<number>): void {
  const n = Math.min(LIVELY_BANDS, audioArray.length);
  for (let i = 0; i < n; i++) {
    const v = Number(audioArray[i]);
    latest[i] = v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; // NaN → 0, then clamp
  }
  for (let i = n; i < LIVELY_BANDS; i++) latest[i] = 0;
  lastCallMs = performance.now();
  if (!seen) {
    seen = true;
    onFirst?.();
  }
}

/**
 * Expose the callback Lively looks for. Safe to call on any platform: outside
 * Lively it is simply never invoked. `onFirstData` fires once, on the first call,
 * so a non-Lively build can still switch over if Lively happens to host it.
 */
export function installLivelyBridge(onFirstData?: () => void): void {
  onFirst = onFirstData ?? null;
  (window as unknown as { livelyAudioListener?: typeof livelyAudioListener }).livelyAudioListener =
    livelyAudioListener;
}

/** True once Lively has delivered audio at least once. */
export function hasLivelyAudio(): boolean {
  return seen;
}

/** The latest 128 clamped bands (shared buffer, read synchronously). */
export function livelySpectrum(): Float32Array {
  return latest;
}

/** Milliseconds since Lively last pushed audio; Infinity if never. */
export function livelySilenceMs(): number {
  return seen ? performance.now() - lastCallMs : Infinity;
}
