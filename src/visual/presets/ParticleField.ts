import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uBeat;
uniform float uSize;
uniform float uSpread;
uniform float uFlow;
uniform float uBeatBurst;
uniform vec3 uPal[4];
attribute float aSeed;
attribute float aT;
varying vec3 vColor;
varying float vFade;
${SNOISE}
vec3 grad4(float t){
  t = clamp(t,0.0,1.0)*3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  vec3 dir = normalize(position + 0.0001);
  float tt = uTime * uFlow;
  float n = snoise(position * 0.6 + vec3(aSeed, tt, aSeed * 0.3));
  float radius = length(position);
  float burst = uBeat * uBeatBurst * 0.6;
  vec3 pos = position * uSpread + dir * (n * (0.4 + uBass * 1.6) + burst);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float atten = 320.0 / max(0.1, -mv.z);
  gl_PointSize = uSize * atten * (0.5 + uLevel * 1.4 + uBeat * 0.6);
  vColor = grad4(aT) * (0.6 + uLevel * 1.1 + n * 0.3);
  vFade = 0.4 + 0.6 * clamp(radius, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = dot(uv, uv);
  if(d > 0.25) discard;
  float glow = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(vColor * glow, glow * vFade);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'particleCount', label: 'Particles', type: 'range', min: 2000, max: 120000, step: 1000, default: 30000 },
  { key: 'size', label: 'Size', type: 'range', min: 0.2, max: 6, step: 0.1, default: 2 },
  { key: 'spread', label: 'Spread', type: 'range', min: 0.6, max: 3, step: 0.01, default: 1.4 },
  { key: 'flowSpeed', label: 'Flow speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5 },
  { key: 'beatBurst', label: 'Beat burst', type: 'range', min: 0, max: 2, step: 0.01, default: 0.8 },
  { key: 'rotationSpeed', label: 'Rotation', type: 'range', min: 0, max: 2, step: 0.01, default: 0.25 },
];

export class ParticleField implements Preset {
  readonly id = 'particles';
  readonly label = 'Particle Field';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private ctx!: PresetContext;
  private count = 0;
  private beatPulse = 0;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uBass: { value: 0 },
        uBeat: { value: 0 },
        uSize: { value: num(params, 'size', 2) },
        uSpread: { value: num(params, 'spread', 1.4) },
        uFlow: { value: num(params, 'flowSpeed', 0.5) },
        uBeatBurst: { value: num(params, 'beatBurst', 0.8) },
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
    this.rebuild(Math.round(num(params, 'particleCount', 30000)));
  }

  private rebuild(count: number): void {
    this.count = count;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const ts = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // uniform-ish distribution in a sphere shell
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 0.4 + Math.cbrt(Math.random()) * 0.9;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      seeds[i] = Math.random() * 100;
      ts[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    this.points.geometry.dispose();
    this.points.geometry = geo;
    this.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const wanted = Math.round(num(params, 'particleCount', 30000));
    if (wanted !== this.count) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 3), frame.beat ? frame.beatEnergy : 0);
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uLevel!.value = frame.level;
    u.uBass!.value = frame.bass;
    u.uBeat!.value = this.beatPulse;
    u.uSize!.value = num(params, 'size', 2);
    u.uSpread!.value = num(params, 'spread', 1.4);
    u.uFlow!.value = num(params, 'flowSpeed', 0.5);
    u.uBeatBurst!.value = num(params, 'beatBurst', 0.8);

    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);

    this.group.rotation.y += dt * num(params, 'rotationSpeed', 0.25);
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
