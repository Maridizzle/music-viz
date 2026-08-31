import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'pipeCount', label: 'Pipes', type: 'range', min: 1, max: 6, step: 1, default: 3 },
  { key: 'growSpeed', label: 'Draw speed', type: 'range', min: 1, max: 24, step: 0.5, default: 7 },
  { key: 'thickness', label: 'Thickness', type: 'range', min: 0.02, max: 0.22, step: 0.005, default: 0.07 },
  { key: 'trail', label: 'Length', type: 'range', min: 10, max: 80, step: 1, default: 44 },
  { key: 'turnChance', label: 'Turn chance', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1.4 },
];

const STEP = 0.34;
const HALF = 1.7; // lattice bounds (half-extent)
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const UP = new THREE.Vector3(0, 1, 0);

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}
interface Pipe {
  segments: Segment[];
  head: THREE.Vector3;
  dir: THREE.Vector3;
  grow: number;
  baseT: number;
}

/** Pipes that draw themselves segment-by-segment; draw speed and thickness ride the music. */
export class Pipes implements Preset {
  readonly id = 'pipes';
  readonly label = 'Pipes';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private cylGeo!: THREE.CylinderGeometry;
  private jointGeo!: THREE.IcosahedronGeometry;
  private material!: THREE.MeshBasicMaterial;
  private cylMesh: THREE.InstancedMesh | null = null;
  private jointMesh: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private pipes: Pipe[] = [];
  private count = 0;
  private trail = 0;
  private beatPulse = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly quat = new THREE.Quaternion();
  private readonly mid = new THREE.Vector3();
  private readonly seg = new THREE.Vector3();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.jointGeo = new THREE.IcosahedronGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'pipeCount', 3)), Math.round(num(params, 'trail', 44)));
  }

  private inBounds(p: THREE.Vector3): boolean {
    return Math.abs(p.x) <= HALF && Math.abs(p.y) <= HALF && Math.abs(p.z) <= HALF;
  }

  private newPipe(i: number, total: number): Pipe {
    const head = new THREE.Vector3(
      Math.round((Math.random() * 2 - 1) * 3) * STEP,
      Math.round((Math.random() * 2 - 1) * 3) * STEP,
      Math.round((Math.random() * 2 - 1) * 3) * STEP,
    );
    return { segments: [], head, dir: AXES[Math.floor(Math.random() * 6)]!.clone(), grow: 0, baseT: i / Math.max(1, total) };
  }

  private rebuild(count: number, trail: number): void {
    if (this.cylMesh) {
      this.group.remove(this.cylMesh);
      this.cylMesh.dispose();
    }
    if (this.jointMesh) {
      this.group.remove(this.jointMesh);
      this.jointMesh.dispose();
    }
    this.count = count;
    this.trail = trail;
    const cap = count * trail;
    this.cylMesh = new THREE.InstancedMesh(this.cylGeo, this.material, cap);
    this.jointMesh = new THREE.InstancedMesh(this.jointGeo, this.material, cap);
    this.cylMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.jointMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.cylMesh, this.jointMesh);
    this.pipes = [];
    for (let i = 0; i < count; i++) this.pipes.push(this.newPipe(i, count));
  }

  private advance(pipe: Pipe, thickness: number, bass: number): void {
    // choose the next direction: usually continue straight, else turn, staying in bounds
    const straight = this.tempStep(pipe.head, pipe.dir);
    let dir = pipe.dir;
    if (Math.random() < this.currentTurnChance || !this.inBounds(straight)) {
      const options = AXES.filter((d) => d.dot(pipe.dir) > -0.5 && this.inBounds(this.tempStep(pipe.head, d)));
      dir = (options.length ? options[Math.floor(Math.random() * options.length)]! : pipe.dir).clone();
    }
    const a = pipe.head.clone();
    const b = this.tempStep(pipe.head, dir);
    if (!this.inBounds(b)) {
      // cornered — respawn this pipe near the middle
      const fresh = this.newPipe(0, 1);
      fresh.baseT = pipe.baseT;
      Object.assign(pipe, fresh);
      return;
    }
    pipe.segments.push({ a, b, radius: thickness * (0.5 + bass * 1.6) });
    pipe.head = b;
    pipe.dir = dir;
    if (pipe.segments.length > this.trail) pipe.segments.shift();
  }

  private currentTurnChance = 0.4;
  private tempStep(head: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
    return this.seg.copy(dir).multiplyScalar(STEP).add(head).clone();
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wantCount = Math.round(num(params, 'pipeCount', 3));
    const wantTrail = Math.round(num(params, 'trail', 44));
    if (wantCount !== this.count || wantTrail !== this.trail) this.rebuild(wantCount, wantTrail);
    const cyl = this.cylMesh;
    const joint = this.jointMesh;
    if (!cyl || !joint) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 3), frame.beat ? frame.beatEnergy : 0);
    this.currentTurnChance = num(params, 'turnChance', 0.4);
    const thickness = num(params, 'thickness', 0.07);
    const glow = num(params, 'glow', 1.4);
    const speed = num(params, 'growSpeed', 7) * (0.4 + frame.level * 2 + this.beatPulse * 2);

    for (const pipe of this.pipes) {
      pipe.grow += dt * speed;
      let guard = 0;
      while (pipe.grow >= 1 && guard++ < 8) {
        pipe.grow -= 1;
        this.advance(pipe, thickness, frame.bass);
      }
    }

    // write instances
    let ci = 0;
    const brightness = glow * (0.55 + frame.level * 0.7 + this.beatPulse * 0.6);
    for (const pipe of this.pipes) {
      this.ctx.style.sample(pipe.baseT, this.color);
      this.color.multiplyScalar(brightness);
      for (const s of pipe.segments) {
        const len = s.a.distanceTo(s.b);
        this.mid.copy(s.a).add(s.b).multiplyScalar(0.5);
        this.seg.copy(s.b).sub(s.a).normalize();
        this.quat.setFromUnitVectors(UP, this.seg);
        this.dummy.position.copy(this.mid);
        this.dummy.quaternion.copy(this.quat);
        this.dummy.scale.set(s.radius, len, s.radius);
        this.dummy.updateMatrix();
        cyl.setMatrixAt(ci, this.dummy.matrix);
        cyl.setColorAt(ci, this.color);
        // joint sphere at the far end
        this.dummy.position.copy(s.b);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(s.radius * 1.15);
        this.dummy.updateMatrix();
        joint.setMatrixAt(ci, this.dummy.matrix);
        joint.setColorAt(ci, this.color);
        ci++;
      }
    }
    // hide unused instances
    this.dummy.scale.setScalar(0);
    this.dummy.position.set(0, 0, 0);
    this.dummy.quaternion.identity();
    this.dummy.updateMatrix();
    const cap = this.count * this.trail;
    for (let i = ci; i < cap; i++) {
      cyl.setMatrixAt(i, this.dummy.matrix);
      joint.setMatrixAt(i, this.dummy.matrix);
    }
    cyl.instanceMatrix.needsUpdate = true;
    joint.instanceMatrix.needsUpdate = true;
    if (cyl.instanceColor) cyl.instanceColor.needsUpdate = true;
    if (joint.instanceColor) joint.instanceColor.needsUpdate = true;

    this.group.rotation.y += dt * 0.12;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    if (this.cylMesh) {
      this.group.remove(this.cylMesh);
      this.cylMesh.dispose();
      this.cylMesh = null;
    }
    if (this.jointMesh) {
      this.group.remove(this.jointMesh);
      this.jointMesh.dispose();
      this.jointMesh = null;
    }
    this.ctx?.scene.remove(this.group);
    this.cylGeo.dispose();
    this.jointGeo.dispose();
    this.material.dispose();
  }
}
