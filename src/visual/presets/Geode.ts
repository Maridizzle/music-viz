import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'crystalCount', label: 'Crystals', type: 'range', min: 60, max: 600, step: 10, default: 240 },
  { key: 'length', label: 'Length', type: 'range', min: 0.2, max: 1.6, step: 0.01, default: 0.8 },
  { key: 'rotation', label: 'Rotation', type: 'range', min: -1, max: 1, step: 0.01, default: 0.15 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
  { key: 'glint', label: 'Glint', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

const UP = new THREE.Vector3(0, 1, 0);
const R = 0.95; // geode inner radius

export class Geode implements Preset {
  readonly id = 'geode';
  readonly label = 'Geode';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.ConeGeometry;
  private material!: THREE.MeshStandardMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private lights = new THREE.Group();
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;

  private dir: THREE.Vector3[] = [];
  private baseLen: number[] = [];
  private binT: number[] = [];
  private colorT: number[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.ConeGeometry(0.13, 1, 5);
    this.geometry.translate(0, 0.5, 0); // base at origin, grows +Y
    this.material = new THREE.MeshStandardMaterial({
      metalness: 0.35,
      roughness: 0.35,
      emissive: new THREE.Color(0x0a0a16),
      emissiveIntensity: 0.4,
      flatShading: true,
    });
    const hemi = new THREE.HemisphereLight(0xffffff, 0x101024, 0.7);
    const p1 = new THREE.PointLight(0xffffff, 0.9);
    p1.position.set(3, 3, 4);
    const p2 = new THREE.PointLight(0x88bbff, 0.6);
    p2.position.set(-3, -2, 2);
    this.lights.add(hemi, p1, p2);
    ctx.scene.add(this.lights, this.group);
    this.rebuild(Math.round(num(params, 'crystalCount', 240)));
  }

  private rebuild(count: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.count = count;
    this.dir = new Array(count);
    this.baseLen = new Array(count);
    this.binT = new Array(count);
    this.colorT = new Array(count);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2; // 1..-1
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      this.dir[i] = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
      this.baseLen[i] = 0.4 + Math.random() * 0.6;
      this.binT[i] = Math.random();
      this.colorT[i] = Math.random();
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'crystalCount', 240));
    if (wanted !== this.count) this.rebuild(wanted);
    const mesh = this.mesh;
    if (!mesh) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const length = num(params, 'length', 0.8);
    const react = num(params, 'reactivity', 1.6);
    const glint = num(params, 'glint', 1);
    const thick = 0.7 + frame.bass * 0.5;

    for (let i = 0; i < this.count; i++) {
      const band = frame.freq[logBin(this.binT[i]!, frame.binCount)]! / 255;
      const len = length * this.baseLen[i]! * (0.35 + band * react + this.beatPulse * 0.4);
      const d = this.dir[i]!;
      this.q.setFromUnitVectors(UP, d);
      this.dummy.position.copy(d).multiplyScalar(R);
      this.dummy.quaternion.copy(this.q);
      this.dummy.scale.set(thick, Math.max(0.03, len), thick);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.ctx.style.sample(this.colorT[i]!, this.color);
      this.color.multiplyScalar(0.6 + band * 1.2 + this.beatPulse * 0.5);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.material.emissiveIntensity = 0.3 + glint * (this.beatPulse * 0.9 + frame.treble * 0.5);

    this.group.rotation.y += dt * num(params, 'rotation', 0.15);
    this.group.rotation.x += dt * num(params, 'rotation', 0.15) * 0.3;
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
    this.ctx?.scene.remove(this.lights);
    this.geometry.dispose();
    this.material.dispose();
  }
}
