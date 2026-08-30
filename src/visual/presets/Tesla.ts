import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'bolts', label: 'Bolts', type: 'range', min: 4, max: 40, step: 1, default: 18 },
  { key: 'jaggedness', label: 'Jaggedness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'radius', label: 'Reach', type: 'range', min: 1, max: 3, step: 0.05, default: 2.1 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
];

const S = 12; // segments per bolt
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/** Lightning arcs crackling from a central core, flashing on transients. */
export class Tesla implements Preset {
  readonly id = 'tesla';
  readonly label = 'Tesla';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;
  private lines!: THREE.LineSegments;
  private core!: THREE.Mesh;
  private coreGeo!: THREE.IcosahedronGeometry;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private ends: THREE.Vector3[] = [];
  private p1: THREE.Vector3[] = [];
  private p2: THREE.Vector3[] = [];
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private regen = 0;

  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.coreGeo = new THREE.IcosahedronGeometry(0.14, 2);
    this.core = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false }));
    this.group.add(this.lines, this.core);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'bolts', 18)));
  }

  private randomDir(out: THREE.Vector3): THREE.Vector3 {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return out.set(Math.cos(th) * s, u, Math.sin(th) * s);
  }

  private rebuild(count: number): void {
    this.count = count;
    this.positions = new Float32Array(count * S * 2 * 3);
    this.colors = new Float32Array(count * S * 2 * 3);
    this.ends = [];
    this.p1 = [];
    this.p2 = [];
    for (let i = 0; i < count; i++) {
      const d = this.randomDir(new THREE.Vector3());
      this.ends.push(d);
      const perp1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? SIDE : UP).normalize();
      const perp2 = new THREE.Vector3().crossVectors(d, perp1).normalize();
      this.p1.push(perp1);
      this.p2.push(perp2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
    this.geometry = geo;
  }

  private reseat(i: number): void {
    const d = this.randomDir(this.ends[i]!);
    this.p1[i]!.crossVectors(d, Math.abs(d.y) > 0.9 ? SIDE : UP).normalize();
    this.p2[i]!.crossVectors(d, this.p1[i]!).normalize();
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'bolts', 18));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 6), frame.beat ? frame.beatEnergy : 0);
    const jag = num(params, 'jaggedness', 0.5);
    const radius = num(params, 'radius', 2.1);
    const react = num(params, 'reactivity', 1.5);
    const activeProb = 0.15 + frame.treble * 0.6 * react + this.beatPulse * 0.8;

    this.regen += dt;
    const doReseat = frame.beat || this.regen > 0.25;
    if (this.regen > 0.25) this.regen = 0;

    this.ctx.style.sample(0.55, this.color);
    // electric tint: blend palette with white-blue
    const br = 0.5 + frame.treble * 1.0 + this.beatPulse * 1.4;
    const cr = (this.color.r * 0.4 + 0.6) * br;
    const cg = (this.color.g * 0.4 + 0.85) * br;
    const cb = (this.color.b * 0.4 + 1.0) * br;

    const P = this.positions, C = this.colors;
    for (let i = 0; i < this.count; i++) {
      if (doReseat && Math.random() < 0.5) this.reseat(i);
      const on = Math.random() < activeProb;
      const d = this.ends[i]!, perp1 = this.p1[i]!, perp2 = this.p2[i]!;
      let px = 0, py = 0, pz = 0; // start at core
      for (let s = 0; s < S; s++) {
        const t0 = s / S;
        const t1 = (s + 1) / S;
        // segment start = previous point
        this.a.set(px, py, pz);
        // next point along the bolt with jitter
        const midMag = jag * Math.sin(Math.PI * t1) * radius * 0.4;
        const off1 = (Math.random() - 0.5) * 2 * midMag;
        const off2 = (Math.random() - 0.5) * 2 * midMag;
        const base = radius * t1;
        this.b.copy(d).multiplyScalar(base).addScaledVector(perp1, off1).addScaledVector(perp2, off2);
        if (s === S - 1) this.b.copy(d).multiplyScalar(radius);
        px = this.b.x; py = this.b.y; pz = this.b.z;

        const o = (i * S + s) * 6;
        P[o] = this.a.x; P[o + 1] = this.a.y; P[o + 2] = this.a.z;
        P[o + 3] = this.b.x; P[o + 4] = this.b.y; P[o + 5] = this.b.z;
        const fade = on ? 1 - t0 * 0.4 : 0;
        C[o] = cr * fade; C[o + 1] = cg * fade; C[o + 2] = cb * fade;
        C[o + 3] = cr * fade; C[o + 4] = cg * fade; C[o + 5] = cb * fade;
      }
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    const cs = 1 + frame.bass * 0.8 + this.beatPulse * 1.2;
    this.core.scale.setScalar(cs);
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(cr, cg, cb);
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
    this.coreGeo.dispose();
    (this.core.material as THREE.Material).dispose();
  }
}
