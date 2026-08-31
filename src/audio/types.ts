export type SourceKind = 'mic' | 'display' | 'element';

export interface AudioEngineConfig {
  fftSize: number;
  smoothingTimeConstant: number;
  minDecibels: number;
  maxDecibels: number;
  gain: number;
}

export interface BandEmphasis {
  bass: number;
  mid: number;
  treble: number;
}

/**
 * Per-frame snapshot of the analysed audio. The `freq`/`time` arrays are shared,
 * reused buffers — read them synchronously within the frame, do not retain them.
 */
export interface AudioFrame {
  freq: Uint8Array; // byte frequency data 0..255, length = binCount
  time: Uint8Array; // byte time-domain 0..255 (128 = silence), length = fftSize
  binCount: number;
  sampleRate: number;
  bass: number; // 0..1, post-emphasis
  mid: number; // 0..1, post-emphasis
  treble: number; // 0..1, post-emphasis
  level: number; // 0..1 overall loudness (RMS)
  beat: boolean; // onset detected this frame
  beatEnergy: number; // 0..1 strength of the onset
  bpm: number; // running estimate, 0 if unknown
}
