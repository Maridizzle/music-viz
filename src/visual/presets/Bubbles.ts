import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'bubbleCount', label: 'Bubbles', type: 'range', min: 20, max: 400, step: 5, default: 120 },
  { key: 'riseSpeed', label: 'Rise speed', type: 'range', min: 0.1, max: 2, step: 0.01, default: 0.6 },
  { key: 'size', label: 'Size', type: 'range', min: 0.02, max: 0.3, step: 0.005, default: 0.09 },
  { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'beatPop', label: 'Beat pop', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

const SPREAD = 1.7;
const TOP = 2.0;

export class Bubbles implements Preset {
  readonly id = 'bubbles';
  readonly label = 'Bubbles';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.IcosahedronGeometry;
  private material!: THREE.MeshStandardMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private readonly lights = new THREE.Group();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  // per-bubble state
  private baseX: number[] = [];
  private baseZ: number[] = [];
  private y: number[] = [];
  private phase: number[] = [];
  private speed: number[] = [];
  private sizeVar: number[] = [];
  private colorT: number[] = [];
  private binT: number[] = [];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.IcosahedronGeometry(1, 2);
    this.material = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.6,
      roughness: 0.15,
      metalness: 0.1,
      emissive: new THREE.Color(0x0a0a12),
      emissiveIntensity: 0.6,
      depthWrite: false,
    });
    const hemi = new THREE.HemisphereLight(0xffffff, 0x101830, 0.9);
    const point = new THREE.PointLight(0xffffff, 0.8);
    point.position.set(2, 3, 3);
    this.lights.add(hemi, point);
    ctx.scene.add(this.lights);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'bubbleCount', 120)));
  }

  private spawn(i: number): void {
    this.baseX[i] = (Math.random() * 2 - 1) * SPREAD;
    this.baseZ[i] = (Math.random() * 2 - 1) * SPREAD;
    this.phase[i] = Math.random() * Math.PI * 2;
    this.speed[i] = 0.6 + Math.random() * 1.2;
    this.sizeVar[i] = Math.random();
    this.colorT[i] = Math.random();
    this.binT[i] = Math.random();
  }

  private rebuild(count: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.count = count;
    this.baseX = new Array(count);
    this.baseZ = new Array(count);
    this.y = new Array(count);
    this.phase = new Array(count);
    this.speed = new Array(count);
    this.sizeVar = new Array(count);
    this.colorT = new Array(count);
    this.binT = new Array(count);
    for (let i = 0; i < count; i++) {
      this.spawn(i);
      this.y[i] = (Math.random() * 2 - 1) * TOP; // start spread through the column
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wanted = Math.round(num(params, 'bubbleCount', 120));
    if (wanted !== this.count) this.rebuild(wanted);
    const mesh = this.mesh;
    if (!mesh) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const riseSpeed = num(params, 'riseSpeed', 0.6);
    const size = num(params, 'size', 0.09);
    const wobble = num(params, 'wobble', 0.6);
    const beatPop = num(params, 'beatPop', 1);
    const rise = riseSpeed * (0.3 + frame.level * 2.4 + this.beatPulse * 1.6);

    for (let i = 0; i < this.count; i++) {
      let yi = this.y[i]! + dt * rise * this.speed[i]!;
      if (yi > TOP) {
        this.spawn(i);
        yi = -TOP;
      }
      this.y[i] = yi;
      // each bubble dances to its own slice of the spectrum
      const band = frame.freq[logBin(this.binT[i]!, frame.binCount)]! / 255;
      const ph = t * this.speed[i]! + this.phase[i]!;
      const x = this.baseX[i]! + Math.sin(ph) * wobble * 0.18;
      const z = this.baseZ[i]! + Math.cos(ph * 0.8) * wobble * 0.18;
      const radius =
        size * (0.25 + band * 1.9 + frame.level * 0.5 + this.sizeVar[i]! * 0.5) +
        this.beatPulse * beatPop * 0.5 * (0.4 + band);
      this.dummy.position.set(x, yi, z);
      this.dummy.scale.setScalar(Math.max(0.001, radius));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.ctx.style.sample(this.colorT[i]!, this.color);
      this.color.multiplyScalar(0.5 + band * 1.3 + this.beatPulse * 0.5);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.material.emissiveIntensity = 0.35 + frame.level * 1.3 + this.beatPulse * 1.2;
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
