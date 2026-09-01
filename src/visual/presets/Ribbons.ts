import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'ribbonCount', label: 'Ribbons', type: 'range', min: 2, max: 10, step: 1, default: 8 },
  { key: 'length', label: 'Length', type: 'range', min: 40, max: 160, step: 5, default: 90 },
  { key: 'flow', label: 'Flow', type: 'range', min: 0, max: 3, step: 0.01, default: 0.7 },
  { key: 'beatKick', label: 'Beat kick', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

// Box the ribbon heads roam inside; a head that escapes respawns near the centre.
const BOUND_X = 2.6;
const BOUND_Y = 1.6;
const BOUND_Z = 2.6;

interface Ribbon {
  line: THREE.Line;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  positions: Float32Array;
  colors: Float32Array;
  hx: number;
  hy: number;
  hz: number;
  seed: number;
}

/** Several silky ribbons — trailing polylines whose heads swim through a cheap curl-like sine field. */
export class Ribbons implements Preset {
  readonly id = 'ribbons';
  readonly label = 'Ribbons';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private ribbons: Ribbon[] = [];
  private ctx!: PresetContext;
  private count = 0;
  private ribbonLen = 0;
  private beatPulse = 0;
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'ribbonCount', 6)), Math.round(num(params, 'length', 90)));
  }

  private spawnHead(r: Ribbon): void {
    r.hx = (Math.random() * 2 - 1) * 0.4;
    r.hy = (Math.random() * 2 - 1) * 0.4;
    r.hz = (Math.random() * 2 - 1) * 0.4;
    r.seed = Math.random() * 100;
  }

  private rebuild(count: number, length: number): void {
    for (const r of this.ribbons) {
      this.group.remove(r.line);
      r.geometry.dispose();
      r.material.dispose();
    }
    this.ribbons = [];
    this.count = count;
    this.ribbonLen = length;
    for (let i = 0; i < count; i++) {
      const positions = new Float32Array(length * 3);
      const colors = new Float32Array(length * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      this.group.add(line);
      const ribbon: Ribbon = { line, geometry, material, positions, colors, hx: 0, hy: 0, hz: 0, seed: 0 };
      this.spawnHead(ribbon);
      // Collapse the whole trail onto the head so it does not streak from the origin on the first frames.
      for (let j = 0; j < length; j++) {
        positions[j * 3] = ribbon.hx;
        positions[j * 3 + 1] = ribbon.hy;
        positions[j * 3 + 2] = ribbon.hz;
      }
      this.ribbons.push(ribbon);
    }
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wantedCount = Math.round(num(params, 'ribbonCount', 6));
    const wantedLen = Math.round(num(params, 'length', 90));
    if (wantedCount !== this.count || wantedLen !== this.ribbonLen) this.rebuild(wantedCount, wantedLen);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const flow = num(params, 'flow', 1);
    const beatKick = num(params, 'beatKick', 1);
    const M = this.ribbonLen;
    const step = Math.min(dt, 0.05);
    const speed = flow * (0.5 + frame.level * 2 + this.beatPulse * 2 * beatKick);
    const bright = 1.2 + frame.level * 2.4 + this.beatPulse * 1.6;

    for (let ri = 0; ri < this.ribbons.length; ri++) {
      const r = this.ribbons[ri]!;

      // Pseudo-curl velocity from cheap sines — no external noise field needed.
      const vx = Math.sin(r.hy * 1.7 + r.seed) + Math.sin(r.hz * 1.3);
      const vy = Math.sin(r.hx * 1.5) + 0.6;
      const vz = Math.sin(r.hx * 1.1 + r.hy * 0.9 + r.seed);
      const len = Math.hypot(vx, vy, vz) || 1;
      r.hx += (vx / len) * speed * step;
      r.hy += (vy / len) * speed * step;
      r.hz += (vz / len) * speed * step;

      if (Math.abs(r.hx) > BOUND_X || Math.abs(r.hy) > BOUND_Y || Math.abs(r.hz) > BOUND_Z) {
        this.spawnHead(r);
      }

      const P = r.positions;
      const C = r.colors;
      // Shift the trail one step down, then drop the new head at the front.
      for (let i = M - 1; i >= 1; i--) {
        const o = i * 3;
        const p = (i - 1) * 3;
        P[o] = P[p]!;
        P[o + 1] = P[p + 1]!;
        P[o + 2] = P[p + 2]!;
      }
      P[0] = r.hx;
      P[1] = r.hy;
      P[2] = r.hz;

      for (let i = 0; i < M; i++) {
        this.ctx.style.sample((i / M + ri * 0.13) % 1, this.color);
        const taper = bright * (1 - (i / M) * 0.7); // head bright, tail fades out
        const o = i * 3;
        C[o] = this.color.r * taper;
        C[o + 1] = this.color.g * taper;
        C[o + 2] = this.color.b * taper;
      }

      (r.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (r.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    for (const r of this.ribbons) {
      this.group.remove(r.line);
      r.geometry.dispose();
      r.material.dispose();
    }
    this.ribbons = [];
    this.ctx?.scene.remove(this.group);
  }
}
