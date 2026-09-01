import { normalizeBpm } from './tempo';
import type { TempoInfo } from './types';

const MIN_BEATS = 24;
const MIN_INTERVALS = 14;
const MAX_BEATS = 240;

/**
 * Learns a track's beat grid from beats the microphone actually detected while
 * the song was audible: tempo from the inter-beat intervals, phase from where
 * within a period the beats cluster. Once learned, the grid replays perfectly
 * the next time the song plays on headphones.
 */
export class BeatLearner {
  private beats: number[] = []; // track positions (ms) of detected beats

  reset(): void {
    this.beats.length = 0;
  }

  get count(): number {
    return this.beats.length;
  }

  onBeat(positionMs: number): void {
    const last = this.beats[this.beats.length - 1];
    if (last !== undefined) {
      if (positionMs < last) this.beats.length = 0; // seeked backwards → start over
      else if (positionMs - last < 200) return; // too close: a double trigger
    }
    this.beats.push(positionMs);
    if (this.beats.length > MAX_BEATS) this.beats.shift();
  }

  /** A confident grid estimate, or null while there isn't enough consistent evidence yet. */
  estimate(): TempoInfo | null {
    const b = this.beats;
    if (b.length < MIN_BEATS) return null;

    const intervals: number[] = [];
    for (let i = 1; i < b.length; i++) {
      const d = b[i]! - b[i - 1]!;
      if (d >= 250 && d <= 2000) intervals.push(d);
    }
    if (intervals.length < MIN_INTERVALS) return null;

    const sorted = [...intervals].sort((x, y) => x - y);
    let period = sorted[Math.floor(sorted.length / 2)]!;

    // Fold intervals onto the median's octave (a missed beat gives 2×period) and refine.
    let sum = 0;
    let n = 0;
    for (const d of intervals) {
      const r = d / period;
      const k = Math.round(r);
      if (k >= 1 && k <= 4 && Math.abs(r - k) < 0.12) {
        sum += d / k;
        n++;
      }
    }
    if (n < MIN_INTERVALS * 0.7) return null;
    period = sum / n;

    // Phase: circular mean of (beat position mod period). A tight cluster → confident.
    let cx = 0;
    let cy = 0;
    for (const p of b) {
      const ang = ((p % period) / period) * Math.PI * 2;
      cx += Math.cos(ang);
      cy += Math.sin(ang);
    }
    const concentration = Math.sqrt(cx * cx + cy * cy) / b.length;
    if (concentration < 0.55) return null;
    let phase = (Math.atan2(cy, cx) / (Math.PI * 2)) * period;
    if (phase < 0) phase += period;

    const bpm = normalizeBpm(60000 / period);
    if (bpm <= 0) return null;
    const finalPeriod = 60000 / bpm;
    return { bpm, phaseMs: phase % finalPeriod, source: 'learned', at: Date.now() };
  }
}
