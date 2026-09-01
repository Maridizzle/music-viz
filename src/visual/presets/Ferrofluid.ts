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

// Spiky magnetic blob — a bass-pulsed body whose boundary sprouts noise-driven
// spikes that grow with treble/beats, wrapped in a bright rim light and a metallic sheen.
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat;
uniform float uSpikes, uSpikeGain, uWobble, uBeatSpike;
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
  vec2 p=(vUv-0.5); p.x*=uResolution.x/max(1.0,uResolution.y); p*=2.0;
  float r=length(p), a=atan(p.y,p.x);
  float base=0.5 + uBass*0.25 + uBeat*uBeatSpike*0.2;
  float spikes=0.0;
  spikes+=0.18*uSpikeGain*(0.4+uTreble*1.4)*(snoise(vec3(cos(a),sin(a),uTime*0.5)*uSpikes)*0.5+0.5);
  spikes+=0.10*uSpikeGain*(0.4+uTreble*1.0)*abs(sin(a*uSpikes*0.5 + uTime*2.0));
  float edge=base + spikes*(0.6+0.4*sin(uTime*uWobble));
  float inside=smoothstep(edge+0.02, edge-0.02, r);
  float rim=smoothstep(0.06,0.0, abs(r-edge));
  vec3 col=grad4(clamp(0.15+r*0.5,0.0,1.0))*(0.15+inside*0.5);
  col+=grad4(clamp(0.6+uTreble*0.3,0.0,1.0))*rim*(1.2+uLevel*1.5+uBeat*1.5);
  col+=inside*grad4(0.8)*0.1*(0.5+0.5*sin(r*30.0 - uTime*2.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'spikes', label: 'Spikes', type: 'range', min: 4, max: 24, step: 1, default: 12 },
  { key: 'spikeGain', label: 'Spike gain', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 3, step: 0.01, default: 1.2 },
  { key: 'beatSpike', label: 'Beat spike', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

/** Fullscreen ferrofluid — a spiky, metallic magnetic blob that pulses and sprouts with the audio. */
export class Ferrofluid implements Preset {
  readonly id = 'ferrofluid';
  readonly label = 'Ferrofluid';
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
        uSpikes: { value: num(params, 'spikes', 12) },
        uSpikeGain: { value: num(params, 'spikeGain', 1) },
        uWobble: { value: num(params, 'wobble', 1.2) },
        uBeatSpike: { value: num(params, 'beatSpike', 1) },
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
    u.uSpikes!.value = num(params, 'spikes', 12);
    u.uSpikeGain!.value = num(params, 'spikeGain', 1);
    u.uWobble!.value = num(params, 'wobble', 1.2);
    u.uBeatSpike!.value = num(params, 'beatSpike', 1);
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
