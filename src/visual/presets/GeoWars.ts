import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'triangleCount', label: 'Triangles', type: 'range', min: 12, max: 140, step: 1, default: 64 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 3, step: 0.01, default: 0.6 },
  { key: 'spread', label: 'Spread', type: 'range', min: 0.6, max: 2.2, step: 0.01, default: 1.5 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
  { key: 'beatKick', label: 'Beat kick', type: 'range', min: 0, max: 2, step: 0.01, default: 0.9 },
];

const GOLDEN = 2.399963229728653;
const TWO_PI_3 = (Math.PI * 2) / 3;

function logBin(t: number, binCount: number): number {
  const minBin = 2;
  const usable = Math.max(minBin + 1, Math.floor(binCount * 0.7));
  const bin = Math.floor(minBin * Math.pow(usable / minBin, t));
  return Math.max(0, Math.min(binCount - 1, bin));
}

/** Neon line-triangles dancing to the spectrum — the Windows Media Player / Geometry Wars look. */
export class GeoWars implements Preset {
  readonly id = 'geowars';
  readonly label = 'Geo Wars';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;
  private lines!: THREE.LineSegments;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;

  private cx: number[] = [];
  private cy: number[] = [];
  private baseAngle: number[] = [];
  private binT: number[] = [];
  private amp: number[] = [];
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.geometry = this.lines.geometry;
    this.group.add(this.lines);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'triangleCount', 64)), num(params, 'spread', 1.5));
  }

  private rebuild(count: number, spread: number): void {
    this.count = count;
    this.positions = new Float32Array(count * 6 * 3);
    this.colors = new Float32Array(count * 6 * 3);
    this.cx = new Array(count);
    this.cy = new Array(count);
    this.baseAngle = new Array(count);
    this.binT = new Array(count);
    this.amp = new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
      const r = spread * Math.sqrt((i + 0.5) / count);
      const theta = i * GOLDEN;
      this.cx[i] = Math.cos(theta) * r;
      this.cy[i] = Math.sin(theta) * r;
      this.baseAngle[i] = theta;
      this.binT[i] = count > 1 ? i / (count - 1) : 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
    this.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wanted = Math.round(num(params, 'triangleCount', 64));
    const spread = num(params, 'spread', 1.5);
    if (wanted !== this.count) this.rebuild(wanted, spread);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const spin = num(params, 'spin', 0.6);
    const reactivity = num(params, 'reactivity', 1.5);
    const beatKick = num(params, 'beatKick', 0.9);
    const centerScale = 1 + frame.bass * 0.25;
    const pos = this.positions;
    const col = this.colors;

    for (let i = 0; i < this.count; i++) {
      const bin = logBin(this.binT[i]!, frame.binCount);
      const target = frame.freq[bin]! / 255;
      const prev = this.amp[i]!;
      const a = target > prev ? target : prev * (1 - dt * 6);
      this.amp[i] = a;

      // layout scales with the current spread so the slider is live
      const baseR = spread * Math.sqrt((i + 0.5) / this.count);
      const theta = this.baseAngle[i]!;
      const cx = Math.cos(theta) * baseR * centerScale;
      const cy = Math.sin(theta) * baseR * centerScale;

      const size = 0.05 + (0.09 + a * reactivity * 0.14 + beatKick * this.beatPulse * 0.14);
      const angle = theta + t * spin + a * 2.5;

      this.ctx.style.sample(a * 0.7 + this.binT[i]! * 0.3, this.color);
      const bright = 0.5 + a * 1.4 + this.beatPulse * 0.6;
      const cr = this.color.r * bright;
      const cg = this.color.g * bright;
      const cb = this.color.b * bright;

      // three corners
      const x0 = cx + Math.cos(angle) * size;
      const y0 = cy + Math.sin(angle) * size;
      const x1 = cx + Math.cos(angle + TWO_PI_3) * size;
      const y1 = cy + Math.sin(angle + TWO_PI_3) * size;
      const x2 = cx + Math.cos(angle + 2 * TWO_PI_3) * size;
      const y2 = cy + Math.sin(angle + 2 * TWO_PI_3) * size;

      // 3 edges = 6 vertices: (0,1)(1,2)(2,0)
      const o = i * 18;
      const xs = [x0, y0, x1, y1, x1, y1, x2, y2, x2, y2, x0, y0];
      for (let k = 0; k < 6; k++) {
        pos[o + k * 3] = xs[k * 2]!;
        pos[o + k * 3 + 1] = xs[k * 2 + 1]!;
        pos[o + k * 3 + 2] = 0;
        col[o + k * 3] = cr;
        col[o + k * 3 + 1] = cg;
        col[o + k * 3 + 2] = cb;
      }
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.group.rotation.z += dt * spin * 0.06;
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
