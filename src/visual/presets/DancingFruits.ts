import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'fruitCount', label: 'Fruits', type: 'range', min: 3, max: 9, step: 1, default: 7 },
  { key: 'bounce', label: 'Bounce', type: 'range', min: 0.2, max: 1.6, step: 0.01, default: 0.75 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.6 },
];

const FRUIT_COLORS = ['#e23b3b', '#ff8c1a', '#ffe23b', '#7ed957', '#a44bff', '#4b7bff', '#ff4b8b', '#2ee6c4', '#ff5edb'];

interface Fruit {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  binT: number;
  phase: number;
}

export class DancingFruits implements Preset {
  readonly id = 'fruits';
  readonly label = 'Dancing Fruits';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private sphereGeo!: THREE.SphereGeometry;
  private leafGeo!: THREE.ConeGeometry;
  private leafMat!: THREE.MeshStandardMaterial;
  private lights = new THREE.Group();
  private ctx!: PresetContext;
  private fruits: Fruit[] = [];
  private count = 0;
  private beatPulse = 0;

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.sphereGeo = new THREE.SphereGeometry(0.32, 28, 20);
    this.leafGeo = new THREE.ConeGeometry(0.09, 0.22, 5);
    this.leafMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.6 });
    const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 0.9);
    const key = new THREE.PointLight(0xffffff, 1.0);
    key.position.set(2.5, 4, 4);
    const fill = new THREE.PointLight(0x99bbff, 0.5);
    fill.position.set(-3, -1, 2);
    this.lights.add(hemi, key, fill);
    ctx.scene.add(this.lights, this.group);
    this.rebuild(Math.round(num(params, 'fruitCount', 7)));
  }

  private rebuild(count: number): void {
    for (const f of this.fruits) {
      this.group.remove(f.group);
      f.mat.dispose();
    }
    this.fruits = [];
    this.count = count;
    const spacing = 0.72;
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      g.position.x = (i - (count - 1) / 2) * spacing;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(FRUIT_COLORS[i % FRUIT_COLORS.length]!),
        roughness: 0.35,
        metalness: 0.05,
        emissive: new THREE.Color(FRUIT_COLORS[i % FRUIT_COLORS.length]!),
        emissiveIntensity: 0,
      });
      const sphere = new THREE.Mesh(this.sphereGeo, mat);
      const leaf = new THREE.Mesh(this.leafGeo, this.leafMat);
      leaf.position.y = 0.34;
      leaf.rotation.z = 0.3;
      g.add(sphere, leaf);
      this.group.add(g);
      this.fruits.push({ group: g, mat, binT: (i + 0.5) / count, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'fruitCount', 7));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 5), frame.beat ? frame.beatEnergy : 0);
    const bounce = num(params, 'bounce', 0.75);
    const spin = num(params, 'spin', 1);
    const react = num(params, 'reactivity', 1.6);
    const spacing = 0.72;

    for (let i = 0; i < this.count; i++) {
      const fr = this.fruits[i]!;
      const band = frame.freq[logBin(fr.binT, frame.binCount)]! / 255;
      fr.phase += dt * (2.5 + band * 6 + this.beatPulse * 3);
      const s = Math.abs(Math.sin(fr.phase));
      const hop = (0.1 + band * bounce * react + this.beatPulse * 0.35) * s;
      const landing = 1 - s;
      const sy = 1 - landing * 0.3 * (0.5 + band);
      const sx = 1 + landing * 0.22 * (0.5 + band);
      fr.group.position.x = (i - (this.count - 1) / 2) * spacing;
      fr.group.position.y = hop - 0.3;
      fr.group.scale.set(sx, sy, sx);
      fr.group.rotation.y += dt * spin * (0.5 + frame.treble * 3);
      fr.mat.emissiveIntensity = band * 0.5 + this.beatPulse * 0.5;
    }
    this.group.rotation.y = Math.sin(performance.now() * 0.0002) * 0.15;
  }

  resize(): void { /* nothing view-dependent */ }

  dispose(): void {
    for (const f of this.fruits) {
      this.group.remove(f.group);
      f.mat.dispose();
    }
    this.fruits = [];
    this.ctx?.scene.remove(this.group);
    this.ctx?.scene.remove(this.lights);
    this.sphereGeo.dispose();
    this.leafGeo.dispose();
    this.leafMat.dispose();
  }
}
