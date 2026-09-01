import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

const VERT = /* glsl */ `
uniform float uSize;
uniform float uLevel;
uniform float uBeat;
uniform vec3 uPal[4];
attribute float aT;
varying vec3 vColor;
vec3 grad4(float t){
  t = clamp(t,0.0,1.0)*3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 14.0 / max(0.1, -mv.z) * (0.6 + uLevel * 1.0 + uBeat * 0.6), 1.0, 16.0);
  vColor = grad4(aT) * (0.35 + uLevel * 0.6 + uBeat * 0.45);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = dot(uv, uv);
  if(d > 0.25) discard;
  float glow = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(vColor * glow, glow * 0.55);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'count', label: 'Points', type: 'range', min: 1000, max: 20000, step: 500, default: 3500 },
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'inflow', label: 'Inflow', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'beatBlast', label: 'Beat blast', type: 'range', min: 0, max: 3, step: 0.01, default: 1.2 },
];

/** A whirlpool of glowing points spiralling inward down a funnel, flung back outward on every beat. */
export class Vortex implements Preset {
  readonly id = 'vortex';
  readonly label = 'Vortex';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;

  // Per-point CPU state; positions are integrated here and uploaded each frame.
  private positions!: Float32Array;
  private radius!: Float32Array;
  private angle!: Float32Array;
  private y!: Float32Array;
  private aT!: Float32Array;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: 1.0 },
        uLevel: { value: 0 },
        uBeat: { value: 0 },
        uPal: { value: this.pal },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.geometry = this.points.geometry;
    this.group.add(this.points);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'count', 6000)));
  }

  private spawn(i: number, radius: number): void {
    this.radius[i] = radius;
    this.angle[i] = Math.random() * Math.PI * 2;
    this.y[i] = (Math.random() * 2 - 1) * 0.5;
    this.aT[i] = Math.random();
  }

  private rebuild(count: number): void {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.radius = new Float32Array(count);
    this.angle = new Float32Array(count);
    this.y = new Float32Array(count);
    this.aT = new Float32Array(count);
    for (let i = 0; i < count; i++) this.spawn(i, 0.1 + Math.random() * 1.9);

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aT', new THREE.BufferAttribute(this.aT, 1));
    this.points.geometry.dispose();
    this.points.geometry = geo;
    this.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'count', 6000));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const spin = num(params, 'spin', 1);
    const inflow = num(params, 'inflow', 0.6);
    const beatBlast = num(params, 'beatBlast', 1.2);
    const level = frame.level;

    const P = this.positions;
    let aTDirty = false;
    for (let i = 0; i < this.count; i++) {
      let a = this.angle[i]! + dt * spin * (0.5 + level) * (0.6 / (0.25 + this.radius[i]!));
      let r = this.radius[i]! - dt * inflow * (0.3 + level);
      if (frame.beat) r += beatBlast * frame.beatEnergy * 0.5 * Math.random();
      if (r < 0.22) {
        this.spawn(i, 1.9);
        a = this.angle[i]!;
        r = this.radius[i]!;
        aTDirty = true;
      }
      this.angle[i] = a;
      this.radius[i] = r;
      const o = i * 3;
      P[o] = Math.cos(a) * r;
      P[o + 1] = this.y[i]! + (r - 0.9) * 0.5; // funnel: outer ring rides high, throat dips
      P[o + 2] = Math.sin(a) * r;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (aTDirty) (this.geometry.getAttribute('aT') as THREE.BufferAttribute).needsUpdate = true;

    const u = this.material.uniforms;
    u.uLevel!.value = level;
    u.uBeat!.value = this.beatPulse;
    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);
  }

  resize(): void {
    /* point size uses perspective attenuation in-shader */
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
