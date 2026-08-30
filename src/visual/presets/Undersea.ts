import * as THREE from 'three';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';
import { SNOISE } from '../shaders';

export const SCHEMA: ParamSchema = [
  { key: 'plankton', label: 'Plankton', type: 'range', min: 0, max: 6000, step: 100, default: 900 },
  { key: 'godrays', label: 'God rays', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'caustics', label: 'Caustics', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  { key: 'sway', label: 'Sway', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
];

const BG_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uBass,uMid,uTreble,uLevel,uBeat,uGod,uCaust,uSway;
varying vec2 vUv;
${SNOISE}
void main(){
  vec2 uv = vUv;
  vec3 deep = vec3(0.01,0.05,0.11);
  vec3 mid  = vec3(0.02,0.17,0.27);
  vec3 top  = vec3(0.06,0.36,0.46);
  vec3 water = mix(deep, mix(mid, top, smoothstep(0.4,1.0,uv.y)), smoothstep(0.0,1.0,uv.y));

  // god-ray shafts from the surface
  vec2 p = uv - vec2(0.5, 1.15);
  float ang = atan(p.x, -p.y);
  float sway = sin(uTime*0.3 + uBass*3.0)*0.15*uSway;
  float rays = 0.5 + 0.5*sin(ang*16.0 + sway*8.0 + uTime*0.25);
  rays = pow(rays, 3.0);
  float godray = rays * smoothstep(1.0,0.1,uv.y) * (0.12 + uTreble*0.5 + uBeat*0.4) * uGod;

  // caustic shimmer
  float c = snoise(vec3(uv*6.0, uTime*0.4));
  c += 0.5*snoise(vec3(uv*13.0 + 4.0, uTime*0.7));
  float caustic = smoothstep(0.55,0.95,c) * (0.12 + uMid*0.5) * smoothstep(0.0,0.7,uv.y) * uCaust;

  vec3 col = water + vec3(0.45,0.85,0.95)*godray + vec3(0.55,0.95,1.0)*caustic;
  col *= 0.7 + uLevel*0.6;
  gl_FragColor = vec4(col,1.0);
}
`;

const P_VERT = /* glsl */ `
uniform float uTime,uLevel,uSway;
attribute float aSeed;
varying float vB;
void main(){
  vec3 pos = position;
  float ph = uTime*0.5 + aSeed*6.28;
  pos.x += sin(ph)*0.15*uSway;
  pos.y = mod(pos.y + uTime*(0.05 + uLevel*0.12) + aSeed, 3.2) - 1.6;
  vec4 mv = modelViewMatrix * vec4(pos,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.8 + uLevel*2.0) * (11.0/max(0.1,-mv.z)), 1.0, 6.0);
  vB = 0.4 + 0.6*fract(aSeed*3.3);
}
`;
const P_FRAG = /* glsl */ `
varying float vB;
void main(){
  vec2 d = gl_PointCoord-0.5;
  if(dot(d,d)>0.25) discard;
  float g = smoothstep(0.25,0.0,dot(d,d));
  gl_FragColor = vec4(vec3(0.55,0.8,0.92)*g*vB*0.6, g*vB*0.55);
}
`;

export class Undersea implements Preset {
  readonly id = 'undersea';
  readonly label = 'Undersea';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private bgGeo!: THREE.PlaneGeometry;
  private bgMat!: THREE.ShaderMaterial;
  private bg!: THREE.Mesh;
  private pMat!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private ctx!: PresetContext;
  private count = 0;

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.bgGeo = new THREE.PlaneGeometry(1, 1);
    this.bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
        uLevel: { value: 0 }, uBeat: { value: 0 },
        uGod: { value: 1 }, uCaust: { value: 1 }, uSway: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: BG_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.bg = new THREE.Mesh(this.bgGeo, this.bgMat);
    this.bg.renderOrder = -1;

    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uSway: { value: 1 } },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.pMat);
    this.group.add(this.bg, this.points);
    ctx.scene.add(this.group);
    this.rebuild(Math.round(num(params, 'plankton', 1800)));
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  private rebuild(count: number): void {
    this.count = count;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 3;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 1.6;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 1.2;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.points.geometry.dispose();
    this.points.geometry = geo;
  }

  update(frame: AudioFrame, params: PresetParams, _dt: number, t: number): void {
    const wanted = Math.round(num(params, 'plankton', 1800));
    if (wanted !== this.count) this.rebuild(wanted);
    const u = this.bgMat.uniforms;
    u.uTime!.value = t;
    u.uBass!.value = frame.bass;
    u.uMid!.value = frame.mid;
    u.uTreble!.value = frame.treble;
    u.uLevel!.value = frame.level;
    u.uBeat!.value = frame.beat ? frame.beatEnergy : 0;
    u.uGod!.value = num(params, 'godrays', 1);
    u.uCaust!.value = num(params, 'caustics', 1);
    u.uSway!.value = num(params, 'sway', 1);
    this.pMat.uniforms.uTime!.value = t;
    this.pMat.uniforms.uLevel!.value = frame.level;
    this.pMat.uniforms.uSway!.value = num(params, 'sway', 1);
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    this.bg.scale.set(h * (width / height), h, 1);
    (this.bgMat.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.bgGeo.dispose();
    this.bgMat.dispose();
    this.points.geometry.dispose();
    this.pMat.dispose();
  }
}
