import { averageBand, hzToBin, rmsLevel } from './analysis';
import { BeatDetector } from './BeatDetector';
import type { AudioEngineConfig, AudioFrame, BandEmphasis, SourceKind } from './types';

const DEFAULT_CONFIG: AudioEngineConfig = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  minDecibels: -90,
  maxDecibels: -20,
  gain: 1,
};

export class UnsupportedSourceError extends Error {}
export class NoAudioTrackError extends Error {}
export class InsecureContextError extends Error {}

interface BandBins {
  bassStart: number;
  bassEnd: number;
  midStart: number;
  midEnd: number;
  trebStart: number;
  trebEnd: number;
}

/**
 * Owns the Web Audio graph. One AnalyserNode is fed by a swappable input:
 *
 *   [source] -> inputGain -> analyser            (analyser is a dead-end tap)
 *                        \-> destination         (element sources only, so audio is audible)
 *
 * Mic and display sources are never routed to the destination (feedback / double audio).
 */
export class AudioEngine {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;

  private readonly inputGain: GainNode;
  private input: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private el: HTMLAudioElement | null = null;
  private elSource: MediaElementAudioSourceNode | null = null;
  private objectUrl: string | null = null;
  private monitoring = false;
  private current: SourceKind | null = null;

  private freq: Uint8Array<ArrayBuffer>;
  private time: Uint8Array<ArrayBuffer>;
  private bins: BandBins;
  private readonly beatDetector = new BeatDetector();
  private readonly frame: AudioFrame;

  emphasis: BandEmphasis = { bass: 1, mid: 1, treble: 1 };

  /** Called when the active source ends on its own (display share stopped, track ended, media finished). */
  onEnded: ((kind: SourceKind) => void) | null = null;

  constructor(cfg: Partial<AudioEngineConfig> = {}) {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new UnsupportedSourceError('Web Audio API is not supported in this browser.');

    this.context = new Ctor();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = c.fftSize;
    this.analyser.smoothingTimeConstant = c.smoothingTimeConstant;
    this.analyser.minDecibels = c.minDecibels;
    this.analyser.maxDecibels = c.maxDecibels;

    this.inputGain = this.context.createGain();
    this.inputGain.gain.value = c.gain;
    this.inputGain.connect(this.analyser);

    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    this.bins = this.computeBins();
    this.frame = {
      freq: this.freq,
      time: this.time,
      binCount: this.freq.length,
      sampleRate: this.context.sampleRate,
      bass: 0,
      mid: 0,
      treble: 0,
      level: 0,
      beat: false,
      beatEnergy: 0,
      bpm: 0,
    };
  }

  get state(): AudioContextState {
    return this.context.state;
  }

  getCurrentSource(): SourceKind | null {
    return this.current;
  }

