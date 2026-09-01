import * as THREE from 'three';
import { logBin } from '../../audio/analysis';
import type { AudioFrame } from '../../audio/types';
import { num, type ParamSchema, type Preset, type PresetContext, type PresetParams } from '../Preset';

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uRows, uHead, uBright, uContrast, uBeat, uBeatFlash;
uniform vec3 uPal[4];
varying vec2 vUv;
vec3 grad4(float t){
  t = clamp(t,0.0,1.0) * 3.0;
  if(t<1.0) return mix(uPal[0],uPal[1],t);
  if(t<2.0) return mix(uPal[1],uPal[2],t-1.0);
  return mix(uPal[2],uPal[3],t-2.0);
}
void main(){
  // Newest spectrum row sits at the top and scrolls down as history ages.
  float age = 1.0 - vUv.y;                       // 0 = newest (top), 1 = oldest (bottom)
  float rowFloat = (uHead - 1.0) - age * (uRows - 1.0);
  float v = fract(rowFloat / uRows);
  float m = texture2D(uTex, vec2(vUv.x, v)).r;
  m = pow(clamp(m * uBright, 0.0, 1.0), uContrast);
  // bright frequency traces on black — empty/quiet history stays dark (classic waterfall)
  float e = m * (0.35 + m * 1.6) + uBeat * uBeatFlash * 0.18 * m;
  vec3 col = grad4(m) * e;
  col *= smoothstep(0.0, 0.06, vUv.y);           // fade the oldest edge to black
  gl_FragColor = vec4(col, 1.0);
}
`;

const COLS = 256; // log-mapped frequency columns (independent of FFT size)

export const SCHEMA: ParamSchema = [
  { key: 'history', label: 'History', type: 'range', min: 60, max: 400, step: 10, default: 220 },
  { key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1.5 },
  { key: 'contrast', label: 'Contrast', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.2 },
  { key: 'beatFlash', label: 'Beat flash', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
];

/** A classic scrolling spectrogram waterfall: X = frequency (log), Y = time. */
export class Spectrogram implements Preset {
  readonly id = 'spectrogram';
  readonly label = 'Spectrogram';
  readonly schema = SCHEMA;

  private group = new THREE.Group();
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private ctx!: PresetContext;
  private tex!: THREE.DataTexture;
  private data!: Uint8Array;
  private rows = 0;
  private head = 0;
  private beatPulse = 0;
  private readonly pal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];

  init(ctx: PresetContext, params: PresetParams): void {
    this.ctx = ctx;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null },
        uRows: { value: 1 },
        uHead: { value: 0 },
        uBright: { value: num(params, 'brightness', 1.5) },
        uContrast: { value: num(params, 'contrast', 1.2) },
        uBeat: { value: 0 },
        uBeatFlash: { value: num(params, 'beatFlash', 0.6) },
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
    this.rebuild(Math.round(num(params, 'history', 220)));
    this.resize(ctx.viewport.width, ctx.viewport.height);
  }

  private rebuild(rows: number): void {
    this.tex?.dispose();
    this.rows = rows;
    this.head = 0;
    this.data = new Uint8Array(COLS * rows);
    this.tex = new THREE.DataTexture(this.data, COLS, rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.RepeatWrapping; // ring buffer wraps cleanly at the seam
    this.tex.needsUpdate = true;
    this.material.uniforms.uTex!.value = this.tex;
    this.material.uniforms.uRows!.value = rows;
  }

  update(frame: AudioFrame, params: PresetParams, dt: number, _t: number): void {
    const wanted = Math.round(num(params, 'history', 220));
    if (wanted !== this.rows) this.rebuild(wanted);

    this.beatPulse = Math.max(this.beatPulse * (1 - dt * 5), frame.beat ? frame.beatEnergy : 0);

    // write the newest spectrum into the current ring row (log-spaced columns)
    const rowOff = this.head * COLS;
    for (let x = 0; x < COLS; x++) {
      const bin = logBin(x / (COLS - 1), frame.binCount);
      this.data[rowOff + x] = frame.freq[bin]!;
    }
    this.tex.needsUpdate = true;
    this.head = (this.head + 1) % this.rows;

    const u = this.material.uniforms;
    u.uHead!.value = this.head;
    u.uBright!.value = num(params, 'brightness', 1.5);
    u.uContrast!.value = num(params, 'contrast', 1.2);
    u.uBeatFlash!.value = num(params, 'beatFlash', 0.6);
    u.uBeat!.value = this.beatPulse;
    for (let i = 0; i < 4; i++) this.ctx.style.sample(i / 3, this.pal[i]!);
  }

  resize(width: number, height: number): void {
    const cam = this.ctx.camera;
    const dist = cam.position.length();
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const h = 2 * Math.tan(vFov / 2) * dist;
    const w = h * (width / height);
    this.mesh.scale.set(w, h, 1);
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    this.tex?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
