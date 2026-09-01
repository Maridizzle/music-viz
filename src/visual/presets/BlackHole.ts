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

// Accretion disk with a dark event horizon, spiral streaks, a thin photon ring and
// Doppler brightening on one side.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uSpin, uDisk, uArms, uBeatBurst;
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
  float r = length(p), a = atan(p.y,p.x);
  float tm = uTime*(0.3 + uSpin*(0.5+uLevel));
  float diskR = uDisk*(0.95+uBass*0.25);
  float rh = diskR*0.42*(1.0+uBeat*0.15);                          // event horizon, well inside the disk
  float spiral = 0.5+0.5*sin(a*uArms - tm*3.0 + 7.0/max(r,0.06));
  float ring = smoothstep(0.32,0.0, abs(r - diskR));               // narrow bright annulus at diskR
  ring *= smoothstep(rh*1.0, rh*1.7, r);                           // fade to a dark gap toward the horizon
  float disk = ring*spiral*(0.55+0.45*cos(a-1.2));                 // doppler brightening
  float photon = smoothstep(0.02,0.0, abs(r - rh*1.2));            // thin photon ring at the rim
  float glow = disk*(0.7+uLevel*0.9+uBeat*uBeatBurst*1.3) + photon*(1.1+uLevel*0.7);
  vec3 col = grad4(clamp(0.12 + (r-rh)*0.9 + uTreble*0.2,0.0,1.0))*glow;
  col *= smoothstep(rh*0.98, rh*1.04, r);                          // carve a pure-black event horizon
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'spin', label: 'Spin', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'disk', label: 'Disk radius', type: 'range', min: 0.2, max: 0.6, step: 0.01, default: 0.34 },
  { key: 'arms', label: 'Arms', type: 'range', min: 1, max: 8, step: 1, default: 4 },
  { key: 'beatBurst', label: 'Beat burst', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

/** Fullscreen accretion disk orbiting a dark event horizon, lit by the audio. */
export class BlackHole implements Preset {
  readonly id = 'blackhole';
  readonly label = 'Black Hole';
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
        uSpin: { value: num(params, 'spin', 0.6) },
        uDisk: { value: num(params, 'disk', 0.34) },
        uArms: { value: num(params, 'arms', 4) },
        uBeatBurst: { value: num(params, 'beatBurst', 1) },
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
    u.uSpin!.value = num(params, 'spin', 0.6);
    u.uDisk!.value = num(params, 'disk', 0.34);
    u.uArms!.value = num(params, 'arms', 4);
    u.uBeatBurst!.value = num(params, 'beatBurst', 1);
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
