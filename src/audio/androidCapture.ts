import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Native side: android/app/src/main/java/com/maridizzle/musicviz/AudioCapturePlugin.java */
interface AudioCapturePlugin {
  start(options: { sampleRate: number }): Promise<{ sampleRate: number }>;
  stop(): Promise<void>;
  addListener(event: 'pcm', cb: (e: { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'stopped', cb: () => void): Promise<PluginListenerHandle>;
}

const AudioCapture = registerPlugin<AudioCapturePlugin>('AudioCapture');

/** True inside the native Android app, where other apps' audio can be captured. */
export function hasNativeCapture(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// An AudioWorklet that plays back PCM chunks pushed from the main thread through a
// ring buffer. Its output goes to a MediaStreamDestination so the engine can treat
// the captured audio like any other MediaStream source.
const WORKLET_SOURCE = `
class PcmFeeder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = sampleRate * 3;
    this.ring = new Float32Array(this.size);
    this.write = 0;
    this.read = 0;
    this.available = 0;
    this.primed = false;
    this.port.onmessage = (e) => {
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) {
        this.ring[this.write] = chunk[i];
        this.write = (this.write + 1) % this.size;
      }
      this.available = Math.min(this.size, this.available + chunk.length);
      if (this.available > this.size - chunk.length) {
        // Overrun: drop the oldest audio so latency never creeps up.
        this.read = (this.write - Math.floor(sampleRate * 0.25) + this.size) % this.size;
        this.available = Math.floor(sampleRate * 0.25);
      }
      if (!this.primed && this.available >= Math.floor(sampleRate * 0.08)) this.primed = true;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.primed || this.available < out.length) {
      out.fill(0);
      if (this.available < out.length) this.primed = false;
      return true;
    }
    for (let i = 0; i < out.length; i++) {
      out[i] = this.ring[this.read];
      this.read = (this.read + 1) % this.size;
    }
    this.available -= out.length;
    return true;
  }
}
registerProcessor('pcm-feeder', PcmFeeder);
`;

let workletUrl: string | null = null;
const loadedContexts = new WeakSet<AudioContext>();

async function ensureWorklet(context: AudioContext): Promise<void> {
  if (loadedContexts.has(context)) return;
  if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
  await context.audioWorklet.addModule(workletUrl);
  loadedContexts.add(context);
}

function decodePcm16(base64: string): Float32Array<ArrayBuffer> {
  const bin = atob(base64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(2 * i);
    const hi = bin.charCodeAt(2 * i + 1);
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

function resampleLinear(input: Float32Array<ArrayBuffer>, from: number, to: number): Float32Array<ArrayBuffer> {
  if (from === to) return input;
  const ratio = from / to;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

export interface NativeCapture {
  stream: MediaStream;
  stop: () => Promise<void>;
  /** Fires when Android ends the capture (user stopped the screen-capture notification). */
  onEnded: (() => void) | null;
}

/**
 * Capture other apps' playback audio (Android 10+ AudioPlaybackCapture) and
 * expose it as a MediaStream inside `context`. Apps that opt out of capture
 * (Spotify, most DRM streamers) contribute silence — that's their policy, not a bug.
 */
export async function startNativeCapture(context: AudioContext): Promise<NativeCapture> {
  await ensureWorklet(context);
  const node = new AudioWorkletNode(context, 'pcm-feeder', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const dest = context.createMediaStreamDestination();
  node.connect(dest);

  const capture: NativeCapture = { stream: dest.stream, stop: async () => undefined, onEnded: null };
  let nativeRate = context.sampleRate;
  const pcmHandle = await AudioCapture.addListener('pcm', (e) => {
    const samples = decodePcm16(e.data);
    const fitted = resampleLinear(samples, nativeRate, context.sampleRate);
    node.port.postMessage(fitted, [fitted.buffer]);
  });
  const stoppedHandle = await AudioCapture.addListener('stopped', () => {
    capture.onEnded?.();
  });

  const cleanup = async (): Promise<void> => {
    await pcmHandle.remove();
    await stoppedHandle.remove();
    node.disconnect();
    dest.stream.getTracks().forEach((t) => t.stop());
  };

  try {
    const res = await AudioCapture.start({ sampleRate: context.sampleRate });
    nativeRate = res.sampleRate || context.sampleRate;
  } catch (e) {
    await cleanup();
    throw e instanceof Error ? e : new Error(String(e));
  }

  capture.stop = async () => {
    await AudioCapture.stop().catch(() => undefined);
    await cleanup();
  };
  return capture;
}
