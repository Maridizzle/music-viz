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
  private readonly style: VisualStyle;
  private readonly bg = new THREE.Color('#05060a');

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
      this.active.dispose();
      this.clearScene();
    }
    this.active = next;
    this.activeParams = params;
    next.init(this.context(), params);
    next.resize(this.vp.width, this.vp.height, this.vp.dpr);
  }

  setParams(params: PresetParams): void {
    this.activeParams = params;
  }

  setStyle(paletteName: string, hue: number, saturation: number): void {
    this.paletteColors = getPalette(paletteName).colors;
    this.style.hue = hue;
    this.style.saturation = saturation;
  }

  setBackground(color: string): void {
    this.bg.set(color);
  }

  setBloom(b: BloomSettings): void {
    this.composer.setBloom(b.enabled, b.strength, b.radius, b.threshold);
  }

  render(frame: AudioFrame, dt: number, t: number): void {
    if (this.active) this.active.update(frame, this.activeParams, dt, t);
    this.composer.render();
  }

  resize(width: number, height: number, dpr: number): void {
    this.vp = { width, height, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height, dpr);
    this.active?.resize(width, height, dpr);
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
}
