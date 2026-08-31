/** Map a frequency in Hz to its bin index for the given fftSize. */
export function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;
  const bin = Math.round((hz / nyquist) * binCount);
  return Math.max(0, Math.min(binCount - 1, bin));
}

/** Average a byte range of the frequency data, normalised to 0..1. */
export function averageBand(freq: Uint8Array, startBin: number, endBin: number): number {
  const lo = Math.max(0, Math.min(startBin, endBin));
  const hi = Math.min(freq.length - 1, Math.max(startBin, endBin));
  if (hi < lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += freq[i]!;
  return sum / (hi - lo + 1) / 255;
}

/** Map t in [0,1] to a log-spaced frequency bin index (bass-fair spectrum mapping). */
export function logBin(t: number, binCount: number): number {
  const minBin = 2;
  const usable = Math.max(minBin + 1, Math.floor(binCount * 0.75));
  const bin = Math.floor(minBin * Math.pow(usable / minBin, Math.max(0, Math.min(1, t))));
  return Math.max(0, Math.min(binCount - 1, bin));
}

/** RMS of the time-domain buffer, normalised to ~0..1. */
export function rmsLevel(time: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = (time[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / time.length);
}
