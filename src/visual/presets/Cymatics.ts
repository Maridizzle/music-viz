import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Chladni-plate standing waves — sand-on-a-plate nodal lines. The mode numbers n,m
// are audio-driven and smoothed in TypeScript, then fed in as uN/uM. The plate is
// square in uv, so this shader deliberately does NOT aspect-correct.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uN, uM, uSharp, uBeatJolt;
uniform vec3 uPal[4];
varying vec2 vUv;
vec3 grad4(float t){
  t = clamp(t,0.0,1.0) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  float PI=3.14159265;
  float x=vUv.x, y=vUv.y;
  float f = sin(uN*PI*x)*sin(uM*PI*y) - sin(uM*PI*x)*sin(uN*PI*y);
  f += 0.6*(sin((uN+1.0)*PI*x)*sin((uM+2.0)*PI*y) - sin((uM+2.0)*PI*x)*sin((uN+1.0)*PI*y));
  float line = 1.0 - smoothstep(0.0, uSharp*0.05+0.006, abs(f));
  float tcol = clamp(0.3 + length(vUv-0.5) + uTreble*0.2, 0.0, 1.0);
  vec3 col = grad4(tcol)*(line*(0.6+uLevel*1.4) + uBeatJolt*0.3*line);
  col += grad4(0.1)*0.03;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'modeScale', label: 'Mode scale', type: 'range', min: 1, max: 3, step: 0.01, default: 1.4 },
  { key: 'sharpness', label: 'Sharpness', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'morphSpeed', label: 'Morph speed', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'beatJolt', label: 'Beat jolt', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

/** Fullscreen cymatics — Chladni nodal-line patterns whose mode numbers ride the audio bands. */
export class Cymatics implements Preset {
  readonly id = 'cymatics';
  readonly label = 'Cymatics';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private beatPulse = 0;
  private nCur = 3;
  private mCur = 3;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uLevel: { value: 0 },
        uBeat: { value: 0 },
        uN: { value: this.nCur },
        uM: { value: this.mCur },
        uSharp: { value: num(params, 'sharpness', 1) },
        uBeatJolt: { value: 0 },
        uPal: { value: this.pal },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
    ctx.scene.add(this.group);
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uBass!.value = frame.bass;
    u.uMid!.value = frame.mid;
    u.uTreble!.value = frame.treble;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = this.beatPulse;
    const scale = num(params, 'modeScale', 1.4);
    const nTarget = 2 + frame.bass * 9 * scale + (frame.beat ? frame.beatEnergy * 3 * num(params, 'beatJolt', 1) : 0);
    const mTarget = 2 + frame.treble * 9 * scale;
    const k = Math.min(1, dt * (0.6 + num(params, 'morphSpeed', 1) * 2.5));
    this.nCur += (nTarget - this.nCur) * k;
    this.mCur += (mTarget - this.mCur) * k;
    u.uN!.value = this.nCur;
    u.uM!.value = this.mCur;
    u.uSharp!.value = num(params, 'sharpness', 1);
    u.uBeatJolt!.value = this.beatPulse;
    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const h = 2 * Math.tan(vFov / 2) * dist;
    const w = h * (width / height);
    this.mesh.scale.set(w, h, 1);
    (this.material.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
