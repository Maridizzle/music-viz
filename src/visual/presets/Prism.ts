import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'beams', label: 'Spectrum beams', type: 'range', min: 8, max: 96, step: 1, default: 48 },
  { key: 'spread', label: 'Spread', type: 'range', min: 0.2, max: 1.6, step: 0.01, default: 0.9 },
  { key: 'beamLength', label: 'Beam length', type: 'range', min: 1, max: 4, step: 0.05, default: 2.4 },
  { key: 'rotation', label: 'Rotation', type: 'range', min: -1.5, max: 1.5, step: 0.01, default: 0.25 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
];

/** A spinning glass prism splitting a white beam into a reactive rainbow spectrum-fan. */
export class Prism implements Preset {
  readonly id = 'prism';
  readonly label = 'Prism';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private prismEdges!: THREE.LineSegments;
  private prismFill!: THREE.Mesh;
  private inBeam!: THREE.Line;
  private fan!: THREE.LineSegments;
  private prismGeo!: THREE.CylinderGeometry;
  private edgeGeo!: THREE.EdgesGeometry;
  private fanPos!: Float32Array;
  private fanCol!: Float32Array;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private readonly tmp = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;

    // triangular prism, cross-section facing the camera
    this.prismGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 3);
    this.prismGeo.rotateX(Math.PI / 2);
    this.prismGeo.rotateZ(Math.PI / 2);
    this.edgeGeo = new THREE.EdgesGeometry(this.prismGeo);
    this.prismEdges = new THREE.LineSegments(
      this.edgeGeo,
      new THREE.LineBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    this.prismFill = new THREE.Mesh(
      this.prismGeo,
      new THREE.MeshBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.08, toneMapped: false }),
    );

    const inGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3.6, 0, 0),
      new THREE.Vector3(-0.5, 0, 0),
    ]);
    this.inBeam = new THREE.Line(
      inGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, toneMapped: false }),
    );

    this.fan = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );

    this.group.add(this.prismFill, this.prismEdges, this.inBeam, this.fan);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'beams', 48)));
  }

  private rebuild(count: number): void {
    this.count = count;
    this.fanPos = new Float32Array(count * 2 * 3);
    this.fanCol = new Float32Array(count * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.fanPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.fanCol, 3));
    this.fan.geometry.dispose();
    this.fan.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'beams', 48));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const spread = num(params, 'spread', 0.9);
    const beamLength = num(params, 'beamLength', 2.4);
    const reactivity = num(params, 'reactivity', 1.6);
    const hueShift = this.ctx.style.hue;
    const ox = 0.5;

    const pos = this.fanPos;
    const col = this.fanCol;
    for (let i = 0; i < this.count; i++) {
      const f = this.count > 1 ? i / (this.count - 1) : 0.5;
      const band = frame.freq[logBin(f, frame.binCount)]! / 255;
      const angle = (f - 0.5) * spread * (1 + frame.treble * 0.6);
      const len = beamLength * (0.25 + band * reactivity + this.beatPulse * 0.3);
      const ex = ox + Math.cos(angle) * len;
      const ey = Math.sin(angle) * len;
      const o = i * 6;
      pos[o] = ox; pos[o + 1] = 0; pos[o + 2] = 0;
      pos[o + 3] = ex; pos[o + 4] = ey; pos[o + 5] = 0;

      // true spectrum red->violet, shiftable by the global hue control
      this.tmp.setHSL((f * 0.8 + hueShift) % 1, 1, 0.5);
      const bright = 0.35 + band * 1.4 + this.beatPulse * 0.5;
      const r = this.tmp.r * bright, g = this.tmp.g * bright, b = this.tmp.b * bright;
      // fade from the prism outward
      col[o] = r * 0.3; col[o + 1] = g * 0.3; col[o + 2] = b * 0.3;
      col[o + 3] = r; col[o + 4] = g; col[o + 5] = b;
    }
    (this.fan.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.fan.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    (this.inBeam.material as THREE.LineBasicMaterial).opacity = 0.3 + frame.level * 0.8 + this.beatPulse * 0.5;
    const emul = 0.7 + this.beatPulse * 0.6 + frame.level * 0.4;
    (this.prismEdges.material as THREE.LineBasicMaterial).opacity = Math.min(1, emul);

    this.group.rotation.z += dt * num(params, 'rotation', 0.25);
    this.group.rotation.z += frame.bass * dt * 0.6;
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.prismGeo.dispose();
    this.edgeGeo.dispose();
    this.fan.geometry.dispose();
    (this.prismEdges.material as THREE.Material).dispose();
    (this.prismFill.material as THREE.Material).dispose();
    (this.inBeam.material as THREE.Material).dispose();
    (this.inBeam.geometry as THREE.BufferGeometry).dispose();
    (this.fan.material as THREE.Material).dispose();
  }
}
