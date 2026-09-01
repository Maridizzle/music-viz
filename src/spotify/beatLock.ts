import type { AudioFrame } from '../audio/types';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Synthesises a plausible AudioFrame from a beat grid alone — used when the phone
 * can't hear the music (headphones) but we know the track's tempo and position.
 * Beats fire on the grid, the bass pumps and decays after each one, hats tick on
 * the 8ths, and the spectrum / waveform buffers are shaped so every preset keeps
 * moving. Allocation-free per frame.
 */
export class BeatLockSynth {
  readonly frame: AudioFrame;

  private freq!: Uint8Array<ArrayBuffer>;
  private time!: Uint8Array<ArrayBuffer>;
  private shapeBass!: Float32Array;
  private shapeMid!: Float32Array;
  private shapeTreb!: Float32Array;
  private texture!: Float32Array;
  private binCount = 0;
  private fftSize = 0;
  private sampleRate = 0;

  private lastBeatIndex = -1;
  private wavePhase = 0;
  private noiseSeed = 12345;
  private bass = 0;
  private mid = 0;
  private treble = 0;
  private level = 0;
  private beatEnergy = 0;

  constructor(binCount: number, fftSize: number, sampleRate: number) {
    this.frame = {
      freq: new Uint8Array(0),
      time: new Uint8Array(0),
      binCount: 0,
      sampleRate,
      bass: 0,
      mid: 0,
      treble: 0,
      level: 0,
      beat: false,
      beatEnergy: 0,
      bpm: 0,
    };
    this.resize(binCount, fftSize, sampleRate);
  }

  resize(binCount: number, fftSize: number, sampleRate: number): void {
    if (binCount === this.binCount && fftSize === this.fftSize && sampleRate === this.sampleRate) return;
    this.binCount = binCount;
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.freq = new Uint8Array(binCount);
    this.time = new Uint8Array(fftSize);
    this.shapeBass = new Float32Array(binCount);
    this.shapeMid = new Float32Array(binCount);
    this.shapeTreb = new Float32Array(binCount);
    this.texture = new Float32Array(binCount);
    const binHz = sampleRate / 2 / binCount;
    let seed = 7;
    for (let i = 0; i < binCount; i++) {
      const hz = i * binHz;
      const g = (c: number, w: number): number => Math.exp(-((hz - c) * (hz - c)) / (w * w));
      this.shapeBass[i] = g(65, 40) + 0.55 * g(130, 60) + 0.25 * g(200, 80);
      this.shapeMid[i] = hz < 150 ? 0.35 : hz < 2600 ? 0.6 * Math.pow(320 / Math.max(hz, 320), 0.35) : 0;
      this.shapeTreb[i] = hz >= 1800 ? 0.55 * Math.pow(1800 / hz, 0.55) : 0;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      this.texture[i] = 0.62 + 0.38 * (seed / 4294967296); // stable per-bin grain
    }
    const f = this.frame;
    f.freq = this.freq;
    f.time = this.time;
    f.binCount = binCount;
    f.sampleRate = sampleRate;
    this.time.fill(128);
  }

  /** Forget the beat counter (track change / seek). */
  reset(): void {
    this.lastBeatIndex = -1;
  }

  private noise(): number {
    this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296;
  }

  /**
   * @param positionMs current playback position (ms into the track), -1 if unknown
   * @param bpm        tempo (0 = unknown → calm ambient output)
   * @param phaseMs    ms offset of beat 1 within the track
   * @param intensity  0..2 scales how hard the pulses hit
   * @param playing    false → everything settles to a quiet floor
   */
  update(positionMs: number, bpm: number, phaseMs: number, dt: number, intensity: number, playing: boolean): AudioFrame {
    const f = this.frame;
    const k = Math.max(0, Math.min(2, intensity));
    let beat = false;
    let targetBass = 0.05;
    let targetMid = 0.1;
    let targetTreble = 0.05;
    let targetLevel = 0.1;
    let downbeat = false;

    if (playing && bpm > 0 && positionMs >= 0) {
      const period = 60000 / bpm;
      const rel = positionMs - phaseMs;
      const idx = Math.floor(rel / period);
      if (idx !== this.lastBeatIndex) {
        // Increment of 1–2 → a real beat (2 covers a dropped frame). Bigger jumps
        // are seeks / first frame → just resync silently.
        if (this.lastBeatIndex !== -1 && idx > this.lastBeatIndex && idx - this.lastBeatIndex <= 2) beat = true;
        this.lastBeatIndex = idx;
      }
      const u = (rel - idx * period) / period; // 0..1 through the current beat
      downbeat = ((idx % 4) + 4) % 4 === 0;
      const accent = downbeat ? 1 : 0.82;
      const pulse = Math.exp(-u * 4.5) * accent;
      const hat = Math.exp(-((u * 2) % 1) * 7);
      const swell = 0.5 + 0.5 * Math.sin((rel / period) * (Math.PI / 2));
      targetBass = clamp01(0.16 + 0.84 * pulse * k);
      targetMid = clamp01(0.24 + 0.24 * swell + 0.28 * pulse * k);
      targetTreble = clamp01(0.12 + 0.42 * hat * k + this.noise() * 0.07);
      targetLevel = clamp01(0.3 + 0.5 * pulse * k);
    } else {
      this.lastBeatIndex = -1;
    }

    // Fast attack (on a beat, jump straight to the target), gentle release.
    const a = Math.min(1, dt * 16);
    this.bass = beat ? Math.max(this.bass, targetBass) : this.bass + (targetBass - this.bass) * a;
    this.mid += (targetMid - this.mid) * a;
    this.treble += (targetTreble - this.treble) * a;
    this.level = beat ? Math.max(this.level, targetLevel) : this.level + (targetLevel - this.level) * a;
    this.beatEnergy = beat ? (downbeat ? 1 : 0.8) : Math.max(0, this.beatEnergy - dt * 4);

    f.bass = this.bass;
    f.mid = this.mid;
    f.treble = this.treble;
    f.level = this.level;
    f.beat = beat;
    f.beatEnergy = this.beatEnergy;
    f.bpm = bpm > 0 ? Math.round(bpm) : 0;

    // Spectrum: bass hump + mid body + treble sparkle, shaped per bin.
    const freq = this.freq;
    const sb = this.shapeBass;
    const sm = this.shapeMid;
    const st = this.shapeTreb;
    const tex = this.texture;
    const b = f.bass * 1.15;
    const m = f.mid;
    const t = f.treble;
    for (let i = 0; i < this.binCount; i++) {
      let v = sb[i]! * b + sm[i]! * m + st[i]! * t * (0.7 + 0.6 * this.noise());
      v *= tex[i]!;
      v = v * 242;
      freq[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }

    // Waveform: a low tone with a couple of harmonics plus treble grit, continuous
    // across frames so scope-style presets draw a steady, living trace.
    const time = this.time;
    const amp = 0.9 * f.level;
    const step = (2 * Math.PI * 55) / this.sampleRate;
    const grit = f.treble * 0.08;
    let ph = this.wavePhase;
    for (let j = 0; j < this.fftSize; j++) {
      ph += step;
      const v =
        amp * (0.72 * Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.5) + 0.12 * Math.sin(3.01 * ph)) +
        grit * (this.noise() - 0.5);
      const c = v < -1 ? -1 : v > 1 ? 1 : v;
      time[j] = 128 + c * 127;
    }
    this.wavePhase = ph % (2 * Math.PI);

    return f;
  }
}
