import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'beamsPer', label: 'Beams / emitter', type: 'range', min: 2, max: 14, step: 1, default: 7 },
  { key: 'sweepSpeed', label: 'Sweep speed', type: 'range', min: 0, max: 3, step: 0.01, default: 0.8 },
  { key: 'fanSpread', label: 'Fan spread', type: 'range', min: 0.1, max: 1.4, step: 0.01, default: 0.6 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
];

interface Emitter { x: number; y: number; base: number; phase: number; }
const EMITTERS: Emitter[] = [
  { x: -1.7, y: -1.25, base: 0.95, phase: 0 },
  { x: 1.7, y: -1.25, base: 2.19, phase: 1.7 },
  { x: 0, y: 1.4, base: -Math.PI / 2, phase: 3.3 },
];
const LEN = 5.5;

export class Lasers implements Preset {
  readonly id = 'lasers';
  readonly label = 'Dancing Lasers';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;
  private lines!: THREE.LineSegments;
  private positions!: Float32Array;
  private colors!: Float32Array;
  private ctx!: PresetContext;
  private beamsPer = 0;
  private beatPulse = 0;
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.group.add(this.lines);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'beamsPer', 7)));
  }

  private rebuild(beamsPer: number): void {
    this.beamsPer = beamsPer;
    const total = EMITTERS.length * beamsPer;
    this.positions = new Float32Array(total * 2 * 3);
    this.colors = new Float32Array(total * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
    this.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wanted = Math.round(num(params, 'beamsPer', 7));
    if (wanted !== this.beamsPer) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 6), frame.beat ? frame.beatEnergy : 0);
    const sweepSpeed = num(params, 'sweepSpeed', 0.8);
    const react = num(params, 'reactivity', 1.6);
    const fan = num(params, 'fanSpread', 0.6) * (0.6 + frame.treble * 1.4 + this.beatPulse * 0.6);
    const bright = 0.35 + frame.level * 1.1 * react + this.beatPulse * 1.8;

    const P = this.positions;
    const C = this.colors;
    let vi = 0;
    for (let e = 0; e < EMITTERS.length; e++) {
      const em = EMITTERS[e]!;
      this.ctx.style.sample(e / (EMITTERS.length - 1), this.color);
      const center = em.base + Math.sin(t * sweepSpeed + em.phase) * 0.6 + frame.bass * 0.4;
      const r = this.color.r * bright, g = this.color.g * bright, b = this.color.b * bright;
      for (let j = 0; j < this.beamsPer; j++) {
        const f = this.beamsPer > 1 ? j / (this.beamsPer - 1) - 0.5 : 0;
        const ang = center + f * fan;
        const ex = em.x + Math.cos(ang) * LEN;
        const ey = em.y + Math.sin(ang) * LEN;
        const o = vi * 6;
        P[o] = em.x; P[o + 1] = em.y; P[o + 2] = 0;
        P[o + 3] = ex; P[o + 4] = ey; P[o + 5] = 0;
        // bright at the emitter, fading along the beam
        C[o] = r; C[o + 1] = g; C[o + 2] = b;
        C[o + 3] = r * 0.5; C[o + 4] = g * 0.5; C[o + 5] = b * 0.5;
        vi++;
      }
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
