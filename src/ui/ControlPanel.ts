import { Pane } from 'tweakpane';
import type { Settings } from '../state/Settings';
import type { ParamSchema } from '../visual/Preset';
import { paletteNames } from '../visual/palette';

type Folder = ReturnType<Pane['addFolder']>;

export interface PanelHooks {
  presets: { id: string; label: string }[];
  getSchema: (presetId: string) => ParamSchema;
  onChange: () => void;
  onPresetChange: (id: string) => void;
  onReset: () => void;
}

const FFT_OPTIONS: Record<string, number> = {
  '256 (coarse)': 256,
  '512': 512,
  '1024': 1024,
  '2048': 2048,
  '4096': 4096,
  '8192 (fine)': 8192,
};

function toOptions(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) out[v] = v;
  return out;
}

/** Tweakpane panel. Global audio/visual params plus a folder generated from the active preset's schema. */
export class ControlPanel {
  private readonly panel: HTMLElement;
  private pane!: Pane;
  private presetFolder: Folder | null = null;
  readonly readouts = { fps: 0, bpm: 0 };

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
    private readonly hooks: PanelHooks,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    root.appendChild(this.panel);
    this.build();
  }

  private build(): void {
    this.pane = new Pane({ container: this.panel, title: 'Controls' });
    this.pane.on('change', () => this.hooks.onChange());

    const live = this.pane.addFolder({ title: 'Live', expanded: true });
    live.addBinding(this.readouts, 'fps', { readonly: true, label: 'FPS', format: (v: number) => v.toFixed(0) });
    live.addBinding(this.readouts, 'bpm', { readonly: true, label: 'BPM', format: (v: number) => v.toFixed(0) });

    const audio = this.pane.addFolder({ title: 'Audio', expanded: false });
    audio.addBinding(this.settings.audio, 'gain', { label: 'Sensitivity', min: 0, max: 4, step: 0.01 });
    audio.addBinding(this.settings.audio, 'smoothing', { label: 'Smoothing', min: 0, max: 0.98, step: 0.01 });
    audio.addBinding(this.settings.audio, 'fftSize', { label: 'Resolution', options: FFT_OPTIONS });
    audio.addBinding(this.settings.audio, 'emphasisBass', { label: 'Bass', min: 0, max: 3, step: 0.01 });
    audio.addBinding(this.settings.audio, 'emphasisMid', { label: 'Mid', min: 0, max: 3, step: 0.01 });
    audio.addBinding(this.settings.audio, 'emphasisTreble', { label: 'Treble', min: 0, max: 3, step: 0.01 });
    audio.addBinding(this.settings.audio, 'beatSensitivity', { label: 'Beat sens.', min: 0.6, max: 3, step: 0.01 });

    const visual = this.pane.addFolder({ title: 'Visual', expanded: true });
    const presetOptions: Record<string, string> = {};
    for (const p of this.hooks.presets) presetOptions[p.label] = p.id;
    const presetBinding = visual.addBinding(this.settings.visual, 'preset', {
      label: 'Preset',
      options: presetOptions,
    });
    presetBinding.on('change', () => {
      this.hooks.onPresetChange(this.settings.visual.preset);
      this.rebuildPresetFolder();
    });
    visual.addBinding(this.settings.visual, 'autoShuffle', { label: 'Auto-shuffle' });
    visual.addBinding(this.settings.visual, 'shuffleSeconds', { label: 'Shuffle every (s)', min: 10, max: 1800, step: 5 });
    visual.addBinding(this.settings.visual, 'palette', { label: 'Palette', options: toOptions(paletteNames()) });
    visual.addBinding(this.settings.visual, 'hue', { label: 'Hue shift', min: 0, max: 1, step: 0.005 });
    visual.addBinding(this.settings.visual, 'saturation', { label: 'Saturation', min: 0, max: 2, step: 0.01 });
    visual.addBinding(this.settings.visual, 'rgbRotate', { label: 'RGB rotate' });
    visual.addBinding(this.settings.visual, 'rgbSpeed', { label: 'RGB speed', min: 0, max: 1, step: 0.005 });
    visual.addBinding(this.settings.visual, 'background', { label: 'Background' });
    visual.addBinding(this.settings.visual, 'bloom', { label: 'Bloom' });
    visual.addBinding(this.settings.visual, 'bloomStrength', { label: 'Bloom strength', min: 0, max: 3, step: 0.01 });
    visual.addBinding(this.settings.visual, 'bloomRadius', { label: 'Bloom radius', min: 0, max: 1.5, step: 0.01 });
    visual.addBinding(this.settings.visual, 'bloomThreshold', { label: 'Bloom threshold', min: 0, max: 1, step: 0.01 });
    visual.addBinding(this.settings.visual, 'cameraDynamics', { label: 'Beat camera' });
    visual.addBinding(this.settings.visual, 'cameraZoom', { label: 'Camera zoom', min: 0, max: 2, step: 0.01 });
    visual.addBinding(this.settings.visual, 'cameraShake', { label: 'Camera shake', min: 0, max: 2, step: 0.01 });
    visual.addBinding(this.settings.visual, 'resolution', { label: 'Render scale', min: 0.5, max: 2, step: 0.05 });
    visual.addButton({ title: 'Reset to defaults' }).on('click', () => this.hooks.onReset());

    this.rebuildPresetFolder();
  }

  private rebuildPresetFolder(): void {
    if (this.presetFolder) {
      this.presetFolder.dispose();
      this.presetFolder = null;
    }
    const id = this.settings.visual.preset;
    const schema = this.hooks.getSchema(id);
    const params = this.settings.presetParams[id];
    if (!params) return;
    const label = this.hooks.presets.find((p) => p.id === id)?.label ?? 'Preset';
    const folder = this.pane.addFolder({ title: label, expanded: true });
    for (const def of schema) {
      if (def.type === 'range') {
        folder.addBinding(params, def.key, { label: def.label, min: def.min, max: def.max, step: def.step });
      } else if (def.type === 'select') {
        folder.addBinding(params, def.key, { label: def.label, options: toOptions(def.options) });
      } else {
        // color (hex string) and toggle (boolean) auto-detect
        folder.addBinding(params, def.key, { label: def.label });
      }
    }
    this.presetFolder = folder;
  }

  /** Reflect a preset change made programmatically (e.g. auto-shuffle) in the UI. */
  syncPreset(): void {
    this.pane.refresh();
    this.rebuildPresetFolder();
  }

  /** Rebuild the whole pane from the current settings object (used after a reset). */
  rebuild(): void {
    this.pane.dispose();
    this.presetFolder = null;
    this.build();
  }

  setVisible(visible: boolean): void {
    this.panel.classList.toggle('open', visible);
  }

  toggle(): void {
    this.panel.classList.toggle('open');
  }

  isOpen(): boolean {
    return this.panel.classList.contains('open');
  }
}
