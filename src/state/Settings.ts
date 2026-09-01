import { defaultsFromSchema, type PresetParams } from '../visual/Preset';
import { SCHEMA as IcoBlobSchema } from '../visual/presets/IcoBlob';
import { SCHEMA as ParticleSchema } from '../visual/presets/ParticleField';
import { SCHEMA as RadialSchema } from '../visual/presets/RadialBars';
import { SCHEMA as ShaderSchema } from '../visual/presets/ShaderPlane';
import { SCHEMA as LightRaysSchema } from '../visual/presets/LightRays';
import { SCHEMA as PipesSchema } from '../visual/presets/Pipes';
import { SCHEMA as BubblesSchema } from '../visual/presets/Bubbles';
import { SCHEMA as GeoWarsSchema } from '../visual/presets/GeoWars';
import { SCHEMA as PrismSchema } from '../visual/presets/Prism';
import { SCHEMA as GeodeSchema } from '../visual/presets/Geode';
import { SCHEMA as UnderseaSchema } from '../visual/presets/Undersea';
import { SCHEMA as NebulaSchema } from '../visual/presets/Nebula';
import { SCHEMA as SynthwaveSchema } from '../visual/presets/Synthwave';
import { SCHEMA as TerrainSchema } from '../visual/presets/Terrain';
import { SCHEMA as KaleidoscopeSchema } from '../visual/presets/Kaleidoscope';
import { SCHEMA as AuroraSchema } from '../visual/presets/Aurora';
import { SCHEMA as FireworksSchema } from '../visual/presets/Fireworks';
import { SCHEMA as TeslaSchema } from '../visual/presets/Tesla';
import { SCHEMA as LavaLampSchema } from '../visual/presets/LavaLamp';
import { SCHEMA as FishSchema } from '../visual/presets/TropicalFish';
import { SCHEMA as FruitsSchema } from '../visual/presets/DancingFruits';
import { SCHEMA as LasersSchema } from '../visual/presets/Lasers';
import { SCHEMA as MatrixSchema } from '../visual/presets/Matrix';
import { SCHEMA as PlasmaSchema } from '../visual/presets/PlasmaGlobe';
import { SCHEMA as PianoSchema } from '../visual/presets/PianoRoll';
import { SCHEMA as GuitarSchema } from '../visual/presets/GuitarHero';
import { SCHEMA as BoidsSchema } from '../visual/presets/Boids';
import { SCHEMA as FluidSchema } from '../visual/presets/Fluid';
import { SCHEMA as SpectrogramSchema } from '../visual/presets/Spectrogram';
import { SCHEMA as BlackHoleSchema } from '../visual/presets/BlackHole';
import { SCHEMA as WormholeSchema } from '../visual/presets/Wormhole';
import { SCHEMA as FractalSchema } from '../visual/presets/FractalZoom';
import { SCHEMA as FerrofluidSchema } from '../visual/presets/Ferrofluid';
import { SCHEMA as CymaticsSchema } from '../visual/presets/Cymatics';
import { SCHEMA as OscilloscopeSchema } from '../visual/presets/Oscilloscope';
import { SCHEMA as RibbonsSchema } from '../visual/presets/Ribbons';
import { SCHEMA as VortexSchema } from '../visual/presets/Vortex';
import { SCHEMA as CitySchema } from '../visual/presets/CitySkyline';
import { SCHEMA as DNASchema } from '../visual/presets/DNAHelix';

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
  rgbRotate: boolean; // auto-cycle colours through the spectrum
  rgbSpeed: number; // hue cycles per second
  cameraDynamics: boolean; // global beat-reactive camera dolly/shake
  cameraZoom: number; // dolly-punch intensity (0 = off)
  cameraShake: number; // shake intensity (0 = off)
  autoShuffle: boolean; // auto-switch to a random preset on an interval
  shuffleSeconds: number; // seconds between auto-switches
}

export interface SpotifySettings {
  clientId: string; // overrides the baked-in DEFAULT_SPOTIFY_CLIENT_ID when set
  albumColors: boolean; // recolour the visuals from the album art
  beatLock: boolean; // pulse to the known beat grid when the mic can't hear the music
  beatIntensity: number; // 0..2 strength of the synthetic beats
}

export interface Settings {
  version: number;
  audio: AudioSettings;
  visual: VisualSettings;
  spotify: SpotifySettings;
  presetParams: Record<string, PresetParams>;
}

export const SETTINGS_VERSION = 2;

export function defaultPresetParams(): Record<string, PresetParams> {
  return {
    icoblob: defaultsFromSchema(IcoBlobSchema),
    particles: defaultsFromSchema(ParticleSchema),
    radialbars: defaultsFromSchema(RadialSchema),
    shaderplane: defaultsFromSchema(ShaderSchema),
    lightrays: defaultsFromSchema(LightRaysSchema),
    pipes: defaultsFromSchema(PipesSchema),
    bubbles: defaultsFromSchema(BubblesSchema),
    geowars: defaultsFromSchema(GeoWarsSchema),
    prism: defaultsFromSchema(PrismSchema),
    geode: defaultsFromSchema(GeodeSchema),
    undersea: defaultsFromSchema(UnderseaSchema),
    nebula: defaultsFromSchema(NebulaSchema),
    synthwave: defaultsFromSchema(SynthwaveSchema),
    terrain: defaultsFromSchema(TerrainSchema),
    kaleidoscope: defaultsFromSchema(KaleidoscopeSchema),
    aurora: defaultsFromSchema(AuroraSchema),
    fireworks: defaultsFromSchema(FireworksSchema),
    tesla: defaultsFromSchema(TeslaSchema),
    lavalamp: defaultsFromSchema(LavaLampSchema),
    fish: defaultsFromSchema(FishSchema),
    fruits: defaultsFromSchema(FruitsSchema),
    lasers: defaultsFromSchema(LasersSchema),
    matrix: defaultsFromSchema(MatrixSchema),
    plasmaglobe: defaultsFromSchema(PlasmaSchema),
    pianoroll: defaultsFromSchema(PianoSchema),
    guitarhero: defaultsFromSchema(GuitarSchema),
    boids: defaultsFromSchema(BoidsSchema),
    fluid: defaultsFromSchema(FluidSchema),
    spectrogram: defaultsFromSchema(SpectrogramSchema),
    blackhole: defaultsFromSchema(BlackHoleSchema),
    wormhole: defaultsFromSchema(WormholeSchema),
    fractal: defaultsFromSchema(FractalSchema),
    ferrofluid: defaultsFromSchema(FerrofluidSchema),
    cymatics: defaultsFromSchema(CymaticsSchema),
    oscilloscope: defaultsFromSchema(OscilloscopeSchema),
    ribbons: defaultsFromSchema(RibbonsSchema),
    vortex: defaultsFromSchema(VortexSchema),
    city: defaultsFromSchema(CitySchema),
    dna: defaultsFromSchema(DNASchema),
  };
}

export function defaultSettings(): Settings {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return {
    version: SETTINGS_VERSION,
    audio: {
      gain: 1.15,
      smoothing: 0.55,
      fftSize: 2048,
      emphasisBass: 1,
      emphasisMid: 1,
      emphasisTreble: 1,
      beatSensitivity: 1.2,
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
      rgbRotate: false,
      rgbSpeed: 0.1,
      cameraDynamics: true,
      cameraZoom: 1,
      cameraShake: 1,
      autoShuffle: false,
      shuffleSeconds: 300,
    },
    spotify: {
      clientId: '',
      albumColors: true,
      beatLock: true,
      beatIntensity: 1,
    },
    presetParams: defaultPresetParams(),
  };
}
