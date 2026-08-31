import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'blobs', label: 'Blobs', type: 'range', min: 3, max: 8, step: 1, default: 7 },
  { key: 'flow', label: 'Flow speed', type: 'range', min: 0.1, max: 2, step: 0.01, default: 0.6 },
  { key: 'gooeyness', label: 'Gooeyness', type: 'range', min: 0.4, max: 1.6, step: 0.01, default: 1 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
];

const N = 8;

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uLevel,uBeat,uGoo,uCount;
uniform vec3 uBlobs[${N}];   // x, y, radius
uniform vec3 uPal[4];
varying vec2 vUv;
vec3 grad4(float t){ t=clamp(t,0.0,1.0)*3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0); }
void main(){
  vec2 p=(vUv-0.5); p.x*=uResolution.x/max(1.0,uResolution.y);
  float field=0.0;
  float wsum=0.0; float wy=0.0;
  for(int i=0;i<${N};i++){
    if(float(i)>=uCount) break;
    vec2 d=p-uBlobs[i].xy;
    float r=uBlobs[i].z;
    float f=r*r/(dot(d,d)+0.0006);
    field+=f;
    wsum+=f; wy+=f*(uBlobs[i].y*0.5+0.5);
  }
  float thresh=1.0/uGoo;
  float m=smoothstep(thresh*0.85, thresh*1.15, field);
  // warm dark lamp glass background
  vec3 bg=mix(vec3(0.03,0.01,0.06), vec3(0.10,0.02,0.12), vUv.y);
  float colorT=wsum>0.0? wy/wsum : 0.5;
  vec3 lava=grad4(colorT)*(0.7+uLevel*1.0+uBeat*0.6);
  // inner glow
  lava += grad4(colorT)*smoothstep(thresh*1.15, thresh*3.0, field)*0.5;
  vec3 col=mix(bg, lava, m);
  gl_FragColor=vec4(col,1.0);
}
`;

interface Blob { phase: number; speed: number; xBase: number; xAmp: number; rBase: number; binT: number; kick: number; }

export class LavaLamp implements Preset {
  readonly id = 'lavalamp';
  readonly label = 'Lava Lamp';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private blobs: Blob[] = [];
  private data: THREE.Vector3[] = [];
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    for (let i = 0; i < N; i++) {
      this.blobs.push({
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.8,
        xBase: (Math.random() * 2 - 1) * 0.22,
        xAmp: 0.03 + Math.random() * 0.06,
        rBase: 0.11 + Math.random() * 0.07,
        binT: Math.random(),
        kick: 0,
      });
      this.data.push(new THREE.Vector3());
    }
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uLevel: { value: 0 }, uBeat: { value: 0 },
        uGoo: { value: 1 }, uCount: { value: 7 },
        uBlobs: { value: this.data }, uPal: { value: this.pal },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
    ctx.scene.add(this.group);
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void {
    const count = Math.round(num(params, 'blobs', 7));
    const flow = num(params, 'flow', 0.6);
    const react = num(params, 'reactivity', 1.5);
    for (let i = 0; i < N; i++) {
      const b = this.blobs[i]!;
      b.kick = Math.max(b.kick * (1 - dt * 2), frame.beat ? frame.beatEnergy : 0);
      const band = frame.freq[logBin(b.binT, frame.binCount)]! / 255;
      const y = Math.sin(t * b.speed * flow * (0.5 + frame.level * 1.5) + b.phase) * (0.5 + b.kick * 0.15);
      const x = b.xBase + Math.sin(t * b.speed * 0.7 + b.phase) * b.xAmp;
      const r = b.rBase * (0.7 + band * 0.9 * react + frame.bass * 0.4 + b.kick * 0.4);
      this.data[i]!.set(x, y, r);
    }
    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = frame.beat ? frame.beatEnergy : 0;
    u.uGoo!.value = num(params, 'gooeyness', 1);
    u.uCount!.value = count;
    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    this.mesh.scale.set(h * (width / height), h, 1);
    (this.material.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
