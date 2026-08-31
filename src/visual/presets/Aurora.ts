import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

export const SCHEMA: ParamSchema = [
  { key: 'intensity', label: 'Intensity', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1.3 },
  { key: 'waviness', label: 'Waviness', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.7 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.4 },
];

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uBass,uMid,uTreble,uLevel,uBeat,uInt,uWav,uReact;
varying vec2 vUv;
${SNOISE}
float hash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5); }
void main(){
  vec2 uv=vUv;
  float x=uv.x;
  float wav=uWav;
  float base=0.34
    + snoise(vec3(x*3.0, uTime*0.15, 0.0))*0.16*wav
    + snoise(vec3(x*7.0+5.0, uTime*0.25, 1.0))*0.09*wav
    - uBass*0.16 - uBeat*0.08;                       // bass/beats surge the curtains upward
  float band=smoothstep(0.0,0.45,uv.y-base)*smoothstep(1.0,0.45,uv.y);
  float ripple=0.5+0.5*sin(x*38.0 + uTime*1.4*(1.0+uTreble*1.8) + snoise(vec3(x*10.0,uTime*0.5,2.0))*5.0);
  float intensity=band*ripple*(0.28+uMid*1.15*uReact+uBeat*0.9+uBass*0.4)*uInt;
  float h=clamp((uv.y-base)/0.5,0.0,1.0);
  vec3 c1=vec3(0.10,0.95,0.45), c2=vec3(0.10,0.70,0.95), c3=vec3(0.65,0.20,0.95);
  vec3 aur=mix(c1,mix(c2,c3,h),h);
  vec3 col=aur*intensity*(1.0+uTreble*0.8);
  // starfield
  float star=step(0.997, hash(floor(uv*vec2(220.0,150.0))));
  col += vec3(star)*(0.4+uTreble*0.5)*smoothstep(base,1.0,uv.y);
  col += vec3(0.02,0.03,0.07);
  col *= 0.8+uLevel*0.5;
  gl_FragColor=vec4(col,1.0);
}
`;

export class Aurora implements Preset {
  readonly id = 'aurora';
  readonly label = 'Aurora';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private time = 0;

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
        uLevel: { value: 0 }, uBeat: { value: 0 },
        uInt: { value: 1.3 }, uWav: { value: 1 }, uReact: { value: 1.4 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(this.mesh);
    ctx.scene.add(this.group);
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    this.time += dt * num(params, 'speed', 0.7);
    const u = this.material.uniforms;
    u.uTime!.value = this.time;
    u.uBass!.value = frame.bass; u.uMid!.value = frame.mid; u.uTreble!.value = frame.treble;
    u.uLevel!.value = frame.level; u.uBeat!.value = frame.beat ? frame.beatEnergy : 0;
    u.uInt!.value = num(params, 'intensity', 1.3);
    u.uWav!.value = num(params, 'waviness', 1);
    u.uReact!.value = num(params, 'reactivity', 1.4);
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
