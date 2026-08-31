import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { bool, num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uLevel;
uniform float uTreble;
uniform float uBeat;
uniform float uDisplacement;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
varying float vDisp;
${SNOISE}
void main(){
  vec3 p = position;
  float t = uTime * uNoiseSpeed;
  float base = snoise(normal * uNoiseScale + vec3(0.0, 0.0, t));
  float detail = snoise(normal * (uNoiseScale * 3.0) + vec3(t * 1.7)) * 0.4 * uTreble;
  float amount = (base * (0.35 + uBass * 1.4) + detail) * uDisplacement;
  amount += uBeat * 0.25;
  vDisp = amount;
  vec3 displaced = p + normal * amount * (0.6 + uLevel);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorLow;
uniform vec3 uColorHigh;
uniform float uLevel;
varying float vDisp;
void main(){
  float m = clamp(vDisp * 0.9 + 0.4, 0.0, 1.0);
  vec3 col = mix(uColorLow, uColorHigh, m);
  col *= 0.7 + uLevel * 0.9 + m * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'displacement', label: 'Displacement', type: 'range', min: 0, max: 2, step: 0.01, default: 0.7 },
  { key: 'noiseScale', label: 'Noise scale', type: 'range', min: 0.2, max: 4, step: 0.01, default: 1.4 },
  { key: 'noiseSpeed', label: 'Noise speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5 },
  { key: 'rotationSpeed', label: 'Rotation', type: 'range', min: 0, max: 2, step: 0.01, default: 0.3 },
  { key: 'wireframe', label: 'Wireframe', type: 'toggle', default: false },
];

export class IcoBlob implements Preset {
  readonly id = 'icoblob';
  readonly label = 'Ico Blob';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.IcosahedronGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private beatPulse = 0;
  private readonly cLow = new THREE.Color();
  private readonly cHigh = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.IcosahedronGeometry(1, 48);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uLevel: { value: 0 },
        uTreble: { value: 0 },
        uBeat: { value: 0 },
        uDisplacement: { value: num(params, 'displacement', 0.7) },
        uNoiseScale: { value: num(params, 'noiseScale', 1.4) },
        uNoiseSpeed: { value: num(params, 'noiseSpeed', 0.5) },
        uColorLow: { value: new THREE.Color('#2dd4ff') },
        uColorHigh: { value: new THREE.Color('#ff2d95') },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      wireframe: bool(params, 'wireframe', false),
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
    ctx.scene.add(this.group);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uBass!.value = frame.bass;
    u.uLevel!.value = frame.level;
    u.uTreble!.value = frame.treble;
    u.uDisplacement!.value = num(params, 'displacement', 0.7);
    u.uNoiseScale!.value = num(params, 'noiseScale', 1.4);
    u.uNoiseSpeed!.value = num(params, 'noiseSpeed', 0.5);
    this.material.wireframe = bool(params, 'wireframe', false);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    u.uBeat!.value = this.beatPulse;

    this.ctx.style.sample(0.15, this.cLow);
    this.ctx.style.sample(0.9, this.cHigh);
    (u.uColorLow!.value as THREE.Color).copy(this.cLow);
    (u.uColorHigh!.value as THREE.Color).copy(this.cHigh);

    const rot = num(params, 'rotationSpeed', 0.3);
    this.group.rotation.y += dt * rot;
    this.group.rotation.x += dt * rot * 0.4;
    const s = 1 + this.beatPulse * 0.15;
    this.group.scale.setScalar(s);
  }

  resize(): void {
    /* nothing view-dependent */
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
