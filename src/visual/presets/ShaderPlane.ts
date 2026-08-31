import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, str, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

const PATTERNS = ['Plasma', 'Tunnel', 'Waves', 'Rings'];

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
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat, uSpeed, uWarp, uContrast, uPattern;
uniform vec3 uPal[4];
varying vec2 vUv;
${SNOISE}
vec3 grad4(float t){
  t = fract(t) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
float field(vec2 p){
  float tm = uTime * uSpeed;
  if(uPattern < 0.5){
    float n = snoise(vec3(p*(1.4+uWarp*2.5), tm));
    n += 0.5*snoise(vec3(p*3.0 + uBass*2.0, tm*1.3));
    return n*0.5+0.5;
  } else if(uPattern < 1.5){
    float r = length(p);
    float a = atan(p.y,p.x);
    return sin(1.0/max(r,0.05)*3.0 - tm*2.0 + a*3.0)*0.5+0.5;
  } else if(uPattern < 2.5){
    float w = sin(p.x*6.0 + tm*2.0 + snoise(vec3(p*2.0,tm))*uWarp*3.0);
    w += sin(p.y*5.0 - tm*1.5 + uMid*4.0);
    return w*0.25+0.5;
  } else {
    float r = length(p);
    return sin(r*(10.0+uBass*24.0) - tm*3.0)*0.5+0.5;
  }
}
void main(){
  vec2 p = (vUv-0.5);
  p.x *= uResolution.x/max(1.0,uResolution.y);
  p *= 1.7;
  float f = field(p);
  f = pow(clamp(f,0.0,1.0), mix(1.8,0.45,uContrast));
  float tcol = clamp(f*(0.6+uBass*0.8)+uTreble*0.3, 0.0, 1.0);
  vec3 col = grad4(tcol);
  col *= 0.45 + uLevel*1.1 + uBeat*0.5;
  col += uBeat * 0.12;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCHEMA: ParamSchema = [
  { key: 'pattern', label: 'Pattern', type: 'select', options: PATTERNS, default: 'Plasma' },
  { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 3, step: 0.01, default: 0.8 },
  { key: 'warp', label: 'Warp', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
];

export class ShaderPlane implements Preset {
  readonly id = 'shaderplane';
  readonly label = 'Shader Plane';
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
        uSpeed: { value: num(params, 'speed', 0.8) },
        uWarp: { value: num(params, 'warp', 0.6) },
        uContrast: { value: num(params, 'contrast', 0.5) },
        uPattern: { value: 0 },
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
    u.uSpeed!.value = num(params, 'speed', 0.8);
    u.uWarp!.value = num(params, 'warp', 0.6);
    u.uContrast!.value = num(params, 'contrast', 0.5);
    u.uPattern!.value = Math.max(0, PATTERNS.indexOf(str(params, 'pattern', 'Plasma')));
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
