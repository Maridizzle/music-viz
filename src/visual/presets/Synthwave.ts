import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

export const SCHEMA: ParamSchema = [
  { key: 'speed', label: 'Scroll speed', type: 'range', min: 0, max: 4, step: 0.01, default: 1.2 },
  { key: 'glow', label: 'Grid glow', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1.4 },
  { key: 'reactivity', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.01, default: 1.4 },
];

const CELL = 0.8;
const XMAX = 9;
const ZNEAR = 2;
const ZFAR = -18;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution; uniform float uBass,uLevel,uBeat;
varying vec2 vUv;
void main(){
  vec2 uv=vUv; float horizon=0.5;
  vec3 skyTop=vec3(0.05,0.02,0.16), skyMid=vec3(0.5,0.06,0.36), skyHor=vec3(1.0,0.36,0.22);
  float sy=clamp((uv.y-horizon)/(1.0-horizon),0.0,1.0);
  vec3 sky=mix(skyHor, mix(skyMid,skyTop,sy), sy);
  vec3 col = uv.y>horizon ? sky : vec3(0.02,0.0,0.05);
  vec2 sc=vec2(0.5,horizon+0.13);
  float sunR=0.16*(1.0+uBass*0.35+uBeat*0.25);
  vec2 dd=(uv-sc); dd.x*=uResolution.x/max(1.0,uResolution.y);
  float dsun=length(dd);
  if(uv.y>horizon){
    float sun=smoothstep(sunR,sunR*0.92,dsun);
    float stripe=step(0.0, sin((uv.y-sc.y)*130.0));
    float below=step(uv.y, sc.y);
    sun *= (below>0.5)? stripe : 1.0;
    vec3 sunCol=mix(vec3(1.0,0.9,0.35), vec3(1.0,0.25,0.6), clamp((sc.y-uv.y)/sunR*0.5+0.5,0.0,1.0));
    col=mix(col,sunCol,sun);
    col += sunCol*smoothstep(sunR*3.0,sunR,dsun)*0.28;
  }
  col *= 0.8+uLevel*0.4;
  gl_FragColor=vec4(col,1.0);
}
`;

/** Outrun-style neon horizon: sunset sky + retro sun + scrolling grid. */
export class Synthwave implements Preset {
  readonly id = 'synthwave';
  readonly label = 'Synthwave';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private grid!: THREE.LineSegments;
  private gridGroup = new THREE.Group();
  private skyGeo!: THREE.PlaneGeometry;
  private skyMat!: THREE.ShaderMaterial;
  private sky!: THREE.Mesh;
  private ctx!: PresetContext;
  private scroll = 0;
  private beatPulse = 0;
  private readonly cA = new THREE.Color('#20e0ff');
  private readonly cB = new THREE.Color('#ff2fb0');

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.skyGeo = new THREE.PlaneGeometry(1, 1);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uResolution: { value: new THREE.Vector2(1, 1) }, uBass: { value: 0 }, uLevel: { value: 0 }, uBeat: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false,
    });
    this.sky = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.sky.renderOrder = -1;

    this.buildGrid();
    this.gridGroup.position.y = -1.1;
    this.gridGroup.add(this.grid);
    this.group.add(this.sky, this.gridGroup);
    ctx.scene.add(this.group);
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  private buildGrid(): void {
    const pos: number[] = [];
    const col: number[] = [];
    const push = (x: number, z: number) => {
      pos.push(x, 0, z);
      const fade = 1 - Math.min(1, (ZNEAR - z) / (ZNEAR - ZFAR));
      const t = (x / XMAX) * 0.5 + 0.5;
      const c = this.cA.clone().lerp(this.cB, t).multiplyScalar(0.35 + fade * 0.9);
      col.push(c.r, c.g, c.b);
    };
    for (let x = -XMAX; x <= XMAX + 0.001; x += CELL) {
      push(x, ZNEAR);
      push(x, ZFAR);
    }
    for (let z = ZFAR; z <= ZNEAR + 0.001; z += CELL) {
      push(-XMAX, z);
      push(XMAX, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.grid = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 4), frame.beat ? frame.beatEnergy : 0);
    const react = num(params, 'reactivity', 1.4);
    this.scroll += dt * num(params, 'speed', 1.2) * (0.5 + frame.level * 1.8 * react);
    this.scroll %= CELL;
    this.gridGroup.position.z = this.scroll;
    (this.grid.material as THREE.LineBasicMaterial).opacity = Math.min(1, num(params, 'glow', 1.4) * (0.5 + frame.level * 0.6 + this.beatPulse * 0.6));
    this.skyMat.uniforms.uBass!.value = frame.bass;
    this.skyMat.uniforms.uLevel!.value = frame.level;
    this.skyMat.uniforms.uBeat!.value = this.beatPulse;
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    this.sky.scale.set(h * (width / height), h, 1);
    (this.skyMat.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.skyGeo.dispose();
    this.skyMat.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
  }
}
