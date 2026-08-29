export interface BeatResult {
  beat: boolean;
  energy: number; // 0..1 overshoot above threshold
  bpm: number;
}

/**
 * Adaptive energy-based onset detector. A beat fires when the instantaneous
 * energy exceeds a running (mean + sensitivity * stddev) threshold, gated by a
 * short refractory window. Accepted inter-onset intervals give a median BPM.
 */
export class BeatDetector {
  sensitivity = 1.4;

  private history: number[] = [];
  private readonly historySize = 43; // ~1s at 60fps
  private lastBeatMs = 0;
  private readonly refractoryMs = 180; // max ~333 BPM
  private intervals: number[] = [];
  private readonly maxIntervals = 12;

  update(energy: number, nowMs: number): BeatResult {
    const h = this.history;

    let mean = 0;
    for (let i = 0; i < h.length; i++) mean += h[i]!;
    mean = h.length ? mean / h.length : 0;

    let variance = 0;
    for (let i = 0; i < h.length; i++) {
      const d = h[i]! - mean;
      variance += d * d;
    }
    const std = h.length ? Math.sqrt(variance / h.length) : 0;

    const threshold = mean + this.sensitivity * std;
    let beat = false;
    let overshoot = 0;

    if (
      h.length >= this.historySize &&
      energy > threshold &&
      energy > 0.02 &&
      nowMs - this.lastBeatMs > this.refractoryMs
    ) {
      beat = true;
      overshoot = std > 1e-4 ? Math.min(1, (energy - threshold) / (std * 2)) : 1;
      if (this.lastBeatMs > 0) {
        const interval = nowMs - this.lastBeatMs;
        if (interval > 250 && interval < 2000) {
          // 30..240 BPM
          this.intervals.push(interval);
          if (this.intervals.length > this.maxIntervals) this.intervals.shift();
        }
      }
      this.lastBeatMs = nowMs;
    }

    h.push(energy);
    if (h.length > this.historySize) h.shift();

    return { beat, energy: overshoot, bpm: this.estimateBpm() };
  }

  private estimateBpm(): number {
    if (this.intervals.length < 3) return 0;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    return median > 0 ? Math.round(60000 / median) : 0;
  }

  reset(): void {
    this.history.length = 0;
    this.intervals.length = 0;
    this.lastBeatMs = 0;
  }
}
