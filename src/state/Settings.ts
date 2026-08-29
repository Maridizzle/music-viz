import { defaultsFromSchema, type PresetParams } from '../visual/Preset';
import { SCHEMA as IcoBlobSchema } from '../visual/presets/IcoBlob';
import { SCHEMA as ParticleSchema } from '../visual/presets/ParticleField';
import { SCHEMA as RadialSchema } from '../visual/presets/RadialBars';
import { SCHEMA as ShaderSchema } from '../visual/presets/ShaderPlane';

export interface AudioSettings {
  gain: number;
  smoothing: number;
  fftSize: number;
  emphasisBass: number;
  emphasisMid: number;
  emphasisTreble: number;
  beatSensitivity: number;
}

export interface VisualSettings {
  preset: string;
  palette: string;
  hue: number;
  saturation: number;
  background: string;
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  resolution: number; // devicePixelRatio cap
}

export interface Settings {
  version: number;
  audio: AudioSettings;
  visual: VisualSettings;
  presetParams: Record<string, PresetParams>;
}

export const SETTINGS_VERSION = 1;

export function defaultPresetParams(): Record<string, PresetParams> {
  return {
    icoblob: defaultsFromSchema(IcoBlobSchema),
    particles: defaultsFromSchema(ParticleSchema),
    radialbars: defaultsFromSchema(RadialSchema),
    shaderplane: defaultsFromSchema(ShaderSchema),
  };
}

export function defaultSettings(): Settings {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return {
    version: SETTINGS_VERSION,
    audio: {
      gain: 1,
      smoothing: 0.8,
      fftSize: 2048,
      emphasisBass: 1,
      emphasisMid: 1,
      emphasisTreble: 1,
      beatSensitivity: 1.4,
    },
    visual: {
      preset: 'icoblob',
      palette: 'Neon',
      hue: 0,
      saturation: 1,
      background: '#05060a',
      bloom: true,
      bloomStrength: 0.8,
      bloomRadius: 0.6,
      bloomThreshold: 0.82,
      resolution: mobile ? 1.5 : 2,
    },
    presetParams: defaultPresetParams(),
  };
}
