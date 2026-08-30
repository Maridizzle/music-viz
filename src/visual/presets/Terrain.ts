import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'heightScale', label: 'Height', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1.4 },
  { key: 'speed', label: 'Scroll speed', type: 'range', min: 1, max: 30, step: 0.5, default: 12 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1.3 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
];

const W = 72; // columns (frequency)
const D = 56; // rows (time)
const WIDTH = 9;
const DEPTH = 18;

/** A wireframe terrain whose ridgeline is the live spectrum, scrolling toward the camera. */
export class Terrain implements Preset {
  readonly id = 'terrain';
  readonly label = 'Audio Terrain';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.MeshBasicMaterial;
  private mesh!: THREE.Mesh;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private ctx!: PresetContext;
  private scrollAcc = 0;
  private beatPulse = 0;
  private readonly color = new THREE.Color();
  private readonly cellDepth = DEPTH / (D - 1);

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.positions = new Float32Array(W * D * 3);
    this.colors = new Float32Array(W * D * 3);
    const index: number[] = [];
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < W; i++) {
        const k = (i + j * W) * 3;
        this.positions[k] = (i / (W - 1) - 0.5) * WIDTH;
        this.positions[k + 1] = 0;
        this.positions[k + 2] = -(j / (D - 1)) * DEPTH;
      }
    }
    for (let j = 0; j < D - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = i + j * W, b = i + 1 + j * W, c = i + (j + 1) * W, d = i + 1 + (j + 1) * W;
        index.push(a, b, d, a, d, c);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(index);
    this.material = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, toneMapped: false });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
    this.group.position.set(0, -1.1, 3);
    this.group.rotation.x = -0.12;
    ctx.scene.add(this.group);
  }

  private shiftRow(frame: AudioFrame, heightScale: number, react: number): void {
    const P = this.positions;
    for (let j = 0; j < D - 1; j++) {
      for (let i = 0; i < W; i++) {
        P[(i + j * W) * 3 + 1] = P[(i + (j + 1) * W) * 3 + 1];
      }
    }
    for (let i = 0; i < W; i++) {
      const m = Math.abs(i - (W - 1) / 2) / ((W - 1) / 2);
      const bin = logBin(m, frame.binCount);
      const amp = (frame.freq[bin]! / 255) * react;
      P[(i + (D - 1) * W) * 3 + 1] = amp * heightScale;
    }
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const heightScale = num(params, 'heightScale', 1.4);
    const react = num(params, 'reactivity', 1.5);
    const glow = num(params, 'glow', 1.3);

    this.scrollAcc += dt * num(params, 'speed', 12);
    let shifted = false;
    let guard = 0;
    while (this.scrollAcc >= 1 && guard++ < 6) {
      this.scrollAcc -= 1;
      this.shiftRow(frame, heightScale, react);
      shifted = true;
    }
    this.group.position.z = 3 + this.scrollAcc * this.cellDepth;

    if (shifted) {
      const P = this.positions;
      const C = this.colors;
      for (let n = 0; n < W * D; n++) {
        const h = P[n * 3 + 1]! / heightScale;
        this.ctx.style.sample(Math.min(1, 0.1 + h * 0.9), this.color);
        this.color.multiplyScalar(glow * (0.4 + h * 1.3));
        C[n * 3] = this.color.r; C[n * 3 + 1] = this.color.g; C[n * 3 + 2] = this.color.b;
      }
      (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
