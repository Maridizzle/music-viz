import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Domain-warped fbm — billowing smoke that rises, swirls and lights up with the music.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uScale, uFlow, uSwirl, uTurb, uBeatBurst;
uniform vec3 uPal[4];
varying vec2 vUv;
${SNOISE}
vec3 grad4(float t){
  t = clamp(t,0.0,1.0) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<4;i++){ s += a * snoise(p); p *= 2.02; a *= 0.5; }
  return s;
}
void main(){
  vec2 uv = (vUv - 0.5);
  uv.x *= uResolution.x / max(1.0, uResolution.y);
  uv *= uScale;
  float tm = uTime * uFlow;
  // smoke drifts upward (negative y in noise space) with a slow depth crawl
  vec3 p = vec3(uv, 0.0) + vec3(0.0, -tm, tm * 0.25);
  float f1 = fbm(p);
  vec2 warp = uSwirl * vec2(f1, fbm(p + vec3(3.1, 1.7, 0.0)));
  float d = fbm(p + vec3(warp * (0.6 + uTurb), 0.0) + uBass * 0.4);
  float dens = clamp(d * 0.7 + 0.5, 0.0, 1.0);
  dens = pow(dens, mix(2.6, 1.2, uBass));        // carve darker voids -> smoky negative space
  // spread colour across the palette using the warp field (multi-hue smoke, not one flat tone)
  float tcol = clamp(0.5 + 0.45 * f1 + uTreble * 0.25 + uBass * 0.15, 0.0, 1.0);
  vec3 col = grad4(tcol);
  col *= 0.15 + dens * (0.9 + uLevel * 0.5) + uBeat * uBeatBurst * 0.5;
  col *= smoothstep(0.03, 0.5, dens);            // wispy edges fade to black
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'scale', label: 'Scale', type: 'range', min: 1, max: 6, step: 0.05, default: 2.6 },
  { key: 'flowSpeed', label: 'Flow speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5 },
  { key: 'swirl', label: 'Swirl', type: 'range', min: 0, max: 3, step: 0.01, default: 1.2 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'beatBurst', label: 'Beat burst', type: 'range', min: 0, max: 2, step: 0.01, default: 0.9 },
];

/** Fullscreen curl/fbm smoke that advects and lights up with the audio. */
export class Fluid implements Preset {
  readonly id = 'fluid';
  readonly label = 'Fluid Smoke';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private beatPulse = 0;
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
        uScale: { value: num(params, 'scale', 2.6) },
        uFlow: { value: num(params, 'flowSpeed', 0.5) },
        uSwirl: { value: num(params, 'swirl', 1.2) },
        uTurb: { value: num(params, 'turbulence', 1) },
        uBeatBurst: { value: num(params, 'beatBurst', 0.9) },
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
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 3.5), frame.beat ? frame.beatEnergy : 0);
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uBass!.value = frame.bass;
    u.uMid!.value = frame.mid;
    u.uTreble!.value = frame.treble;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = this.beatPulse;
    u.uScale!.value = num(params, 'scale', 2.6);
    u.uFlow!.value = num(params, 'flowSpeed', 0.5);
    u.uSwirl!.value = num(params, 'swirl', 1.2);
    u.uTurb!.value = num(params, 'turbulence', 1);
    u.uBeatBurst!.value = num(params, 'beatBurst', 0.9);
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