  get element(): HTMLAudioElement | null {
    return this.el;
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  // ---- live-tunable config ----

  setFftSize(n: number): void {
    if (n === this.analyser.fftSize) return;
    this.analyser.fftSize = n;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    this.frame.freq = this.freq;
    this.frame.time = this.time;
    this.frame.binCount = this.freq.length;
    this.bins = this.computeBins();
  }

  setSmoothing(v: number): void {
    this.analyser.smoothingTimeConstant = Math.max(0, Math.min(0.99, v));
  }

  setGain(v: number): void {
    this.inputGain.gain.value = Math.max(0, v);
  }

  setDecibelRange(min: number, max: number): void {
    this.analyser.minDecibels = min;
    this.analyser.maxDecibels = max;
  }

  setBeatSensitivity(v: number): void {
    this.beatDetector.sensitivity = v;
  }

  // ---- sources ----

  async useMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new UnsupportedSourceError('Microphone capture is not available in this browser.');
    }
    if (!window.isSecureContext) {
      throw new InsecureContextError('Microphone access requires a secure (https) connection.');
    }
    await this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.teardownCurrent();
    this.stream = stream;
    this.attachStream(stream, 'mic');
  }

  async useDisplayAudio(): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new UnsupportedSourceError(
        'Capturing tab / system audio is only supported on desktop Chrome or Edge.',
      );
    }
    if (!window.isSecureContext) {
      throw new InsecureContextError('Screen/tab audio capture requires a secure (https) connection.');
    }
    await this.resume();
    // Chromium only offers "Share audio" when video is requested; drop the video track after.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new NoAudioTrackError(
        'No audio was shared. Re-try and tick "Share tab audio" / "Share system audio".',
      );
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    const audioOnly = new MediaStream(audioTracks);
    this.teardownCurrent();
    this.stream = audioOnly;
    this.attachStream(audioOnly, 'display');
    audioTracks[0]!.addEventListener('ended', () => this.onEnded?.('display'));
  }

  async useFile(file: File): Promise<HTMLAudioElement> {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    return this.attachElementSrc(this.objectUrl);
  }

  async useUrl(url: string): Promise<HTMLAudioElement> {
    if (!/^https:\/\//i.test(url) && window.location.protocol === 'https:') {
      throw new UnsupportedSourceError('Stream URL must start with https:// (mixed content is blocked).');
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    return this.attachElementSrc(url);
  }

  /** True once the analyser has been reading a non-zero signal recently. */
  private silentFrames = 0;

  // Adaptive auto-gain: normalise each metric against its own recent peak so the
  // visuals use the full 0..1 range and track the music's dynamics on any source.
  private peaks = { level: 0.05, bass: 0.05, mid: 0.05, treble: 0.05 };
  private agcTime = 0;

  private normalize(key: 'level' | 'bass' | 'mid' | 'treble', raw: number, dt: number): number {
    const NOISE = 0.015;
    const MIN_PEAK = 0.045;
    const DECAY = 1.1; // adapts quickly so quiet-after-loud still swings the full range
    let p = this.peaks[key];
    p = Math.max(raw, p - p * DECAY * dt, MIN_PEAK);
    this.peaks[key] = p;
    let n = (raw - NOISE) / Math.max(0.01, p - NOISE);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    // "punch" curve: lifts moderate signal so the visuals spend more time reacting
    return Math.pow(n, 0.6);
  }

  /** Read the analyser and derive metrics for this frame. Allocation-free. */
  update(): AudioFrame {
    const nowMs = performance.now();
    const dt = this.agcTime ? Math.min(0.1, (nowMs - this.agcTime) / 1000) : 0.016;
    this.agcTime = nowMs;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    const b = this.bins;
    const bassRaw = averageBand(this.freq, b.bassStart, b.bassEnd);
    const midRaw = averageBand(this.freq, b.midStart, b.midEnd);
    const trebRaw = averageBand(this.freq, b.trebStart, b.trebEnd);
    const levelRaw = rmsLevel(this.time);

    const f = this.frame;
    f.bass = Math.min(1, this.normalize('bass', bassRaw, dt) * this.emphasis.bass);
    f.mid = Math.min(1, this.normalize('mid', midRaw, dt) * this.emphasis.mid);
    f.treble = Math.min(1, this.normalize('treble', trebRaw, dt) * this.emphasis.treble);
    f.level = this.normalize('level', levelRaw, dt);

    const beatInput = bassRaw * 0.7 + midRaw * 0.3;
    const beat = this.beatDetector.update(beatInput, nowMs);
    f.beat = beat.beat;
    // every detected beat delivers a strong pulse so beat-driven effects really hit
    f.beatEnergy = beat.beat ? Math.max(0.65, beat.energy) : beat.energy;
    f.bpm = beat.bpm;

    if (bassRaw + midRaw + trebRaw < 0.001) this.silentFrames++;
    else this.silentFrames = 0;

    return f;
  }

  /** Heuristic: element source is playing but analyser reads all zeros → likely a CORS-blocked stream. */
  isProbablyCorsBlocked(): boolean {
    return this.current === 'element' && !!this.el && !this.el.paused && this.silentFrames > 90;
  }

  dispose(): void {
    this.teardownCurrent();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.context.close();
  }

  // ---- internals ----

  private computeBins(): BandBins {
    const sr = this.context.sampleRate;
    const n = this.analyser.fftSize;
    return {
      bassStart: hzToBin(20, sr, n),
      bassEnd: hzToBin(250, sr, n),
      midStart: hzToBin(250, sr, n),
      midEnd: hzToBin(2000, sr, n),
      trebStart: hzToBin(2000, sr, n),
      trebEnd: hzToBin(16000, sr, n),
    };
  }

  private attachStream(stream: MediaStream, kind: SourceKind): void {
    const src = this.context.createMediaStreamSource(stream);
    this.input = src;
    src.connect(this.inputGain);
    this.setMonitoring(false);
    this.current = kind;
    this.beatDetector.reset();
    this.silentFrames = 0;
  }

  private ensureElement(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio();
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'auto';
      this.el.addEventListener('ended', () => this.onEnded?.('element'));
    }
    if (!this.elSource) {
      // createMediaElementSource can only be called once per element.
      this.elSource = this.context.createMediaElementSource(this.el);
    }
    return this.el;
  }

  private async attachElementSrc(src: string): Promise<HTMLAudioElement> {
    const el = this.ensureElement();
    await this.resume();
    this.teardownCurrent();
    el.crossOrigin = 'anonymous'; // required for AnalyserNode to receive non-zero data on remote streams
    el.src = src;
    el.load();
    this.input = this.elSource;
    this.elSource!.connect(this.inputGain);
    this.setMonitoring(true);
    this.current = 'element';
    this.beatDetector.reset();
    this.silentFrames = 0;
    await el.play();
    return el;
  }

  private setMonitoring(on: boolean): void {
    if (on === this.monitoring) return;
    if (on) {
      this.inputGain.connect(this.context.destination);
    } else {
      try {
        this.inputGain.disconnect(this.context.destination);
      } catch {
        /* was not connected */
      }
    }
    this.monitoring = on;
  }

  private teardownCurrent(): void {
    if (this.input) {
      try {
        this.input.disconnect();
      } catch {
        /* ignore */
      }
      this.input = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.el && this.current === 'element') this.el.pause();
    this.setMonitoring(false);
    this.current = null;
  }
}
