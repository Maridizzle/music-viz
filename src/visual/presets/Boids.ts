import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'count', label: 'Boids', type: 'range', min: 20, max: 300, step: 5, default: 150 },
  { key: 'speed', label: 'Speed', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1 },
  { key: 'separation', label: 'Separation', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
  { key: 'alignment', label: 'Alignment', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'cohesion', label: 'Cohesion', type: 'range', min: 0, max: 3, step: 0.01, default: 0.9 },
  { key: 'beatDart', label: 'Beat dart', type: 'range', min: 0, max: 3, step: 0.01, default: 1.3 },
];

const MAXCOUNT = 300;
const BOUND = 1.75;
const SOFT = BOUND * 0.82;
const NEIGHBOR = 0.55;
const NEIGHBOR2 = NEIGHBOR * NEIGHBOR;
const SEP = 0.24;
const SEP2 = SEP * SEP;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A flocking swarm of neon darts (classic Reynolds boids: separation / alignment /
 * cohesion on a CPU O(n²) neighbourhood). The swarm speeds up with loudness and
 * bursts apart on every beat, then regroups — reads as a shoal reacting to the music.
 */
export class Boids implements Preset {
  readonly id = 'boids';
  readonly label = 'Boids Swarm';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.ConeGeometry;
  private material!: THREE.MeshBasicMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;

  private px = new Float32Array(MAXCOUNT);
  private py = new Float32Array(MAXCOUNT);
  private pz = new Float32Array(MAXCOUNT);
  private vx = new Float32Array(MAXCOUNT);
  private vy = new Float32Array(MAXCOUNT);
  private vz = new Float32Array(MAXCOUNT);
  private colorT = new Float32Array(MAXCOUNT);

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly dir = new THREE.Vector3();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    // Cone points along +Y; we orient +Y to each boid's velocity so the tip leads.
    this.geometry = new THREE.ConeGeometry(0.085, 0.34, 5);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'count', 150)));
  }

  private rebuild(count: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.count = count;
    for (let i = 0; i < count; i++) {
      this.px[i] = (Math.random() * 2 - 1) * BOUND * 0.7;
      this.py[i] = (Math.random() * 2 - 1) * BOUND * 0.7;
      this.pz[i] = (Math.random() * 2 - 1) * BOUND * 0.7;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      this.vx[i] = Math.cos(a) * Math.cos(b);
      this.vy[i] = Math.sin(b);
      this.vz[i] = Math.sin(a) * Math.cos(b);
      this.colorT[i] = Math.random();
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'count', 150));
    if (wanted !== this.count) this.rebuild(wanted);
    const mesh = this.mesh;
    if (!mesh) return;

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);

    const wSep = num(params, 'separation', 1.5);
    const wAli = num(params, 'alignment', 1);
    const wCoh = num(params, 'cohesion', 0.9);
    const speed = num(params, 'speed', 1);
    const beatDart = num(params, 'beatDart', 1.3);

    const maxSpeed = speed * (0.5 + frame.level * 1.9 + this.beatPulse * 1.6);
    const step = Math.min(dt, 0.05); // clamp so a frame hitch can't explode the sim
    const n = this.count;
    const { px, py, pz, vx, vy, vz } = this;

    for (let i = 0; i < n; i++) {
      const xi = px[i]!;
      const yi = py[i]!;
      const zi = pz[i]!;
      let sepx = 0;
      let sepy = 0;
      let sepz = 0;
      let alx = 0;
      let aly = 0;
      let alz = 0;
      let cox = 0;
      let coy = 0;
      let coz = 0;
      let cnt = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = xi - px[j]!;
        const dy = yi - py[j]!;
        const dz = zi - pz[j]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > NEIGHBOR2 || d2 === 0) continue;
        if (d2 < SEP2) {
          const inv = 1 / Math.sqrt(d2);
          sepx += dx * inv;
          sepy += dy * inv;
          sepz += dz * inv;
        }
        alx += vx[j]!;
        aly += vy[j]!;
        alz += vz[j]!;
        cox += px[j]!;
        coy += py[j]!;
        coz += pz[j]!;
        cnt++;
      }
      let ax = sepx * wSep;
      let ay = sepy * wSep;
      let az = sepz * wSep;
      if (cnt > 0) {
        ax += (alx / cnt) * wAli + ((cox / cnt) - xi) * wCoh;
        ay += (aly / cnt) * wAli + ((coy / cnt) - yi) * wCoh;
        az += (alz / cnt) * wAli + ((coz / cnt) - zi) * wCoh;
      }
      // steer back toward the centre once past the soft radius
      const r2 = xi * xi + yi * yi + zi * zi;
      if (r2 > SOFT * SOFT) {
        const r = Math.sqrt(r2) || 1;
        const pull = (r - SOFT) * 6;
        ax -= (xi / r) * pull;
        ay -= (yi / r) * pull;
        az -= (zi / r) * pull;
      }
      // beat: burst radially outward + scatter
      if (frame.beat) {
        const r = Math.sqrt(r2) || 1;
        const b = beatDart * frame.beatEnergy;
        ax += (xi / r) * b * 1.5 + (Math.random() - 0.5) * b * 2.2;
        ay += (yi / r) * b * 1.5 + (Math.random() - 0.5) * b * 2.2;
        az += (zi / r) * b * 1.5 + (Math.random() - 0.5) * b * 2.2;
      }
      // clamp acceleration
      const am2 = ax * ax + ay * ay + az * az;
      if (am2 > 64) {
        const s = 8 / Math.sqrt(am2);
        ax *= s;
        ay *= s;
        az *= s;
      }
      vx[i]! += ax * step;
      vy[i]! += ay * step;
      vz[i]! += az * step;
      // clamp speed to the audio-driven target (with a floor so they never stall)
      const sp = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]! + vz[i]! * vz[i]!) || 1;
      const sc = Math.max(0.18, maxSpeed) / sp;
      vx[i]! *= sc;
      vy[i]! *= sc;
      vz[i]! *= sc;
    }

    const stretch = 1 + frame.level * 0.5 + this.beatPulse * 0.4;
    const base = 0.7 + this.beatPulse * 0.5;
    for (let i = 0; i < n; i++) {
      px[i]! += vx[i]! * step;
      py[i]! += vy[i]! * step;
      pz[i]! += vz[i]! * step;
      const r2 = px[i]! * px[i]! + py[i]! * py[i]! + pz[i]! * pz[i]!;
      if (r2 > BOUND * BOUND) {
        const s = BOUND / Math.sqrt(r2);
        px[i]! *= s;
        py[i]! *= s;
        pz[i]! *= s;
      }
      this.dir.set(vx[i]!, vy[i]!, vz[i]!);
      const spd = this.dir.length() || 1;
      this.dir.multiplyScalar(1 / spd);
      this.dummy.position.set(px[i]!, py[i]!, pz[i]!);
      this.dummy.quaternion.setFromUnitVectors(UP, this.dir);
      this.dummy.scale.set(base, base * stretch, base);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.ctx.style.sample(this.colorT[i]!, this.color);
      this.color.multiplyScalar(0.7 + frame.level * 0.5 + this.beatPulse * 0.7);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.rotation.y += dt * 0.05;
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
    this.geometry.dispose();
    this.material.dispose();
  }
}
