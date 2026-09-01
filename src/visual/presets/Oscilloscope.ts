import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, str, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'mode', label: 'Mode', type: 'select', options: ['Scope', 'Lissajous'], default: 'Scope' },
  { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0.2, max: 2, step: 0.01, default: 1 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.5, max: 3, step: 0.01, default: 1.5 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 2, step: 0.01, default: 0.3 },
];

// Fixed waveform resolution — the line always has this many vertices; we sub-sample
// frame.time into it so the geometry never has to be rebuilt.
const N = 1024;

/** The raw time-domain waveform drawn as a glowing additive polyline — classic scope, or a Lissajous XY figure. */
export class Oscilloscope implements Preset {
  readonly id = 'oscilloscope';
  readonly label = 'Oscilloscope';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;
  private line!: THREE.Line;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private ctx!: PresetContext;
  private beatPulse = 0;
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, _params: PresetParams): void {
    this.ctx = ctx;
    this.positions = new Float32Array(N * 3);
    this.colors = new Float32Array(N * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.line = new THREE.Line(this.geometry, this.material);
    this.group.add(this.line);
    ctx.scene.add(this.group);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const lissajous = str(params, 'mode', 'Scope') === 'Lissajous';
    const amp = num(params, 'amplitude', 1);
    const glow = num(params, 'glow', 1.5);
    const spin = num(params, 'spin', 0.3);
    const bright = (0.5 + frame.level * 1.2 + this.beatPulse) * glow;

    const time = frame.time;
    const s = time.length;
    const quarter = Math.floor(s / 4);
    const P = this.positions;
    const C = this.colors;
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const idx0 = Math.floor(f * (s - 1));
      const w0 = (time[idx0]! - 128) / 128;
      let x: number;
      let y: number;
      if (lissajous) {
        const w1 = (time[(idx0 + quarter) % s]! - 128) / 128;
        x = w0 * amp * 1.6;
        y = w1 * amp * 1.6;
      } else {
        x = (f * 2 - 1) * 2.4;
        y = w0 * amp;
      }
      const o = i * 3;
      P[o] = x;
      P[o + 1] = y;
      P[o + 2] = 0;
      this.ctx.style.sample((i / N + t * 0.05) % 1, this.color);
      C[o] = this.color.r * bright;
      C[o + 1] = this.color.g * bright;
      C[o + 2] = this.color.b * bright;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    this.group.rotation.z += dt * spin;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
