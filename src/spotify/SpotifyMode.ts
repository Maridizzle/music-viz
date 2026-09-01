import type { AudioFrame } from '../audio/types';
import { extractAlbumPalette } from './albumPalette';
import { SpotifyAuth } from './auth';
import { BeatLockSynth } from './beatLock';
import { SpotifyClient } from './client';
import { BeatLearner } from './learn';
import { NowPlayingTracker } from './nowPlaying';
import { getRedirectUri, openAuth } from './platform';
import { lookupDeezerBpm, normalizeBpm, TempoStore } from './tempo';
import type { SpotifyModeState, SpotifyTrack, TempoInfo } from './types';

/** Raw (pre-auto-gain) mic RMS below which we consider the phone to hear nothing. */
const SILENT_RMS = 0.008;
/** …and above which it clearly hears music again. */
const LOUD_RMS = 0.02;
const SILENT_HOLD_MS = 2000;

export interface SpotifyModeSettings {
  albumColors: boolean;
  beatLock: boolean;
  beatIntensity: number;
}

export interface SpotifyModeHooks {
  getClientId: () => string;
  /** Connect the microphone (App owns the engine). Rejects if unavailable. */
  connectMic: () => Promise<void>;
  onPalette: (colors: string[] | null) => void;
  onTrack: (track: SpotifyTrack | null, tempo: TempoInfo | null) => void;
  onStatus: (state: SpotifyModeState, detail: string) => void;
  /** Spotify itself failed (auth dead, 403, network) — fatal means the login is gone. */
  onError: (message: string, fatal: boolean) => void;
  toast: (message: string, isError?: boolean) => void;
  /** Analyser geometry, so the synthetic frame matches the engine's buffers. */
  engineInfo: () => { binCount: number; fftSize: number; sampleRate: number };
}

/**
 * "Spotify mode": knows what's playing (Web API), reacts through the microphone
 * whenever it can hear the music, and when it can't (headphones) falls back to a
 * beat-locked synthetic signal on the track's beat grid. Also recolours the
 * visuals from the album art.
 */
export class SpotifyMode {
  readonly auth: SpotifyAuth;
  settings: SpotifyModeSettings = { albumColors: true, beatLock: true, beatIntensity: 1 };

  private readonly client: SpotifyClient;
  private readonly tracker: NowPlayingTracker;
  private readonly tempoStore = new TempoStore();
  private readonly synth: BeatLockSynth;
  private readonly learner = new BeatLearner();
  private readonly out: AudioFrame;

  private active = false;
  private micOk = false;
  private blend = 0; // 0 = engine (mic) frame, 1 = synthetic beat-lock frame
  private silentMs = 0;
  private loudMs = 0;
  private learnCheckMs = 0;
  private lastState: SpotifyModeState = 'off';
  private lastDetail = '';
  private track: SpotifyTrack | null = null;
  private tempo: TempoInfo | null = null;
  private taps: number[] = [];
  private lookupToken = 0;

  constructor(private readonly hooks: SpotifyModeHooks) {
    this.auth = new SpotifyAuth(hooks.getClientId, getRedirectUri);
    this.client = new SpotifyClient(this.auth);
    this.tracker = new NowPlayingTracker(this.client);
    const info = hooks.engineInfo();
    this.synth = new BeatLockSynth(info.binCount, info.fftSize, info.sampleRate);
    this.out = { ...this.synth.frame };

    this.tracker.onTrackChange = (track) => this.onTrackChange(track);
    this.tracker.onState = () => this.publishStatus();
    this.tracker.onError = (message, fatal) => {
      if (fatal) this.stop();
      hooks.onError(message, fatal);
    };
  }

  // ---- lifecycle ----

  get isActive(): boolean {
    return this.active;
  }

  get state(): SpotifyModeState {
    return this.lastState;
  }

  get currentTrack(): SpotifyTrack | null {
    return this.track;
  }

  get currentTempo(): TempoInfo | null {
    return this.tempo;
  }

  isConnected(): boolean {
    return this.auth.isConnected();
  }

  /** Start the login round-trip. On the web this navigates away; native shells return here later. */
  async login(): Promise<void> {
    await this.auth.beginLogin(openAuth);
  }

  async completeLogin(url: string): Promise<void> {
    await this.auth.completeLogin(url);
  }

  logout(): void {
    this.stop();
    this.auth.logout();
  }

