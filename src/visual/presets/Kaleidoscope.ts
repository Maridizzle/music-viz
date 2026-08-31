import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

export const SCHEMA: ParamSchema = [
  { key: 'segments', label: 'Segments', type: 'range', min: 3, max: 16, step: 1, default: 8 },
  { key: 'zoom', label: 'Zoom', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.4 },
];

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uBass,uMid,uTreble,uLevel,uBeat,uSegments,uZoom,uReact;
uniform vec3 uPal[4];
varying vec2 vUv;
${SNOISE}
vec3 grad4(float t){ t=fract(t)*3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0); }
void main(){
  vec2 p=(vUv-0.5); p.x*=uResolution.x/max(1.0,uResolution.y);
  float r=length(p);
  float a=atan(p.y,p.x);
  float seg=6.2831853/uSegments;
  a=mod(a,seg); a=abs(a-seg*0.5);
  vec2 q=vec2(cos(a),sin(a))*r*(1.0+uZoom);
  float t=uTime;
  float n=snoise(vec3(q*3.0, t*0.3));
  n+=0.5*snoise(vec3(q*6.0+uBass*2.0, t*0.4));
  float rings=sin(r*(9.0+uBass*22.0) - t*2.0);
  float v=n*0.6+rings*0.4;
  float tcol=fract(v*0.5+0.5+uTreble*0.3+uTime*0.02);
  vec3 col=grad4(tcol)*(0.35+uLevel*1.3*uReact+uBeat*0.6+abs(n)*0.5);
  gl_FragColor=vec4(col,1.0);
}
`;

export class Kaleidoscope implements Preset {
  readonly id = 'kaleidoscope';
  readonly label = 'Kaleidoscope';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private time = 0;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
        uLevel: { value: 0 }, uBeat: { value: 0 },
        uSegments: { value: 8 }, uZoom: { value: 0.6 }, uReact: { value: 1.4 },
        uPal: { value: this.pal },
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
    this.time += dt * num(params, 'speed', 0.6);
    const u = this.material.uniforms;
    u.uTime!.value = this.time;
    u.uBass!.value = frame.bass; u.uMid!.value = frame.mid; u.uTreble!.value = frame.treble;
    u.uLevel!.value = frame.level; u.uBeat!.value = frame.beat ? frame.beatEnergy : 0;
    u.uSegments!.value = Math.round(num(params, 'segments', 8));
    u.uZoom!.value = num(params, 'zoom', 0.6);
    u.uReact!.value = num(params, 'reactivity', 1.4);
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
