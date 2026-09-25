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
  if (!onTrack) onLivelyTrack(null); // expose the global even before anyone subscribes
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

// ---- now playing ----
//
// With `"Arguments": "--system-nowplaying"` in LivelyInfo.json (Lively 2.0.6.0+),
// Lively also calls `livelyCurrentTrack(data)` with what Windows' media controls
// report for the active player (the same info as the volume popup): title, artist,
// album and the cover as a bare base64 string (no data: prefix, format unspecified).
// It sends null when playback stops, and re-sends the current track when the
// wallpaper resumes from pause.

export interface LivelyTrack {
  Title?: string | null;
  Artist?: string | null;
  AlbumArtist?: string | null;
  AlbumTitle?: string | null;
  Thumbnail?: string | null;
  PlaybackType?: string | number | null;
  TrackNumber?: number | null;
  Genres?: string[] | null;
}

let onTrack: ((track: LivelyTrack | null) => void) | null = null;

/**
 * Lively's WebView2 player JSON-serialises every argument it passes to a page
 * function, and it hands this one a track that is *already* a JSON string, so the
 * page receives a quoted string (or the string "null"), not an object. Accept
 * both shapes.
 */
function livelyCurrentTrack(data: LivelyTrack | string | null | undefined): void {
  let track: LivelyTrack | null = null;
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      track = parsed && typeof parsed === 'object' ? (parsed as LivelyTrack) : null;
    } catch {
      track = null;
    }
  } else if (data && typeof data === 'object') {
    track = data;
  }
  onTrack?.(track);
}

/** Subscribe to Lively's now-playing updates (null = nothing playing). */
export function onLivelyTrack(cb: ((track: LivelyTrack | null) => void) | null): void {
  onTrack = cb;
  (window as unknown as { livelyCurrentTrack?: typeof livelyCurrentTrack }).livelyCurrentTrack =
    livelyCurrentTrack;
}

/**
 * The cover as a data: URL, or null. The image format is sniffed from the base64
 * head (PNG / JPEG / GIF / WebP / BMP) since Lively does not say which it is.
 */
export function livelyCoverUrl(track: LivelyTrack | null): string | null {
  const b64 = track?.Thumbnail;
  if (!b64 || typeof b64 !== 'string') return null;
  if (b64.startsWith('data:')) return b64;
  const mime = b64.startsWith('iVBORw0KGgo')
    ? 'image/png'
    : b64.startsWith('/9j/')
      ? 'image/jpeg'
      : b64.startsWith('R0lGOD')
        ? 'image/gif'
        : b64.startsWith('UklGR')
          ? 'image/webp'
          : b64.startsWith('Qk')
            ? 'image/bmp'
            : 'image/png';
  return `data:${mime};base64,${b64}`;
}

/** A stable key for "is this the same song as before" (Lively re-sends on resume). */
export function livelyTrackKey(track: LivelyTrack | null): string {
  if (!track) return '';
  return `${track.Title ?? ''}\u0000${track.Artist ?? ''}\u0000${track.AlbumTitle ?? ''}`;
}
