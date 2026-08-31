import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'noteSpeed', label: 'Note speed', type: 'range', min: 0.2, max: 2, step: 0.01, default: 0.7 },
  { key: 'sensitivity', label: 'Note sensitivity', type: 'range', min: 0.15, max: 0.7, step: 0.01, default: 0.36 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1.4 },
];

const LANES = 5;
const LANE_X = [-1.6, -0.8, 0, 0.8, 1.6];
const BOUND_X = [-2.0, -1.2, -0.4, 0.4, 1.2, 2.0];
const LANE_COLORS = ['#39ff5a', '#ff3b3b', '#ffe23b', '#3b8bff', '#ff8c1a'];
const VP_Y = 1.75;
const HIT_Y = -1.7;
const MAX = 140;

function projX(lane: number, p: number): number {
  return LANE_X[lane]! * (0.12 + 0.88 * p);
}
function projY(p: number): number {
  const q = p * p;
  return VP_Y * (1 - q) + HIT_Y * q;
}

export class GuitarHero implements Preset {
  readonly id = 'guitarhero';
  readonly label = 'Guitar Hero';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private gemGeo!: THREE.CircleGeometry;
  private gemMat!: THREE.MeshBasicMaterial;
  private gems!: THREE.InstancedMesh;
  private strikeMat!: THREE.MeshBasicMaterial;
  private strikes!: THREE.InstancedMesh;
  private lines!: THREE.LineSegments;
  private ctx!: PresetContext;

  private lane = new Int8Array(MAX);
  private prog = new Float32Array(MAX);
  private active = new Uint8Array(MAX);
  private laneColors: THREE.Color[] = [];
  private laneFlash = [0, 0, 0, 0, 0];
  private prevBand = [0, 0, 0, 0, 0];
  private lastSpawn = [0, 0, 0, 0, 0];
  private clock = 0;
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, _params: PresetParams): void {
    this.ctx = ctx;
    this.laneColors = LANE_COLORS.map((c) => new THREE.Color(c));

    this.gemGeo = new THREE.CircleGeometry(0.5, 4);
    this.gemGeo.rotateZ(Math.PI / 4); // diamond
    this.gemMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.gems = new THREE.InstancedMesh(this.gemGeo, this.gemMat, MAX);
    this.gems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.strikeMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.strikes = new THREE.InstancedMesh(this.gemGeo, this.strikeMat, LANES);

    // lane boundary lines + horizontal frets + hit line
    const pos: number[] = [];
    const col: number[] = [];
    const dim = [0.35, 0.4, 0.55];
    for (const bx of BOUND_X) { pos.push(0, VP_Y, 0, bx, HIT_Y, 0); col.push(...dim, ...dim); }
    for (const pf of [0.2, 0.4, 0.62, 0.85]) {
      const w = 0.12 + 0.88 * pf; const y = projY(pf);
      pos.push(-2 * w, y, 0, 2 * w, y, 0); col.push(0.3, 0.3, 0.4, 0.3, 0.3, 0.4);
    }
    pos.push(-2, HIT_Y, 0, 2, HIT_Y, 0); col.push(0.9, 0.9, 1.0, 0.9, 0.9, 1.0);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));

    this.group.add(this.lines, this.strikes, this.gems);
    ctx.scene.add(this.group);
  }

  private spawn(lane: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.lane[i] = lane;
    this.prog[i] = 0;
    this.active[i] = 1;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    this.clock += dt;
    const speed = num(params, 'noteSpeed', 0.7) * (0.7 + frame.level * 0.6);
    const sens = num(params, 'sensitivity', 0.36);
    const glow = num(params, 'glow', 1.4);

    // spawn notes on per-lane onsets
    for (let l = 0; l < LANES; l++) {
      const band = frame.freq[logBin(LANES > 1 ? l / (LANES - 1) : 0, frame.binCount)]! / 255;
      if (band > sens && band > this.prevBand[l]! + 0.05 && this.clock - this.lastSpawn[l]! > 0.13) {
        this.spawn(l);
        this.lastSpawn[l] = this.clock;
      }
      this.prevBand[l] = band;
      this.laneFlash[l] = Math.max(0, this.laneFlash[l]! - dt * 3.5);
    }

    // advance + write gems
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i]) { this.dummy.scale.set(0, 0, 0); this.dummy.position.set(0, 0, 0); this.dummy.updateMatrix(); this.gems.setMatrixAt(i, this.dummy.matrix); continue; }
      let p = this.prog[i]! + dt * speed;
      const lane = this.lane[i]!;
      if (p >= 1) { this.active[i] = 0; this.laneFlash[lane] = 1; this.dummy.scale.set(0, 0, 0); this.dummy.updateMatrix(); this.gems.setMatrixAt(i, this.dummy.matrix); continue; }
      this.prog[i] = p;
      const s = 0.05 + 0.34 * p;
      this.dummy.position.set(projX(lane, p), projY(p), 0);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.gems.setMatrixAt(i, this.dummy.matrix);
      this.color.copy(this.laneColors[lane]!).multiplyScalar(glow * (0.6 + p * 0.9));
      this.gems.setColorAt(i, this.color);
    }
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;

    // strike zones
    for (let l = 0; l < LANES; l++) {
      this.dummy.position.set(LANE_X[l]!, HIT_Y, 0);
      const s = 0.34 * (0.6 + this.laneFlash[l]! * 0.8);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.strikes.setMatrixAt(l, this.dummy.matrix);
      this.color.copy(this.laneColors[l]!).multiplyScalar(0.25 + this.laneFlash[l]! * 1.6 * glow);
      this.strikes.setColorAt(l, this.color);
    }
    this.strikes.instanceMatrix.needsUpdate = true;
    if (this.strikes.instanceColor) this.strikes.instanceColor.needsUpdate = true;
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.gemGeo.dispose();
    this.gemMat.dispose();
    this.gems.dispose();
    this.strikeMat.dispose();
    this.strikes.dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
