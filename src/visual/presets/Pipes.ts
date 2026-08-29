import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'pipeCount', label: 'Pipes', type: 'range', min: 1, max: 8, step: 1, default: 4 },
  { key: 'length', label: 'Length', type: 'range', min: 6, max: 40, step: 1, default: 22 },
  { key: 'radius', label: 'Thickness', type: 'range', min: 0.02, max: 0.2, step: 0.005, default: 0.06 },
  { key: 'rotationSpeed', label: 'Rotation', type: 'range', min: -1.5, max: 1.5, step: 0.01, default: 0.25 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 3, step: 0.01, default: 1.2 },
];

const DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export class Pipes implements Preset {
  readonly id = 'pipes';
  readonly label = 'Pipes';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private tubes: THREE.Mesh[] = [];
  private materials: THREE.MeshStandardMaterial[] = [];
  private ctx!: PresetContext;
  private count = 0;
  private steps = 0;
  private radius = 0.06;
  private beatPulse = 0;
  private lastRegen = 0;
  private readonly color = new THREE.Color();
  private readonly lights = new THREE.Group();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x202840, 0.8);
    const point = new THREE.PointLight(0xffffff, 0.9);
    point.position.set(3, 4, 2);
    this.lights.add(hemi, point);
    ctx.scene.add(this.lights);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'pipeCount', 4)), Math.round(num(params, 'length', 22)), num(params, 'radius', 0.06));
  }

  private walk(steps: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    let cur = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    let dir = DIRS[Math.floor(Math.random() * DIRS.length)]!.clone();
    pts.push(cur.clone());
    for (let i = 0; i < steps; i++) {
      let nd: THREE.Vector3;
      if (Math.random() < 0.55) {
        nd = dir;
      } else {
        do {
          nd = DIRS[Math.floor(Math.random() * DIRS.length)]!;
        } while (nd.clone().add(dir).lengthSq() < 0.5); // reject reversal
      }
      cur = cur.clone().add(nd);
      pts.push(cur.clone());
      dir = nd.clone();
    }
    return pts;
  }

  private rebuild(count: number, steps: number, radius: number): void {
    for (const t of this.tubes) {
      this.group.remove(t);
      t.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.tubes = [];
    this.materials = [];
    this.count = count;
    this.steps = steps;
    this.radius = radius;

    const box = new THREE.Box3();
    for (let i = 0; i < count; i++) {
      const curve = new THREE.CatmullRomCurve3(this.walk(steps));
      const geo = new THREE.TubeGeometry(curve, steps * 6, radius, 8, false);
      geo.computeBoundingBox();
      if (geo.boundingBox) box.union(geo.boundingBox);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5, emissiveIntensity: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      this.tubes.push(mesh);
      this.materials.push(mat);
      this.group.add(mesh);
    }

    // Centre + scale the whole tangle to fit the view.
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    for (const t of this.tubes) t.geometry.translate(-center.x, -center.y, -center.z);
    this.group.scale.setScalar(2.7 / maxDim);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wantCount = Math.round(num(params, 'pipeCount', 4));
    const wantSteps = Math.round(num(params, 'length', 22));
    const wantRadius = num(params, 'radius', 0.06);
    const bigBeat = frame.beat && frame.beatEnergy > 0.5 && t - this.lastRegen > 6;
    if (wantCount !== this.count || wantSteps !== this.steps || wantRadius !== this.radius || bigBeat) {
      this.rebuild(wantCount, wantSteps, wantRadius);
      this.lastRegen = t;
    }

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 3), frame.beat ? frame.beatEnergy : 0);
    const glow = num(params, 'glow', 1.2);
    const emissive = glow * (0.25 + frame.level * 1.8 + this.beatPulse * 1.4);
    for (let i = 0; i < this.materials.length; i++) {
      const mat = this.materials[i]!;
      this.ctx.style.sample(this.count > 1 ? i / (this.count - 1) : 0.5, this.color);
      mat.color.copy(this.color);
      mat.emissive.copy(this.color);
      mat.emissiveIntensity = emissive;
    }

    this.group.rotation.y += dt * num(params, 'rotationSpeed', 0.25);
    this.group.rotation.x += dt * num(params, 'rotationSpeed', 0.25) * 0.35;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    for (const t of this.tubes) {
      this.group.remove(t);
      t.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.tubes = [];
    this.materials = [];
    this.ctx?.scene.remove(this.group);
    this.ctx?.scene.remove(this.lights);
  }
}
