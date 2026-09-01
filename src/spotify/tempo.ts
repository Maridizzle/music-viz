import type { TempoInfo } from './types';

const STORE_KEY = 'music-viz:tempo';
const MAX_ENTRIES = 400;
const JSONP_TIMEOUT_MS = 7000;

/** Keep a musically useful range: halve/double so beats land at a danceable rate. */
export function normalizeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

/** Per-track beat grid cache (bpm + phase), persisted so a song only needs learning once. */
export class TempoStore {
  private map: Record<string, TempoInfo> = this.load();

  get(trackId: string): TempoInfo | null {
    return this.map[trackId] ?? null;
  }

  set(trackId: string, info: TempoInfo): void {
    this.map[trackId] = info;
    const keys = Object.keys(this.map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => this.map[a]!.at - this.map[b]!.at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete this.map[k]);
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.map));
    } catch {
      /* ignore */
    }
  }

  private load(): Record<string, TempoInfo> {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, TempoInfo>) : {};
    } catch {
      return {};
    }
  }
}

let jsonpCounter = 0;

/** Load a JSONP endpoint (Deezer's public API has no CORS headers but supports `output=jsonp`). */
function jsonp<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const name = `__mvJsonp${Date.now().toString(36)}_${jsonpCounter++}`;
    const script = document.createElement('script');
    const w = window as unknown as Record<string, unknown>;
    const cleanup = (): void => {
      delete w[name];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, JSONP_TIMEOUT_MS);
    w[name] = (data: T): void => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('load error'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${name}`;
    document.head.appendChild(script);
  });
}

interface DeezerSearch {
  data?: { id: number; title: string; artist?: { name: string } }[];
}
interface DeezerTrack {
  bpm?: number;
}

function cleanTitle(title: string): string {
  // "Song - Remastered 2011" / "Song (feat. X)" → "Song": better search hits
  return title
    .replace(/\s*[-–]\s*(remaster|remastered|live|radio edit|single version|mono|stereo|deluxe|bonus)[^-–]*$/i, '')
    .replace(/\s*[([].*?(feat|ft\.|remaster|version|edit|mix).*?[)\]]/i, '')
    .trim();
}

/**
 * Best-effort tempo for a song via Deezer's public catalogue (no key needed).
 * Returns 0 when unknown, unreachable, or blocked — callers fall back to
 * learning the beat from the microphone or from the user's taps.
 */
export async function lookupDeezerBpm(artist: string, title: string): Promise<number> {
  const firstArtist = artist.split(',')[0]?.trim() ?? artist;
  const t = cleanTitle(title) || title;
  const q = `artist:"${firstArtist.replace(/"/g, '')}" track:"${t.replace(/"/g, '')}"`;
  try {
    const search = await jsonp<DeezerSearch>(
      `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`,
    );
    const hits = search.data ?? [];
    if (hits.length === 0) return 0;
    // Prefer the hit whose title starts like ours; else the first.
    const want = t.toLowerCase();
    const pick = hits.find((h) => h.title.toLowerCase().startsWith(want.slice(0, 12))) ?? hits[0]!;
    const track = await jsonp<DeezerTrack>(`https://api.deezer.com/track/${pick.id}`);
    return normalizeBpm(track.bpm ?? 0);
  } catch {
    return 0;
  }
}
