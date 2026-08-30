import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'starCount', label: 'Stars', type: 'range', min: 2000, max: 40000, step: 1000, default: 14000 },
  { key: 'arms', label: 'Arms', type: 'range', min: 2, max: 8, step: 1, default: 3 },
  { key: 'twist', label: 'Twist', type: 'range', min: 0.5, max: 6, step: 0.05, default: 2.6 },
  { key: 'rotation', label: 'Rotation', type: 'range', min: -1, max: 1, step: 0.01, default: 0.18 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
];

const VERT = /* glsl */ `
uniform float uTime,uLevel,uBeat,uTreble,uReact;
uniform vec3 uPal[4];
attribute float aT; attribute float aSeed;
varying vec3 vColor; varying float vA;
vec3 grad4(float t){ t=clamp(t,0.0,1.0)*3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0); }
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_Position = projectionMatrix*mv;
  float twinkle = 0.55 + 0.45*sin(uTime*3.0 + aSeed*6.2831)*(0.5+uTreble);
  float core = smoothstep(0.28,0.0,aT);
  float sz = (1.0 + core*4.0) * (0.55 + uLevel*2.3*uReact + uBeat*1.9);
  gl_PointSize = clamp(sz * (18.0/max(0.1,-mv.z)) * twinkle, 1.0, 30.0);
  vColor = grad4(aT) * (0.7 + core*1.6 + uLevel*1.0 + uBeat*0.6);
  vColor += vec3(1.0,0.85,0.6)*core*0.6; // warm core
  vA = twinkle;
}
`;
const FRAG = /* glsl */ `
varying vec3 vColor; varying float vA;
void main(){
  vec2 d=gl_PointCoord-0.5; float r=dot(d,d);
  if(r>0.25) discard;
  float g=smoothstep(0.25,0.0,r);
  gl_FragColor=vec4(vColor*g, g*vA);
}
`;

export class Nebula implements Preset {
  readonly id = 'nebula';
  readonly label = 'Nebula';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private ctx!: PresetContext;
  private count = 0;
  private arms = 3;
  private twist = 2.6;
  private beatPulse = 0;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uLevel: { value: 0 }, uBeat: { value: 0 }, uTreble: { value: 0 },
        uReact: { value: 1.5 }, uPal: { value: this.pal },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.geometry = this.points.geometry;
    this.group.add(this.points);
    this.group.rotation.x = -0.5;
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'starCount', 14000)), Math.round(num(params, 'arms', 3)), num(params, 'twist', 2.6));
  }

  private rebuild(count: number, arms: number, twist: number): void {
    this.count = count; this.arms = arms; this.twist = twist;
    const pos = new Float32Array(count * 3);
    const at = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = Math.pow(Math.random(), 0.6); // denser toward core
      const arm = i % arms;
      const angle = t * twist * Math.PI * 2 + (arm / arms) * Math.PI * 2;
      const spread = (1 - t) * 0.35 + 0.04;
      const rx = (Math.random() * 2 - 1) * spread;
      const ry = (Math.random() * 2 - 1) * spread;
      const r = t * 2.1;
      pos[i * 3] = Math.cos(angle) * r + rx;
      pos[i * 3 + 1] = Math.sin(angle) * r + ry;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 0.15;
      at[i] = t;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.points.geometry.dispose();
    this.points.geometry = geo;
    this.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wc = Math.round(num(params, 'starCount', 14000));
    const wa = Math.round(num(params, 'arms', 3));
    const wt = num(params, 'twist', 2.6);
    if (wc !== this.count || wa !== this.arms || wt !== this.twist) this.rebuild(wc, wa, wt);
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 3), frame.beat ? frame.beatEnergy : 0);
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = this.beatPulse;
    u.uTreble!.value = frame.treble;
    u.uReact!.value = num(params, 'reactivity', 1.5);
    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);
    this.group.rotation.z += dt * num(params, 'rotation', 0.18) * (0.4 + frame.bass * 3.0);
  }

  resize(): void { /* in-shader sizing */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
