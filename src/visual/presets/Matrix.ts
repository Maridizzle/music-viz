import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 20, max: 90, step: 1, default: 52 },
  { key: 'speed', label: 'Fall speed', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.5 },
];

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uLevel,uBeat,uTreble,uSpeed,uCols,uReact;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
void main(){
  float cols=uCols;
  float rows=max(8.0, floor(cols*uResolution.y/max(1.0,uResolution.x)));
  float col=floor(vUv.x*cols);
  float row=floor(vUv.y*rows);
  float t=uTime*uSpeed*(0.4+uLevel*1.6*uReact);
  float sp=4.0+hash(vec2(col,3.0))*10.0;
  float phase=hash(vec2(col,7.0));
  float headRow=rows-mod(t*sp+phase*rows*2.0, rows*1.6);
  float dist=headRow-row;
  float trail=(dist>=0.0 && dist<rows)? exp(-dist*0.16):0.0;
  float headGlow=exp(-abs(dist)*1.1);
  // flickering 3x5 dot-matrix glyph
  vec2 sub=vec2(fract(vUv.x*cols),fract(vUv.y*rows));
  vec2 dcell=floor(sub*vec2(3.0,5.0));
  float glyph=step(0.42, hash(vec2(col,row)+dcell*7.3+floor(t*6.0)));
  vec3 green=vec3(0.15,1.0,0.35);
  vec3 c=green*trail*glyph;
  c+=vec3(0.8,1.0,0.85)*headGlow*glyph;
  c*=0.7+uBeat*0.9+uTreble*0.4;
  gl_FragColor=vec4(c,1.0);
}
`;

export class Matrix implements Preset {
  readonly id = 'matrix';
  readonly label = 'Matrix Rain';
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
        uTime: { value: 0 }, uLevel: { value: 0 }, uBeat: { value: 0 }, uTreble: { value: 0 },
        uSpeed: { value: 1 }, uCols: { value: 52 }, uReact: { value: 1.5 },
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
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime!.value = this.time;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = frame.beat ? frame.beatEnergy : 0;
    u.uTreble!.value = frame.treble;
    u.uSpeed!.value = num(params, 'speed', 1);
    u.uCols!.value = Math.round(num(params, 'density', 52));
    u.uReact!.value = num(params, 'reactivity', 1.5);
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
