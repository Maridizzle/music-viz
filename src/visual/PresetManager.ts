import * as THREE from 'three';
import type { AudioFrame } from '../audio/types';
import { Composer } from './Composer';
import { adjustHSL, getPalette, sampleGradient } from './palette';
import type { Preset, PresetContext, PresetParams, VisualStyle, Viewport } from './Preset';

export interface BloomSettings {
  enabled: boolean;
  strength: number;
  radius: number;
  threshold: number;
}

const CAM_BASE_Z = 3.8;

/** Owns the single renderer/scene/camera/composer and swaps the active preset. */
export class PresetManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private composer: Composer;
  private presets = new Map<string, Preset>();
  private active: Preset | null = null;
  private activeParams: PresetParams = {};
  private vp: Viewport;

  private paletteColors: string[] = getPalette('Neon').colors;
  private paletteName = 'Neon';
  private paletteOverride: string[] | null = null; // e.g. colours pulled from album art
  private readonly style: VisualStyle;
  private readonly bg = new THREE.Color('#05060a');

  // Global beat-reactive camera dolly/shake, applied over whatever the preset draws.
  private camDyn = { enabled: true, zoom: 1, shake: 1 };
  private camPunch = 0;
  private camLevel = 0;
  private readonly camSeed = Math.random() * 100;

  constructor(parent: HTMLElement, width: number, height: number, dpr: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    parent.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.bg;
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 3.8);
    this.camera.lookAt(0, 0, 0);

    this.vp = { width, height, dpr };
    this.composer = new Composer(this.renderer, this.scene, this.camera, width, height, dpr);

    this.style = {
      hue: 0,
      saturation: 1,
      sample: (t, out) => {
        sampleGradient(this.paletteColors, t, out);
        return adjustHSL(out, this.style.hue, this.style.saturation);
      },
    };
  }

  register(preset: Preset): void {
    this.presets.set(preset.id, preset);
  }

  list(): { id: string; label: string }[] {
    return [...this.presets.values()].map((p) => ({ id: p.id, label: p.label }));
  }

  getActiveId(): string | null {
    return this.active?.id ?? null;
  }

  getSchema(id: string): Preset['schema'] | null {
    return this.presets.get(id)?.schema ?? null;
  }

  setPreset(id: string, params: PresetParams): void {
    const next = this.presets.get(id);
    if (!next) return;
    if (this.active) {
      // Free the outgoing preset's GPU resources *before* it detaches its objects,
      // so nothing is orphaned. A preset's own dispose() may miss a geometry; this
      // traversal is the safety net that keeps a long auto-shuffle run from leaking.
      this.disposeSceneResources();
      this.active.dispose();
      this.clearScene();
    }
    this.resetCamera(); // preset init/resize measures against the base camera
    this.active = next;
    this.activeParams = params;
    next.init(this.context(), params);
    next.resize(this.vp.width, this.vp.height, this.vp.dpr);
  }

  setParams(params: PresetParams): void {
    this.activeParams = params;
  }

  setStyle(paletteName: string, hue: number, saturation: number): void {
    this.paletteName = paletteName;
    this.style.hue = hue;
    this.style.saturation = saturation;
    this.applyPalette();
  }

  /** Temporarily replace the named palette (null restores it). Needs ≥ 2 colours. */
  setPaletteOverride(colors: string[] | null): void {
    this.paletteOverride = colors && colors.length >= 2 ? colors : null;
    this.applyPalette();
  }

  private applyPalette(): void {
    this.paletteColors = this.paletteOverride ?? getPalette(this.paletteName).colors;
  }

  /** Update only the hue (cheap; safe to call every frame for RGB rotation). */
  setHue(hue: number): void {
    this.style.hue = hue;
  }

  /** Global beat-reactive camera dolly + shake, applied on top of every preset. */
  setCameraDynamics(enabled: boolean, zoom: number, shake: number): void {
    this.camDyn.enabled = enabled;
    this.camDyn.zoom = zoom;
    this.camDyn.shake = shake;
    if (!enabled) this.resetCamera();
  }

  setBackground(color: string): void {
    this.bg.set(color);
  }

  setBloom(b: BloomSettings): void {
    this.composer.setBloom(b.enabled, b.strength, b.radius, b.threshold);
  }

  render(frame: AudioFrame, dt: number, t: number): void {
    if (this.active) this.active.update(frame, this.activeParams, dt, t);
    this.updateCamera(frame, dt, t);
    this.composer.render();
  }

  resize(width: number, height: number, dpr: number): void {
    this.vp = { width, height, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height, dpr);
    this.resetCamera(); // fullscreen-plane presets size to the base camera distance
    this.active?.resize(width, height, dpr);
  }

  private resetCamera(): void {
    this.camPunch = 0;
    this.camLevel = 0;
    this.camera.position.set(0, 0, CAM_BASE_Z);
    this.camera.rotation.z = 0;
    this.camera.lookAt(0, 0, 0);
  }

  private updateCamera(frame: AudioFrame, dt: number, t: number): void {
    if (!this.camDyn.enabled) return;
    this.camPunch = Math.max(this.camPunch * (1 - dt * 3.5), frame.beat ? frame.beatEnergy : 0);
    this.camLevel += (frame.level - this.camLevel) * Math.min(1, dt * 6);
    const { zoom, shake } = this.camDyn;
    // Dolly only ever moves *closer* than the base distance, so fullscreen-plane
    // presets keep over-filling the frustum and never reveal an edge.
    const z = CAM_BASE_Z * (1 - zoom * (0.11 * this.camPunch + 0.04 * this.camLevel));
    const amp = shake * this.camPunch * 0.09;
    const nx = Math.sin(t * 37 + this.camSeed) * 0.6 + Math.sin(t * 19.3) * 0.4;
    const ny = Math.sin(t * 31.7 + this.camSeed * 1.7) * 0.6 + Math.sin(t * 23.1) * 0.4;
    this.camera.position.set(nx * amp, ny * amp, z);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.z += Math.sin(t * 27.4 + this.camSeed) * amp * 0.15;
  }

  dispose(): void {
    this.active?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private context(): PresetContext {
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      viewport: this.vp,
      style: this.style,
    };
  }

  private clearScene(): void {
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      this.scene.remove(this.scene.children[i]!);
    }
  }

  /** Dispose every geometry/material currently in the scene graph (outgoing preset). */
  private disposeSceneResources(): void {
    this.scene.traverse((obj) => {
      const o = obj as unknown as { geometry?: { dispose?: () => void }; material?: unknown };
      o.geometry?.dispose?.();
      const mat = o.material;
      if (Array.isArray(mat)) {
        for (const m of mat) (m as { dispose?: () => void } | null)?.dispose?.();
      } else {
        (mat as { dispose?: () => void } | null)?.dispose?.();
      }
    });
  }
}
