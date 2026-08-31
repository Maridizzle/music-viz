import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { bool, num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'barCount', label: 'Bars', type: 'range', min: 24, max: 160, step: 1, default: 96 },
  { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 1.8, step: 0.01, default: 1 },
  { key: 'heightScale', label: 'Height', type: 'range', min: 0.2, max: 2.5, step: 0.01, default: 1.1 },
  { key: 'thickness', label: 'Thickness', type: 'range', min: 0.2, max: 2, step: 0.01, default: 1 },
  { key: 'logScale', label: 'Log frequency', type: 'toggle', default: true },
  { key: 'rotationSpeed', label: 'Rotation', type: 'range', min: -1.5, max: 1.5, step: 0.01, default: 0.15 },
];

export class RadialBars implements Preset {
  readonly id = 'radialbars';
  readonly label = 'Radial Bars';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BoxGeometry;
  private material!: THREE.MeshBasicMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private ctx!: PresetContext;
  private count = 0;
  private values: number[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.translate(0, 0.5, 0); // grow upward from base
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'barCount', 96)));
  }

  private rebuild(count: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.count = count;
    this.values = new Array(count).fill(0);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'barCount', 96));
    if (wanted !== this.count) this.rebuild(wanted);
    const mesh = this.mesh;
    if (!mesh) return;

    const radius = num(params, 'radius', 1);
    const heightScale = num(params, 'heightScale', 1.1);
    const thickness = num(params, 'thickness', 1);
    const logScale = bool(params, 'logScale', true);
    const bins = frame.binCount;
    const usable = Math.max(2, Math.floor(bins * 0.7));
    const barW = ((2 * Math.PI * radius) / this.count) * 0.6 * thickness;

    for (let i = 0; i < this.count; i++) {
      let bin: number;
      if (logScale) {
        const minBin = 2;
        bin = Math.floor(minBin * Math.pow(usable / minBin, i / (this.count - 1)));
      } else {
        bin = Math.floor((i / this.count) * usable);
      }
      bin = Math.max(0, Math.min(bins - 1, bin));
      const amp = frame.freq[bin]! / 255;
      const prev = this.values[i]!;
      const smoothed = amp > prev ? amp : prev * (1 - dt * 6);
      this.values[i] = smoothed;

      const len = 0.04 + smoothed * heightScale;
      const angle = (i / this.count) * Math.PI * 2;
      const dir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
      this.dummy.position.set(dir.x * radius, dir.y * radius, 0);
      this.dummy.rotation.set(0, 0, angle - Math.PI / 2);
      this.dummy.scale.set(barW, len, barW);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);

      this.ctx.style.sample(0.1 + smoothed * 0.85, this.color);
      this.color.multiplyScalar(0.5 + smoothed * 1.1);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.group.rotation.z += dt * num(params, 'rotationSpeed', 0.15);
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
