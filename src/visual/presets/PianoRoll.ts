import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'keys', label: 'Keys', type: 'range', min: 12, max: 48, step: 1, default: 30 },
  { key: 'speed', label: 'Scroll speed', type: 'range', min: 2, max: 24, step: 0.5, default: 9 },
  { key: 'threshold', label: 'Note gate', type: 'range', min: 0.05, max: 0.5, step: 0.01, default: 0.18 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1.4 },
];

const R = 46; // history rows
const TOP = 1.95;
const KEYBOARD = -1.55;

export class PianoRoll implements Preset {
  readonly id = 'pianoroll';
  readonly label = 'Piano Roll';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private grid = new THREE.Group();
  private quadGeo!: THREE.PlaneGeometry;
  private gridMesh: THREE.InstancedMesh | null = null;
  private keyMesh: THREE.InstancedMesh | null = null;
  private material!: THREE.MeshBasicMaterial;
  private keyMat!: THREE.MeshBasicMaterial;
  private ctx!: PresetContext;
  private K = 0;
  private history!: Float32Array;
  private laneColor: THREE.Color[] = [];
  private scrollAcc = 0;
  private rowH = 0;
  private readonly color = new THREE.Color();
  private readonly dummy = new THREE.Object3D();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.quadGeo = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.keyMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.group.add(this.grid);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'keys', 30)));
  }

  private rebuild(K: number): void {
    if (this.gridMesh) { this.grid.remove(this.gridMesh); this.gridMesh.dispose(); }
    if (this.keyMesh) { this.group.remove(this.keyMesh); this.keyMesh.dispose(); }
    this.K = K;
    this.history = new Float32Array(K * R);
    this.rowH = (TOP - KEYBOARD) / (R - 1);
    const laneW = 5.2 / K;
    this.laneColor = [];
    for (let l = 0; l < K; l++) this.laneColor.push(this.ctx.style.sample(l / K, new THREE.Color()));

    this.gridMesh = new THREE.InstancedMesh(this.quadGeo, this.material, K * R);
    this.gridMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let r = 0; r < R; r++) {
      for (let l = 0; l < K; l++) {
        this.dummy.position.set((l - (K - 1) / 2) * laneW, KEYBOARD + r * this.rowH, 0);
        this.dummy.scale.set(laneW * 0.84, this.rowH * 0.8, 1);
        this.dummy.updateMatrix();
        this.gridMesh.setMatrixAt(l + r * K, this.dummy.matrix);
      }
    }
    this.gridMesh.instanceMatrix.needsUpdate = true;
    this.grid.add(this.gridMesh);

    this.keyMesh = new THREE.InstancedMesh(this.quadGeo, this.keyMat, K);
    for (let l = 0; l < K; l++) {
      this.dummy.position.set((l - (K - 1) / 2) * laneW, KEYBOARD - 0.16, 0);
      this.dummy.scale.set(laneW * 0.84, 0.26, 1);
      this.dummy.updateMatrix();
      this.keyMesh.setMatrixAt(l, this.dummy.matrix);
    }
    this.keyMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.keyMesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'keys', 30));
    if (wanted !== this.K) this.rebuild(wanted);
    const grid = this.gridMesh, keys = this.keyMesh;
    if (!grid || !keys) return;

    const gate = num(params, 'threshold', 0.18);
    const glow = num(params, 'glow', 1.4);

    // scroll: shift history down, newest row at top
    this.scrollAcc += dt * num(params, 'speed', 9);
    let guard = 0;
    while (this.scrollAcc >= 1 && guard++ < 8) {
      this.scrollAcc -= 1;
      for (let r = 0; r < R - 1; r++) {
        for (let l = 0; l < this.K; l++) this.history[l + r * this.K] = this.history[l + (r + 1) * this.K]!;
      }
      for (let l = 0; l < this.K; l++) {
        const band = frame.freq[logBin(l / this.K, frame.binCount)]! / 255;
        this.history[l + (R - 1) * this.K] = band > gate ? band : 0;
      }
    }
    this.grid.position.y = -this.scrollAcc * this.rowH;

    // colour the grid from history (additive: 0 => invisible)
    for (let r = 0; r < R; r++) {
      for (let l = 0; l < this.K; l++) {
        const v = this.history[l + r * this.K]!;
        this.color.copy(this.laneColor[l]!).multiplyScalar(v * glow * 1.3);
        grid.setColorAt(l + r * this.K, this.color);
      }
    }
    if (grid.instanceColor) grid.instanceColor.needsUpdate = true;

    // keys light up with the live band
    for (let l = 0; l < this.K; l++) {
      const band = frame.freq[logBin(l / this.K, frame.binCount)]! / 255;
      this.color.copy(this.laneColor[l]!).multiplyScalar(0.12 + band * glow * 1.4);
      keys.setColorAt(l, this.color);
    }
    if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    if (this.gridMesh) { this.grid.remove(this.gridMesh); this.gridMesh.dispose(); this.gridMesh = null; }
    if (this.keyMesh) { this.group.remove(this.keyMesh); this.keyMesh.dispose(); this.keyMesh = null; }
    this.ctx?.scene.remove(this.group);
    this.quadGeo.dispose();
    this.material.dispose();
    this.keyMat.dispose();
  }
}
