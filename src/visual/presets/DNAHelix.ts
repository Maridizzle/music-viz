import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'steps', label: 'Steps', type: 'range', min: 24, max: 64, step: 2, default: 40 },
  { key: 'radius', label: 'Radius', type: 'range', min: 0.4, max: 1.2, step: 0.01, default: 0.7 },
  { key: 'twist', label: 'Twist', type: 'range', min: 1, max: 6, step: 0.01, default: 3 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'beatPop', label: 'Beat pop', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

const H = 1.6; // half-height of the helix column

export class DNAHelix implements Preset {
  readonly id = 'dna';
  readonly label = 'DNA Helix';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private sphereGeo!: THREE.IcosahedronGeometry;
  private rungGeo!: THREE.CylinderGeometry;
  private sphereMat!: THREE.MeshBasicMaterial;
  private rungMat!: THREE.MeshBasicMaterial;
  private backbone: THREE.InstancedMesh | null = null; // 2 strands: A = i, B = steps + i
  private rungs: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private steps = 0;
  private spinPhase = 0;
  private beatPulse = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0); // cylinder axis

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.sphereGeo = new THREE.IcosahedronGeometry(0.06, 1);
    this.rungGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
    this.sphereMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.rungMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'steps', 40)));
  }

  private rebuild(steps: number): void {
    if (this.backbone) {
      this.group.remove(this.backbone);
      this.backbone.dispose();
      this.backbone = null;
    }
    if (this.rungs) {
      this.group.remove(this.rungs);
      this.rungs.dispose();
      this.rungs = null;
    }
    this.steps = steps;
    this.backbone = new THREE.InstancedMesh(this.sphereGeo, this.sphereMat, steps * 2);
    this.backbone.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rungs = new THREE.InstancedMesh(this.rungGeo, this.rungMat, steps);
    this.rungs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.backbone, this.rungs);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const steps = Math.round(num(params, 'steps', 40));
    if (steps !== this.steps) this.rebuild(steps);
    const backbone = this.backbone;
    const rungs = this.rungs;
    if (!backbone || !rungs) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const radius = num(params, 'radius', 0.7);
    const twist = num(params, 'twist', 3);
    const spin = num(params, 'spin', 1);
    const beatPop = num(params, 'beatPop', 1);

    // spin is baked into theta so the group stays upright (no double-rotate); gentle sway only.
    this.spinPhase += dt * spin * (0.5 + frame.level);
    this.group.rotation.z = Math.sin(t * 0.5) * 0.12;

    const bp = this.beatPulse * beatPop; // beat pop scales the whole beat response
    const s = 1 + frame.level * 0.6 + bp * 0.5; // sphere pulse scale
    const backboneBright = 0.6 + frame.level + bp * 0.6;
    const denom = steps > 1 ? steps - 1 : 1;

    for (let i = 0; i < steps; i++) {
      const p = i / denom;
      const y = -H + p * 2 * H;
      const theta = p * twist * Math.PI * 2 + this.spinPhase;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      this.a.set(ct * radius, y, st * radius);
      this.b.set(-ct * radius, y, -st * radius);

      // --- backbone spheres (strand A = i, strand B = steps + i) ---
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.position.copy(this.a);
      this.dummy.updateMatrix();
      backbone.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.copy(this.b);
      this.dummy.updateMatrix();
      backbone.setMatrixAt(steps + i, this.dummy.matrix);
      this.ctx.style.sample(p, this.color);
      this.color.multiplyScalar(backboneBright);
      backbone.setColorAt(i, this.color);
      backbone.setColorAt(steps + i, this.color);

      // --- ladder rung: cylinder oriented +Y -> (B - A), spanning the pair ---
      const band = frame.freq[logBin(p, frame.binCount)]! / 255;
      this.dir.subVectors(this.b, this.a).normalize();
      const len = this.a.distanceTo(this.b); // = 2 * radius
      const thick = 0.6 + band;
      this.dummy.quaternion.setFromUnitVectors(this.up, this.dir);
      this.dummy.scale.set(thick, len, thick);
      this.dummy.position.set(0, y, 0); // midpoint (A + B) / 2
      this.dummy.updateMatrix();
      rungs.setMatrixAt(i, this.dummy.matrix);
      this.ctx.style.sample((p + 0.5) % 1, this.color);
      this.color.multiplyScalar(0.3 + band * 1.6 + bp * 0.4);
      rungs.setColorAt(i, this.color);
    }

    backbone.instanceMatrix.needsUpdate = true;
    if (backbone.instanceColor) backbone.instanceColor.needsUpdate = true;
    rungs.instanceMatrix.needsUpdate = true;
    if (rungs.instanceColor) rungs.instanceColor.needsUpdate = true;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    if (this.backbone) {
      this.group.remove(this.backbone);
      this.backbone.dispose();
      this.backbone = null;
    }
    if (this.rungs) {
      this.group.remove(this.rungs);
      this.rungs.dispose();
      this.rungs = null;
    }
    this.ctx?.scene.remove(this.group);
    this.sphereGeo.dispose();
    this.rungGeo.dispose();
    this.sphereMat.dispose();
    this.rungMat.dispose();
  }
}
