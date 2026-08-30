import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'burstSize', label: 'Burst size', type: 'range', min: 30, max: 400, step: 10, default: 160 },
  { key: 'speed', label: 'Spread', type: 'range', min: 0.5, max: 4, step: 0.01, default: 1.8 },
  { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 2, step: 0.01, default: 0.7 },
  { key: 'trails', label: 'Trail length', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.4 },
];

const MAX = 5000;

const VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSize;
varying vec3 vColor;
void main(){
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp(aSize*(16.0/max(0.1,-mv.z)),1.0,16.0);
  vColor=aColor;
}
`;
const FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 d=gl_PointCoord-0.5; float r=dot(d,d);
  if(r>0.25) discard;
  float g=smoothstep(0.25,0.0,r);
  gl_FragColor=vec4(vColor*g,g);
}
`;

/** Beat-launched particle bursts under gravity. */
export class Fireworks implements Preset {
  readonly id = 'fireworks';
  readonly label = 'Fireworks';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private ctx!: PresetContext;
  private cursor = 0;
  private sinceSpawn = 0;

  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxlife = new Float32Array(MAX);
  private cr = new Float32Array(MAX);
  private cg = new Float32Array(MAX);
  private cb = new Float32Array(MAX);
  private pos!: Float32Array;
  private col!: Float32Array;
  private siz!: Float32Array;
  private readonly color = new THREE.Color();

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.siz = new Float32Array(MAX);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
    ctx.scene.add(this.group);
    void params;
  }

  private burst(size: number, speed: number, energy: number): void {
    const lx = (Math.random() * 2 - 1) * 2.2;
    const ly = (Math.random() * 2 - 1) * 1.4 + 0.3;
    const lz = (Math.random() * 2 - 1) * 1.0;
    this.ctx.style.sample(Math.random(), this.color);
    const br = 0.8 + energy * 0.8;
    for (let k = 0; k < size; k++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      // random direction on a sphere
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const spd = speed * (0.4 + Math.random() * 0.8) * (0.6 + energy);
      this.px[idx] = lx; this.py[idx] = ly; this.pz[idx] = lz;
      this.vx[idx] = Math.cos(th) * s * spd;
      this.vy[idx] = u * spd;
      this.vz[idx] = Math.sin(th) * s * spd;
      const ml = 1.0 + Math.random() * 1.2;
      this.life[idx] = ml; this.maxlife[idx] = ml;
      this.cr[idx] = this.color.r * br; this.cg[idx] = this.color.g * br; this.cb[idx] = this.color.b * br;
    }
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const gravity = num(params, 'gravity', 0.7) * 2.2;
    const trails = num(params, 'trails', 1.4);
    this.sinceSpawn += dt;
    if (frame.beat && frame.beatEnergy > 0.25) {
      this.burst(Math.round(num(params, 'burstSize', 160)), num(params, 'speed', 1.8), frame.beatEnergy);
      this.sinceSpawn = 0;
    } else if (this.sinceSpawn > 1.1 && frame.level > 0.08) {
      this.burst(Math.round(num(params, 'burstSize', 160) * 0.5), num(params, 'speed', 1.8), 0.4 + frame.level);
      this.sinceSpawn = 0;
    }

    const P = this.pos, C = this.col, S = this.siz;
    for (let i = 0; i < MAX; i++) {
      let l = this.life[i]!;
      if (l <= 0) { S[i] = 0; continue; }
      l -= dt; this.life[i] = l;
      this.vy[i] = this.vy[i]! - gravity * dt;
      this.px[i] = this.px[i]! + this.vx[i]! * dt;
      this.py[i] = this.py[i]! + this.vy[i]! * dt;
      this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
      const a = Math.max(0, l / this.maxlife[i]!);
      P[i * 3] = this.px[i]!; P[i * 3 + 1] = this.py[i]!; P[i * 3 + 2] = this.pz[i]!;
      C[i * 3] = this.cr[i]! * a; C[i * 3 + 1] = this.cg[i]! * a; C[i * 3 + 2] = this.cb[i]! * a;
      S[i] = trails * (0.6 + a * 2.2);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  resize(): void { /* in-shader sizing */ }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
