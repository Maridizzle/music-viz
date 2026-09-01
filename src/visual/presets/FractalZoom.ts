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

// Morphing Julia set that slowly breathes/zooms and pulses with bass; escape-time
// coloured through the palette.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uZoomSpeed, uMorph, uBeatBurst;
uniform vec3 uPal[4];
varying vec2 vUv;
vec3 grad4(float t){
  t = clamp(t,0.0,1.0) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  vec2 p = (vUv-0.5);
  p.x *= uResolution.x/max(1.0,uResolution.y);
  p *= 2.2;
  float scale = (1.6 - uBass*0.5)*(0.85 + 0.25*sin(uTime*uZoomSpeed*0.3));
  vec2 z = p*scale;
  vec2 c = vec2(0.36*cos(uTime*uMorph*0.3) - 0.10, 0.36*sin(uTime*uMorph*0.37)) + uBass*0.05;
  float it = 0.0; const int MAX = 96;
  for(int i=0;i<MAX;i++){ z = vec2(z.x*z.x-z.y*z.y, 2.0*z.x*z.y)+c; if(dot(z,z)>16.0) break; it += 1.0; }
  float m = it/float(MAX);
  float tcol = fract(m*3.0 + uTime*0.05 + uTreble*0.2);
  vec3 col = grad4(tcol)*(0.15 + m*1.8 + uBeat*uBeatBurst*0.4);
  if(m>0.999) col *= 0.1;                                          // interior dark
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'zoomSpeed', label: 'Zoom speed', type: 'range', min: 0, max: 1, step: 0.005, default: 0.2 },
  { key: 'morph', label: 'Morph', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'beatBurst', label: 'Beat burst', type: 'range', min: 0, max: 2, step: 0.01, default: 0.8 },
];

/** Fullscreen morphing Julia set that breathes, zooms and pulses with the audio. */
export class FractalZoom implements Preset {
  readonly id = 'fractal';
  readonly label = 'Fractal Zoom';
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
        uZoomSpeed: { value: num(params, 'zoomSpeed', 0.2) },
        uMorph: { value: num(params, 'morph', 1) },
        uBeatBurst: { value: num(params, 'beatBurst', 0.8) },
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
    u.uZoomSpeed!.value = num(params, 'zoomSpeed', 0.2);
    u.uMorph!.value = num(params, 'morph', 1);
    u.uBeatBurst!.value = num(params, 'beatBurst', 0.8);
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
