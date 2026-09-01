export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string; // "A, B"
  album: string;
  artUrl: string | null; // ~300px cover
  durationMs: number;
  isEpisode: boolean; // podcast episode (no tempo lookup)
}

/** One poll of Spotify's "currently playing" endpoint. */
export interface PlaybackState {
  track: SpotifyTrack | null;
  isPlaying: boolean;
  progressMs: number; // position as reported by Spotify
  fetchedAt: number; // performance.now() when the poll returned
}

export type TempoSource = 'deezer' | 'learned' | 'tap';

/** Beat grid for a track: beats fall at phaseMs + k * 60000 / bpm. */
export interface TempoInfo {
  bpm: number;
  phaseMs: number;
  source: TempoSource;
  at: number; // Date.now()
}

/**
 * off       — Spotify mode not running
 * idle      — connected, nothing playing / no track
 * paused    — track known but playback paused
 * listening — reacting to the microphone
 * beatlock  — mic hears nothing (headphones); pulsing on the known beat grid
 */
export type SpotifyModeState = 'off' | 'idle' | 'paused' | 'listening' | 'beatlock';