  /** Begin: connect the mic (best effort) and start polling Spotify. */
  async start(): Promise<void> {
    if (!this.auth.isConnected()) throw new Error('Not connected to Spotify.');
    this.active = true;
    this.blend = 0;
    this.silentMs = 0;
    this.loudMs = 0;
    this.micOk = false;
    try {
      await this.hooks.connectMic();
      this.micOk = true;
    } catch {
      this.hooks.toast('Microphone unavailable — using beat-lock only.', true);
    }
    this.tracker.start();
    this.publishStatus(true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.tracker.stop();
    this.track = null;
    this.tempo = null;
    this.learner.reset();
    this.synth.reset();
    this.hooks.onPalette(null);
    this.setState('off', '');
    this.hooks.onTrack(null, null);
  }

  /** Re-apply (or clear) the album-art palette after the setting changed. */
  refreshPalette(): void {
    if (!this.active) return;
    if (!this.settings.albumColors || !this.track?.artUrl) {
      this.hooks.onPalette(null);
      return;
    }
    const token = this.lookupToken;
    void extractAlbumPalette(this.track.artUrl).then((colors) => {
      if (token !== this.lookupToken || !this.active || !this.settings.albumColors) return;
      this.hooks.onPalette(colors);
    });
  }

  /** The mic stream ended (device change). Try once to get it back; else continue synth-only. */
  async recoverMic(): Promise<void> {
    if (!this.active) return;
    this.micOk = false;
    try {
      await this.hooks.connectMic();
      this.micOk = true;
    } catch {
      this.hooks.toast('Microphone lost — using beat-lock only.', true);
    }
  }

  // ---- per frame ----

  /**
   * Given the engine's frame (mic) and its raw RMS, return the frame to render:
   * the mic frame, the synthetic beat-lock frame, or a crossfade between them.
   */
  process(engineFrame: AudioFrame, rawLevel: number, dt: number): AudioFrame {
    if (!this.active) return engineFrame;
    const st = this.tracker.current;
    const playing = !!st?.isPlaying && !!st.track;
    const pos = this.tracker.positionMs();
    const ms = dt * 1000;

    // Silence hysteresis: 2 s without any real signal → "can't hear it"; any frame
    // clearly above the floor (LOUD) starts the clock over. Frames in between
    // (quiet passages) neither count as silence nor reset it.
    if (this.micOk) {
      if (rawLevel > LOUD_RMS) {
        this.loudMs += ms;
        this.silentMs = 0;
      } else if (rawLevel < SILENT_RMS) {
        this.silentMs += ms;
        this.loudMs = 0;
      }
    } else {
      this.silentMs = SILENT_HOLD_MS;
    }
    const hearing = this.micOk && this.silentMs < SILENT_HOLD_MS;
    const canLock = this.settings.beatLock && playing && !!this.tempo && this.tempo.bpm > 0;
    const target = !hearing && canLock ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt * 4);
    if (Math.abs(target - this.blend) < 0.01) this.blend = target;

    // Learn the grid from real beats while the song is audible.
    if (hearing && playing && pos >= 0 && engineFrame.beat) this.learner.onBeat(pos);
    this.learnCheckMs += ms;
    if (this.learnCheckMs > 4000) {
      this.learnCheckMs = 0;
      this.maybeAdoptLearned();
    }

    const state: SpotifyModeState = !st?.track ? 'idle' : !playing ? 'paused' : this.blend > 0.5 ? 'beatlock' : 'listening';
    this.setState(state, this.describe(state, hearing));

    if (this.blend <= 0) return engineFrame;
    const info = this.hooks.engineInfo();
    this.synth.resize(info.binCount, info.fftSize, info.sampleRate);
    const synth = this.synth.update(
      pos,
      this.tempo?.bpm ?? 0,
      this.tempo?.phaseMs ?? 0,
      dt,
      this.settings.beatIntensity,
      playing,
    );
    if (this.blend >= 1) return synth;

    const x = this.blend;
    const a = engineFrame;
    const b = synth;
    const o = this.out;
    const useB = x >= 0.5;
    o.freq = useB ? b.freq : a.freq;
    o.time = useB ? b.time : a.time;
    o.binCount = useB ? b.binCount : a.binCount;
    o.sampleRate = a.sampleRate;
    o.bass = a.bass + (b.bass - a.bass) * x;
    o.mid = a.mid + (b.mid - a.mid) * x;
    o.treble = a.treble + (b.treble - a.treble) * x;
    o.level = a.level + (b.level - a.level) * x;
    o.beat = useB ? b.beat : a.beat;
    o.beatEnergy = a.beatEnergy + (b.beatEnergy - a.beatEnergy) * x;
    o.bpm = useB ? b.bpm : a.bpm;
    return o;
  }

  // ---- beat sync from the user ----

  /** Tap along with the music: sets the grid's phase (and the tempo, if unknown). */
  tapBeat(): void {
    const pos = this.tracker.positionMs();
    if (pos < 0) {
      this.hooks.toast('Nothing is playing on Spotify.');
      return;
    }
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && (pos - last > 3000 || pos < last)) this.taps.length = 0;
    this.taps.push(pos);
    if (this.taps.length > 8) this.taps.shift();

