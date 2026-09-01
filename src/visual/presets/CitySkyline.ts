import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 8, max: 24, step: 1, default: 16 },
  { key: 'depth', label: 'Depth', type: 'range', min: 6, max: 16, step: 1, default: 10 },
  { key: 'heightScale', label: 'Height', type: 'range', min: 0.5, max: 4, step: 0.05, default: 2 },
  { key: 'scrollSpeed', label: 'Scroll speed', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'beatPop', label: 'Beat pop', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

const SPX = 0.32;
const SPZ = 0.7;
const GROUND = -1.15;
const NEAR = 1.6;
const WIDTH = 0.22;
const DEPTH = 0.22;

/** Float-safe modulo so scrolled rows wrap cleanly through [0, n). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Deterministic 0..1 hash so each (column,row) box gets a stable height jitter. */
function hash(c: number, r: number): number {
  const x = Math.sin(c * 12.9 + r * 7.1) * 43758.5;
  return x - Math.floor(x);
}

export class CitySkyline implements Preset {
  readonly id = 'city';
  readonly label = 'City Skyline';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BoxGeometry;
  private material!: THREE.MeshBasicMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private cols = 0;
  private rows = 0;
  private offset = 0;
  private beatPulse = 0;
  private heights: number[] = []; // smoothed per-column heights (length = cols)
  private variation: number[] = []; // per-instance height jitter, index = c*rows + r
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'density', 16)), Math.round(num(params, 'depth', 10)));
  }

  private rebuild(cols: number, rows: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.cols = cols;
    this.rows = rows;
    this.heights = new Array(cols).fill(0.12);
    this.variation = new Array(cols * rows);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this.variation[c * rows + r] = 0.7 + 0.6 * hash(c, r);
      }
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, cols * rows);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const cols = Math.round(num(params, 'density', 16));
    const rows = Math.round(num(params, 'depth', 10));
    if (cols !== this.cols || rows !== this.rows) this.rebuild(cols, rows);
    const mesh = this.mesh;
    if (!mesh) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const heightScale = num(params, 'heightScale', 2);
    const scrollSpeed = num(params, 'scrollSpeed', 1);
    const beatPop = num(params, 'beatPop', 1);

    // fly-through: recycle rows endlessly toward the back as offset grows
    this.offset += dt * scrollSpeed * (0.5 + frame.level * 1.5);
    const k = Math.min(1, dt * 8); // per-column height smoothing factor
    const denom = cols > 1 ? cols - 1 : 1;

    for (let c = 0; c < cols; c++) {
      const band = frame.freq[logBin(c / denom, frame.binCount)]! / 255;
      const cur = this.heights[c]!;
      const colH = cur + (0.12 + band * heightScale - cur) * k;
      this.heights[c] = colH;
      const x = (c - (cols - 1) / 2) * SPX;
      const bright = 0.5 + band * 1.2 + this.beatPulse * beatPop;
      for (let r = 0; r < rows; r++) {
        const idx = c * rows + r;
        const h = Math.max(0.001, colH * this.variation[idx]!);
        const zp = NEAR - mod(r + this.offset, rows) * SPZ;
        this.dummy.position.set(x, GROUND + h / 2, zp);
        this.dummy.scale.set(WIDTH, h, DEPTH);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(idx, this.dummy.matrix);
        this.ctx.style.sample(Math.min(1, Math.max(0, h * 0.5)), this.color);
        this.color.multiplyScalar(bright);
        mesh.setColorAt(idx, this.color);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
