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

// Fly-through tunnel: polar tunnel coords with rings + noise on the wall, travelling
// inward, twisting, dark at the far centre.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uSpeed, uTwist, uRings, uBeatKick;
uniform vec3 uPal[4];
varying vec2 vUv;
${SNOISE}
vec3 grad4(float t){
  t = clamp(t,0.0,1.0) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  vec2 p = (vUv-0.5);
  p.x *= uResolution.x/max(1.0,uResolution.y);
  float r = length(p), a = atan(p.y,p.x);
  float speed = uSpeed*(0.4+uLevel*2.0+uBeat*2.0);
  float depth = 1.0/max(r,0.06) + uTime*speed;
  float ang = a/6.2831853 + uTwist*depth*0.02;
  float rings = 0.5+0.5*sin(depth*uRings);
  float n = snoise(vec3(ang*8.0, depth*0.6, uTime*0.2))*0.5+0.5;
  float wall = mix(rings,n,0.5);
  float tcol = fract(depth*0.15 + ang + uBass*0.3);
  vec3 col = grad4(tcol)*(wall*(0.5+uLevel*1.2)+uBeat*uBeatKick*0.5);
  col *= smoothstep(0.0,0.35,r);                                   // dark far centre
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
  { key: 'twist', label: 'Twist', type: 'range', min: 0, max: 5, step: 0.01, default: 1.5 },
  { key: 'rings', label: 'Rings', type: 'range', min: 2, max: 40, step: 1, default: 12 },
  { key: 'beatKick', label: 'Beat kick', type: 'range', min: 0, max: 2, step: 0.01, default: 0.9 },
];

/** Fullscreen fly-through wormhole tunnel that accelerates and twists with the audio. */
export class Wormhole implements Preset {
  readonly id = 'wormhole';
  readonly label = 'Wormhole';
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
        uSpeed: { value: num(params, 'speed', 1) },
        uTwist: { value: num(params, 'twist', 1.5) },
        uRings: { value: num(params, 'rings', 12) },
        uBeatKick: { value: num(params, 'beatKick', 0.9) },
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
    u.uSpeed!.value = num(params, 'speed', 1);
    u.uTwist!.value = num(params, 'twist', 1.5);
    u.uRings!.value = num(params, 'rings', 12);
    u.uBeatKick!.value = num(params, 'beatKick', 0.9);
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
