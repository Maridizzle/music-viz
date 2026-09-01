import { SpotifyAuthError } from './auth';
import { SpotifyApiError, SpotifyRateLimit, type SpotifyClient } from './client';
import type { PlaybackState, SpotifyTrack } from './types';

const POLL_PLAYING_MS = 1500;
const POLL_IDLE_MS = 4000;
const ERROR_BACKOFF_MIN_MS = 5000;
const ERROR_BACKOFF_MAX_MS = 60000;
const SNAP_THRESHOLD_MS = 400; // a bigger jump than this is a seek → snap, else slew

/**
 * Polls "currently playing" and keeps a smooth, continuously-advancing estimate
 * of the playback position between polls (Spotify only reports progress on each
 * request). Small drifts are corrected gradually so the beat grid never hiccups.
 */
export class NowPlayingTracker {
  onState: ((state: PlaybackState) => void) | null = null;
  onTrackChange: ((track: SpotifyTrack | null) => void) | null = null;
  onError: ((message: string, fatal: boolean) => void) | null = null;

  private state: PlaybackState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private errorBackoff = ERROR_BACKOFF_MIN_MS;

  // Position anchor: position was `anchorPos` at local time `anchorTime`.
  private anchorPos = 0;
  private anchorTime = 0;

  constructor(private readonly client: SpotifyClient) {
    document.addEventListener('visibilitychange', () => {
      if (!this.running) return;
      if (document.hidden) this.clearTimer();
      else void this.poll();
    });
  }

  get current(): PlaybackState | null {
    return this.state;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.state = null;
  }

  /** Estimated playback position in ms, or -1 when unknown. */
  positionMs(now = performance.now()): number {
    const s = this.state;
    if (!s?.track) return -1;
    const pos = s.isPlaying ? this.anchorPos + (now - this.anchorTime) : this.anchorPos;
    return Math.max(0, Math.min(s.track.durationMs || Infinity, pos));
  }

  /** Force a refresh soon (e.g. after the user tapped play elsewhere). */
  refreshSoon(): void {
    if (!this.running) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.poll(), 300);
  }

  private async poll(): Promise<void> {
    if (!this.running || this.inFlight || document.hidden) return;
    this.inFlight = true;
    this.clearTimer();
    let delay = POLL_IDLE_MS;
    try {
      const next = await this.client.fetchPlayback();
      this.errorBackoff = ERROR_BACKOFF_MIN_MS;
      this.integrate(next);
      delay = next.isPlaying ? POLL_PLAYING_MS : POLL_IDLE_MS;
    } catch (e) {
      if (e instanceof SpotifyRateLimit) {
        delay = e.retryAfterMs;
      } else {
        const fatal = e instanceof SpotifyAuthError && e.fatal;
        const message = e instanceof Error ? e.message : 'Spotify request failed.';
        this.onError?.(message, fatal || (e instanceof SpotifyApiError && e.status === 403));
        if (fatal) {
          this.running = false;
          this.inFlight = false;
          return;
        }
        delay = this.errorBackoff;
        this.errorBackoff = Math.min(ERROR_BACKOFF_MAX_MS, this.errorBackoff * 2);
      }
    } finally {
      this.inFlight = false;
    }
    if (this.running) this.timer = setTimeout(() => void this.poll(), delay);
  }

  private integrate(next: PlaybackState): void {
    const prev = this.state;
    const now = next.fetchedAt;
    const trackChanged = (prev?.track?.id ?? null) !== (next.track?.id ?? null);

    if (!next.track) {
      this.anchorPos = 0;
      this.anchorTime = now;
    } else if (trackChanged || !prev?.isPlaying || !next.isPlaying) {
      this.anchorPos = next.progressMs;
      this.anchorTime = now;
    } else {
      const estimated = this.anchorPos + (now - this.anchorTime);
      const diff = next.progressMs - estimated;
      if (Math.abs(diff) > SNAP_THRESHOLD_MS) {
        this.anchorPos = next.progressMs; // seek
      } else {
        this.anchorPos = estimated + diff * 0.35; // slew toward the reported position
      }
      this.anchorTime = now;
    }

    this.state = next;
    if (trackChanged) this.onTrackChange?.(next.track);
    this.onState?.(next);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
