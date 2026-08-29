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

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uRayCount, uSpin, uIntensity, uFalloff, uBeatFlash;
uniform vec3 uPal[4];
varying vec2 vUv;
const float PI = 3.14159265;
vec3 grad4(float t){
  t = fract(t) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  vec2 p = (vUv - 0.5);
  p.x *= uResolution.x / max(1.0, uResolution.y);
  float r = length(p);
  float a = atan(p.y, p.x);

  float spin = uTime * uSpin;
  // Sharp evenly-spaced beams sweeping around the centre.
  float beams = 0.5 + 0.5 * sin(a * uRayCount + spin);
  beams = pow(beams, mix(3.0, 10.0, clamp(uTreble, 0.0, 1.0)));

  float reach = uFalloff * (0.5 + uLevel * 1.3 + uBeat * uBeatFlash);
  float body = beams * exp(-r / max(0.05, reach)) * uIntensity;
  body += uBeat * uBeatFlash * 0.25 * beams;

  float tcol = fract(a / (2.0 * PI) + uTime * 0.03 + uBass * 0.2);
  vec3 col = grad4(tcol) * body * (1.0 + uTreble * 1.2);
  // bright core
  col += grad4(0.5) * exp(-r * 6.0) * (0.5 + uLevel * 1.5 + uBeat);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'rayCount', label: 'Rays', type: 'range', min: 3, max: 48, step: 1, default: 16 },
  { key: 'spin', label: 'Spin', type: 'range', min: -3, max: 3, step: 0.01, default: 0.4 },
  { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.2 },
  { key: 'falloff', label: 'Reach', type: 'range', min: 0.1, max: 1.5, step: 0.01, default: 0.5 },
  { key: 'beatFlash', label: 'Beat flash', type: 'range', min: 0, max: 2, step: 0.01, default: 0.8 },
];

export class LightRays implements Preset {
  readonly id = 'lightrays';
  readonly label = 'Light Rays';
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
        uRayCount: { value: num(params, 'rayCount', 16) },
        uSpin: { value: num(params, 'spin', 0.4) },
        uIntensity: { value: num(params, 'intensity', 1.2) },
        uFalloff: { value: num(params, 'falloff', 0.5) },
        uBeatFlash: { value: num(params, 'beatFlash', 0.8) },
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
    u.uRayCount!.value = num(params, 'rayCount', 16);
    u.uSpin!.value = num(params, 'spin', 0.4);
    u.uIntensity!.value = num(params, 'intensity', 1.2);
    u.uFalloff!.value = num(params, 'falloff', 0.5);
    u.uBeatFlash!.value = num(params, 'beatFlash', 0.8);
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
