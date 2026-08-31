import type * as THREE from 'three';
import type { AudioFrame } from '../audio/types';

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/** Global colour style shared by every preset, updated live from the control panel. */
export interface VisualStyle {
  hue: number; // 0..1 hue shift
  saturation: number; // saturation scale
  /** Palette gradient sample at t in [0,1], with hue/saturation applied, written into `out`. */
  sample(t: number, out: THREE.Color): THREE.Color;
}

export interface PresetContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewport: Viewport;
  style: VisualStyle;
}

export type ParamValue = number | string | boolean;

export type ParamDef =
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'toggle'; default: boolean }
  | { key: string; label: string; type: 'select'; options: string[]; default: string };

export type ParamSchema = readonly ParamDef[];
export type PresetParams = Record<string, ParamValue>;

/**
 * A swappable 3D visualization. Presets share one renderer/scene/camera, so each
 * one must fully own everything it adds to the scene and release it in dispose().
 * The `schema` is self-describing: the control panel is generated from it.
 */
export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly schema: ParamSchema;
  init(ctx: PresetContext, params: PresetParams): void;
  update(frame: AudioFrame, params: PresetParams, dt: number, t: number): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export function defaultsFromSchema(schema: ParamSchema): PresetParams {
  const params: PresetParams = {};
  for (const def of schema) params[def.key] = def.default;
  return params;
}

export function num(params: PresetParams, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

export function bool(params: PresetParams, key: string, fallback = false): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(params: PresetParams, key: string, fallback = ''): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}