    if (this.tempo && this.tempo.bpm > 0) {
      const period = 60000 / this.tempo.bpm;
      let cx = 0;
      let cy = 0;
      for (const t of this.taps) {
        const ang = ((t % period) / period) * Math.PI * 2;
        cx += Math.cos(ang);
        cy += Math.sin(ang);
      }
      let phase = (Math.atan2(cy, cx) / (Math.PI * 2)) * period;
      if (phase < 0) phase += period;
      this.setTempo({ ...this.tempo, phaseMs: phase, source: 'tap', at: Date.now() });
      this.hooks.toast(this.taps.length === 1 ? 'Beat nudged to your tap' : 'Beat synced to your taps');
      return;
    }
    if (this.taps.length < 4) {
      this.hooks.toast(`Keep tapping the beat… ${4 - this.taps.length} more`);
      return;
    }
    const iv: number[] = [];
    for (let i = 1; i < this.taps.length; i++) iv.push(this.taps[i]! - this.taps[i - 1]!);
    iv.sort((a, b) => a - b);
    const bpm = normalizeBpm(60000 / iv[Math.floor(iv.length / 2)]!);
    if (bpm <= 0) return;
    const period = 60000 / bpm;
    this.setTempo({ bpm, phaseMs: last === undefined ? 0 : pos % period, source: 'tap', at: Date.now() });
    this.hooks.toast(`Tempo set from your taps: ${Math.round(bpm)} BPM`);
  }

  // ---- internals ----

  private onTrackChange(track: SpotifyTrack | null): void {
    this.track = track;
    this.learner.reset();
    this.synth.reset();
    this.taps.length = 0;
    const token = ++this.lookupToken;
    this.tempo = track ? this.tempoStore.get(track.id) : null;
    this.hooks.onTrack(track, this.tempo);

    if (!track) {
      this.hooks.onPalette(null);
      return;
    }

    if (this.settings.albumColors && track.artUrl) {
      void extractAlbumPalette(track.artUrl).then((colors) => {
        if (token !== this.lookupToken || !this.active) return;
        this.hooks.onPalette(this.settings.albumColors ? colors : null);
      });
    } else {
      this.hooks.onPalette(null);
    }

    if (!this.tempo && !track.isEpisode) {
      void lookupDeezerBpm(track.artists, track.name).then((bpm) => {
        if (token !== this.lookupToken || !this.active || this.tempo) return;
        if (bpm > 0) this.setTempo({ bpm, phaseMs: 0, source: 'deezer', at: Date.now() });
      });
    }
  }

  private maybeAdoptLearned(): void {
    if (!this.track) return;
    const learned = this.learner.estimate();
    if (!learned) return;
    // A learned grid beats a catalogue tempo (it has the real phase) but never a
    // deliberate tap sync by the user.
    if (this.tempo?.source === 'tap') return;
    if (this.tempo?.source === 'learned' && Math.abs(this.tempo.bpm - learned.bpm) < 0.5) {
      // Same tempo: refine the phase quietly.
      this.setTempo({ ...learned, at: Date.now() }, true);
      return;
    }
    this.setTempo(learned);
    this.hooks.toast(`Learned the beat: ${Math.round(learned.bpm)} BPM`);
  }

  private setTempo(tempo: TempoInfo, quiet = false): void {
    this.tempo = tempo;
    if (this.track) this.tempoStore.set(this.track.id, tempo);
    this.synth.reset();
    if (!quiet) this.hooks.onTrack(this.track, tempo);
    this.publishStatus(true);
  }

  private describe(state: SpotifyModeState, hearing: boolean): string {
    switch (state) {
      case 'idle':
        return 'Play something on Spotify';
      case 'paused':
        return 'Paused';
      case 'beatlock':
        return `Beat-locked · ${Math.round(this.tempo?.bpm ?? 0)} BPM`;
      case 'listening':
        if (!hearing && this.micOk) {
          return this.settings.beatLock ? "Can't hear it — tap the beat to sync" : 'Listening (silent)';
        }
        return this.tempo ? `Listening · ${Math.round(this.tempo.bpm)} BPM` : 'Listening';
      default:
        return '';
    }
  }

  private publishStatus(force = false): void {
    if (!this.active) return;
    const st = this.tracker.current;
    const playing = !!st?.isPlaying && !!st.track;
    const state: SpotifyModeState = !st?.track ? 'idle' : !playing ? 'paused' : this.blend > 0.5 ? 'beatlock' : 'listening';
    const detail = this.describe(state, this.micOk && this.silentMs < SILENT_HOLD_MS);
    if (force) this.lastDetail = '';
    this.setState(state, detail);
  }

  private setState(state: SpotifyModeState, detail: string): void {
    if (state === this.lastState && detail === this.lastDetail) return;
    this.lastState = state;
    this.lastDetail = detail;
    this.hooks.onStatus(state, detail);
  }
}
