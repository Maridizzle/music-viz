import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'fishCount', label: 'Fish', type: 'range', min: 8, max: 120, step: 2, default: 42 },
  { key: 'speed', label: 'Swim speed', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1 },
  { key: 'dart', label: 'Beat dart', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'size', label: 'Size', type: 'range', min: 0.5, max: 2, step: 0.01, default: 1 },
];

interface Fish { x: number; y: number; z: number; dir: number; speed: number; bob: number; wag: number; colorT: number; binT: number; }

export class TropicalFish implements Preset {
  readonly id = 'fish';
  readonly label = 'Tropical Fish';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private fishGeo!: THREE.BufferGeometry;
  private fishMat!: THREE.MeshBasicMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private bgGeo!: THREE.PlaneGeometry;
  private bg!: THREE.Mesh;
  private ctx!: PresetContext;
  private fish: Fish[] = [];
  private count = 0;
  private beatPulse = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    // fish silhouette: body triangle + tail fin, pointing +X
    const verts = new Float32Array([
      0.55, 0, 0, -0.1, 0.26, 0, -0.1, -0.26, 0, // body
      -0.05, 0, 0, -0.5, 0.28, 0, -0.5, -0.28, 0, // tail
    ]);
    this.fishGeo = new THREE.BufferGeometry();
    this.fishGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.fishMat = new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide, toneMapped: false });

    // aquarium gradient background
    this.bgGeo = new THREE.PlaneGeometry(1, 1);
    const bcol = new Float32Array(4 * 3);
    const posAttr = this.bgGeo.getAttribute('position');
    const top = new THREE.Color(0.06, 0.34, 0.42);
    const bot = new THREE.Color(0.01, 0.06, 0.14);
    for (let i = 0; i < 4; i++) {
      const c = posAttr.getY(i) > 0 ? top : bot;
      bcol[i * 3] = c.r; bcol[i * 3 + 1] = c.g; bcol[i * 3 + 2] = c.b;
    }
    this.bgGeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
    this.bg = new THREE.Mesh(this.bgGeo, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
    this.bg.renderOrder = -1;

    this.group.add(this.bg);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'fishCount', 42)));
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  private spawn(f: Fish): void {
    f.dir = Math.random() < 0.5 ? 1 : -1;
    f.x = (Math.random() * 2 - 1) * 3.2;
    f.y = (Math.random() * 2 - 1) * 1.7;
    f.z = (Math.random() * 2 - 1) * 0.8;
    f.speed = 0.5 + Math.random() * 1.1;
    f.bob = Math.random() * Math.PI * 2;
    f.wag = Math.random() * Math.PI * 2;
    f.colorT = Math.random();
    f.binT = Math.random();
  }

  private rebuild(count: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.count = count;
    this.fish = [];
    for (let i = 0; i < count; i++) {
      const f: Fish = { x: 0, y: 0, z: 0, dir: 1, speed: 1, bob: 0, wag: 0, colorT: 0, binT: 0 };
      this.spawn(f);
      this.fish.push(f);
    }
    this.mesh = new THREE.InstancedMesh(this.fishGeo, this.fishMat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wanted = Math.round(num(params, 'fishCount', 42));
    if (wanted !== this.count) this.rebuild(wanted);
    const mesh = this.mesh;
    if (!mesh) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const speedP = num(params, 'speed', 1);
    const dart = num(params, 'dart', 1);
    const sizeP = num(params, 'size', 1);
    const swim = speedP * (0.4 + frame.level * 1.8 + this.beatPulse * dart * 2.2);

    for (let i = 0; i < this.count; i++) {
      const f = this.fish[i]!;
      f.x += dt * swim * f.speed * f.dir;
      if (f.x > 3.5) { this.spawn(f); f.x = -3.5; f.dir = 1; }
      else if (f.x < -3.5) { this.spawn(f); f.x = 3.5; f.dir = -1; }
      const band = frame.freq[logBin(f.binT, frame.binCount)]! / 255;
      const y = f.y + Math.sin(t * 1.5 + f.bob) * 0.12 + band * 0.15;
      const wag = Math.sin(t * (6 + frame.treble * 8) + f.wag) * 0.28;
      const s = 0.34 * sizeP * (0.85 + band * 0.5 + this.beatPulse * 0.3);
      this.dummy.position.set(f.x, y, f.z);
      this.dummy.rotation.set(0, 0, wag);
      this.dummy.scale.set(s * f.dir, s, s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.ctx.style.sample(f.colorT, this.color);
      this.color.multiplyScalar(0.8 + band * 0.6 + this.beatPulse * 0.3);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    this.bg.scale.set(h * (width / height), h, 1);
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.ctx?.scene.remove(this.group);
    this.fishGeo.dispose();
    this.fishMat.dispose();
    this.bgGeo.dispose();
    (this.bg.material as THREE.Material).dispose();
  }
}
