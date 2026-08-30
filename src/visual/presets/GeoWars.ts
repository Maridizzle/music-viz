import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'triangleCount', label: 'Links', type: 'range', min: 8, max: 90, step: 1, default: 32 },
  { key: 'flowSpeed', label: 'Flow speed', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.22 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 3, step: 0.01, default: 0.6 },
  { key: 'spiral', label: 'Spiral', type: 'range', min: 0, max: 8, step: 0.05, default: 0.9 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
];

const TWO_PI = Math.PI * 2;
const FAR = -13;
const NEAR = 5; // in front of the camera (z≈3.8) so triangles pass through the viewer

/** A rotating tunnel of neon triangles flowing toward and through the camera — the classic screensaver. */
export class GeoWars implements Preset {
  readonly id = 'geowars';
  readonly label = 'Geo Wars';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private triGeo!: THREE.BufferGeometry;
  private loops: THREE.LineLoop[] = [];
  private mats: THREE.LineBasicMaterial[] = [];
  private depth: number[] = [];
  private sizeVar: number[] = [];
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private spinPhase = 0;
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    const verts = new Float32Array(9);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TWO_PI + Math.PI / 2;
      verts[k * 3] = Math.cos(a);
      verts[k * 3 + 1] = Math.sin(a);
      verts[k * 3 + 2] = 0;
    }
    this.triGeo = new THREE.BufferGeometry();
    this.triGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'triangleCount', 60)));
  }

  private rebuild(count: number): void {
    for (const l of this.loops) this.group.remove(l);
    for (const m of this.mats) m.dispose();
    this.loops = [];
    this.mats = [];
    this.depth = new Array(count);
    this.sizeVar = new Array(count);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.LineBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const loop = new THREE.LineLoop(this.triGeo, mat);
      loop.renderOrder = 2;
      this.mats.push(mat);
      this.loops.push(loop);
      this.group.add(loop);
      this.depth[i] = i / count; // evenly spaced down the tunnel
      this.sizeVar[i] = 0.72 + Math.random() * 0.12;
    }
    this.count = count;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'triangleCount', 60));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const flowSpeed = num(params, 'flowSpeed', 0.22);
    const spin = num(params, 'spin', 0.6);
    const spiral = num(params, 'spiral', 3);
    const reactivity = num(params, 'reactivity', 1.6);

    const flow = flowSpeed * (0.35 + frame.level * 2.2 + this.beatPulse * 2);
    this.spinPhase += dt * spin * (0.5 + frame.treble * 1.6);
    const pulse = 0.7 + Math.min(1.6, (frame.bass * 0.9 + this.beatPulse * 0.7) * reactivity);
    const bright = 0.4 + frame.level * 1.4 + this.beatPulse * 0.8;

    for (let i = 0; i < this.count; i++) {
      let d = this.depth[i]! + dt * flow;
      d -= Math.floor(d);
      this.depth[i] = d;

      const loop = this.loops[i]!;
      loop.position.z = FAR + d * (NEAR - FAR);
      // Interlock like chain links: alternate links sit edge-on / face-on so each
      // triangle threads THROUGH its neighbours instead of nesting flat.
      const flip = (i % 2) * (Math.PI / 2);
      const twist = d * spiral * TWO_PI + this.spinPhase;
      loop.rotation.set(flip, flip * 0.6, twist);
      loop.scale.setScalar(this.sizeVar[i]! * pulse);

      const fadeIn = Math.min(1, d / 0.12);
      const fadeOut = Math.min(1, (1 - d) / 0.16);
      const mat = this.mats[i]!;
      mat.opacity = Math.min(fadeIn, fadeOut);
      this.ctx.style.sample(d, this.color);
      mat.color.copy(this.color).multiplyScalar(bright);
    }
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    for (const l of this.loops) this.group.remove(l);
    for (const m of this.mats) m.dispose();
    this.loops = [];
    this.mats = [];
    this.ctx?.scene.remove(this.group);
    this.triGeo.dispose();
  }
}
