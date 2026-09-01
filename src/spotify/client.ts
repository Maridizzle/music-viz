import type { SpotifyAuth } from './auth';
import type { PlaybackState, SpotifyTrack } from './types';

const NOW_PLAYING_URL =
  'https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode';

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Spotify asked us to back off (HTTP 429). */
export class SpotifyRateLimit extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Spotify rate limit');
  }
}

interface ApiImage {
  url: string;
  width: number | null;
  height: number | null;
}

interface ApiItem {
  id: string;
  name: string;
  type?: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name: string; images?: ApiImage[] };
  show?: { name: string };
  images?: ApiImage[];
}

interface ApiPlayback {
  item: ApiItem | null;
  is_playing: boolean;
  progress_ms: number | null;
  currently_playing_type?: string;
}

/** Prefer the ~300px cover: big enough for colour sampling, small to download. */
function pickArt(images: ApiImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const mid = sorted.find((i) => (i.width ?? 0) >= 200) ?? sorted[sorted.length - 1];
  return mid?.url ?? null;
}

function parseTrack(item: ApiItem, type: string | undefined): SpotifyTrack | null {
  if (type === 'ad') return null;
  const isEpisode = type === 'episode' || item.type === 'episode';
  return {
    id: item.id,
    name: item.name,
    artists: isEpisode
      ? (item.show?.name ?? 'Podcast')
      : (item.artists?.map((a) => a.name).join(', ') ?? ''),
    album: item.album?.name ?? '',
    artUrl: pickArt(isEpisode ? item.images : item.album?.images),
    durationMs: item.duration_ms ?? 0,
    isEpisode,
  };
}

/** Thin wrapper over the one endpoint we need: what is playing right now. */
export class SpotifyClient {
  constructor(private readonly auth: SpotifyAuth) {}

  /** Current playback. `track` is null when nothing is playing (or an ad is). */
  async fetchPlayback(): Promise<PlaybackState> {
    let token = await this.auth.getAccessToken();
    let res = await this.get(token);
    if (res.status === 401) {
      token = await this.auth.getAccessToken(true);
      res = await this.get(token);
    }
    const fetchedAt = performance.now();
    if (res.status === 204) return { track: null, isPlaying: false, progressMs: 0, fetchedAt };
    if (res.status === 429) {
      const after = Number(res.headers.get('Retry-After') ?? '5');
      throw new SpotifyRateLimit(Math.max(1, Number.isFinite(after) ? after : 5) * 1000);
    }
    if (res.status === 403) {
      throw new SpotifyApiError(
        "Spotify refused (403). While the app is in Development Mode, each Spotify account must be added under the app's User Management in the Developer Dashboard.",
        403,
      );
    }
    if (!res.ok) throw new SpotifyApiError(`Spotify API error ${res.status}`, res.status);

    const j = (await res.json()) as ApiPlayback;
    const track = j.item ? parseTrack(j.item, j.currently_playing_type) : null;
    return {
      track,
      isPlaying: !!j.is_playing && !!track,
      progressMs: j.progress_ms ?? 0,
      fetchedAt,
    };
  }

  private async get(token: string): Promise<Response> {
    try {
      return await fetch(NOW_PLAYING_URL, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new SpotifyApiError('Could not reach Spotify (network).', 0);
    }
  }
}
