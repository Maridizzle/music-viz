import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'tendrils', label: 'Tendrils', type: 'range', min: 3, max: 18, step: 1, default: 9 },
  { key: 'jaggedness', label: 'Jaggedness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'wander', label: 'Wander', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
];

const S = 10;
const R = 1.45;
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

interface Tendril { cur: THREE.Vector3; target: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; }

export class PlasmaGlobe implements Preset {
  readonly id = 'plasmaglobe';
  readonly label = 'Plasma Globe';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;
  private lines!: THREE.LineSegments;
  private glassGeo!: THREE.SphereGeometry;
  private glass!: THREE.Mesh;
  private coreGeo!: THREE.IcosahedronGeometry;
  private core!: THREE.Mesh;
  private tipGeo!: THREE.BufferGeometry;
  private tips!: THREE.Points;
  private tipPos!: Float32Array;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private tendrils: Tendril[] = [];
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.glassGeo = new THREE.SphereGeometry(R, 22, 14);
    this.glass = new THREE.Mesh(this.glassGeo, new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.12, color: 0x88aaff, toneMapped: false }));
    this.coreGeo = new THREE.IcosahedronGeometry(0.17, 2);
    this.core = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({ color: 0xd8ccff, toneMapped: false }));
    this.tips = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.3, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xc9b8ff }));
    this.group.add(this.glass, this.lines, this.tips, this.core);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'tendrils', 9)));
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
    this.tipPos = new Float32Array(count * 3);
    this.tendrils = [];
    for (let i = 0; i < count; i++) {
      const cur = this.randomDir(new THREE.Vector3());
      this.tendrils.push({ cur, target: this.randomDir(new THREE.Vector3()), p1: new THREE.Vector3(), p2: new THREE.Vector3() });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
    this.geometry = geo;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tipPos, 3));
    this.tips.geometry.dispose();
    this.tips.geometry = tg;
    this.tipGeo = tg;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'tendrils', 9));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 5), frame.beat ? frame.beatEnergy : 0);
    const jag = num(params, 'jaggedness', 0.45);
    const wander = num(params, 'wander', 1);
    const react = num(params, 'reactivity', 1.6);

    const bright = 0.4 + frame.treble * 0.9 * react + this.beatPulse * 1.3;
    this.ctx.style.sample(0.6, this.color);
    const cr = (this.color.r * 0.5 + 0.5) * bright;
    const cg = (this.color.g * 0.5 + 0.35) * bright;
    const cb = (this.color.b * 0.5 + 0.8) * bright;

    const P = this.positions, C = this.colors, T = this.tipPos;
    for (let i = 0; i < this.count; i++) {
      const td = this.tendrils[i]!;
      if (frame.beat && Math.random() < 0.4) this.randomDir(td.target);
      // drift current direction toward the target, then re-normalise onto the sphere
      td.cur.lerp(td.target, Math.min(1, dt * (0.6 + wander * 1.4))).normalize();
      const perp1 = td.p1.crossVectors(td.cur, Math.abs(td.cur.y) > 0.9 ? SIDE : UP).normalize();
      const perp2 = td.p2.crossVectors(td.cur, perp1).normalize();

      let px = 0, py = 0, pz = 0;
      for (let s = 0; s < S; s++) {
        const t1 = (s + 1) / S;
        this.a.set(px, py, pz);
        const mag = jag * Math.sin(Math.PI * t1) * R * 0.28;
        this.b.copy(td.cur).multiplyScalar(R * t1)
          .addScaledVector(perp1, (Math.random() - 0.5) * 2 * mag)
          .addScaledVector(perp2, (Math.random() - 0.5) * 2 * mag);
        if (s === S - 1) this.b.copy(td.cur).multiplyScalar(R);
        px = this.b.x; py = this.b.y; pz = this.b.z;
        const o = (i * S + s) * 6;
        P[o] = this.a.x; P[o + 1] = this.a.y; P[o + 2] = this.a.z;
        P[o + 3] = this.b.x; P[o + 4] = this.b.y; P[o + 5] = this.b.z;
        C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
        C[o + 3] = cr; C[o + 4] = cg; C[o + 5] = cb;
      }
      T[i * 3] = td.cur.x * R; T[i * 3 + 1] = td.cur.y * R; T[i * 3 + 2] = td.cur.z * R;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.tipGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    const cs = 1 + frame.bass * 0.7 + this.beatPulse * 1.0;
    this.core.scale.setScalar(cs);
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(Math.min(1.5, cr), Math.min(1.5, cg), Math.min(1.5, cb));
    this.group.rotation.y += dt * 0.15;
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
    this.glassGeo.dispose();
    (this.glass.material as THREE.Material).dispose();
    this.coreGeo.dispose();
    (this.core.material as THREE.Material).dispose();
    this.tipGeo.dispose();
    (this.tips.material as THREE.Material).dispose();
  }
}
