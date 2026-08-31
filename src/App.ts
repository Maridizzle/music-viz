import { AudioEngine } from './audio/AudioEngine';
import { defaultSettings, type Settings } from './state/Settings';
import { clearSettings, loadSettings, saveSettings } from './state/store';
import { ControlPanel } from './ui/ControlPanel';
import { UIShell } from './ui/overlay';
import { hasDisplayMedia, hasFullscreen, hasWakeLock } from './util/env';
import { Loop } from './util/loop';
import { ViewportWatcher, type ViewportSize } from './util/viewport';
import { PresetManager } from './visual/PresetManager';
import { IcoBlob } from './visual/presets/IcoBlob';
import { ParticleField } from './visual/presets/ParticleField';
import { RadialBars } from './visual/presets/RadialBars';
import { ShaderPlane } from './visual/presets/ShaderPlane';
import { LightRays } from './visual/presets/LightRays';
import { Pipes } from './visual/presets/Pipes';
import { Bubbles } from './visual/presets/Bubbles';
import { GeoWars } from './visual/presets/GeoWars';
import { Prism } from './visual/presets/Prism';
import { Geode } from './visual/presets/Geode';
import { Undersea } from './visual/presets/Undersea';
import { Nebula } from './visual/presets/Nebula';
import { Synthwave } from './visual/presets/Synthwave';
import { Terrain } from './visual/presets/Terrain';
import { Kaleidoscope } from './visual/presets/Kaleidoscope';
import { Aurora } from './visual/presets/Aurora';
import { Fireworks } from './visual/presets/Fireworks';
import { Tesla } from './visual/presets/Tesla';
import { LavaLamp } from './visual/presets/LavaLamp';
import { TropicalFish } from './visual/presets/TropicalFish';
import { DancingFruits } from './visual/presets/DancingFruits';
import { Lasers } from './visual/presets/Lasers';
import { Matrix } from './visual/presets/Matrix';
import { PlasmaGlobe } from './visual/presets/PlasmaGlobe';
import { PianoRoll } from './visual/presets/PianoRoll';
import { GuitarHero } from './visual/presets/GuitarHero';

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError') return 'Permission denied. Allow access and try again.';
    if (e.name === 'NotFoundError') return 'No matching input device was found.';
    return e.message;
  }
  return 'Could not connect to that source.';
}

function applyDefaultsInPlace(target: Settings): void {
  const d = defaultSettings();
  target.version = d.version;
  Object.assign(target.audio, d.audio);
  Object.assign(target.visual, d.visual);
  for (const k of Object.keys(target.presetParams)) delete target.presetParams[k];
  Object.assign(target.presetParams, d.presetParams);
}

export class App {
  private readonly settings: Settings;
  private readonly engine: AudioEngine;
  private readonly manager: PresetManager;
  private readonly shell: UIShell;
  private readonly panel: ControlPanel;
  private readonly loop: Loop;
  private readonly viewport: ViewportWatcher;

  private started = false;
  private corsWarned = false;
  private wakeLock: WakeLockSentinel | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private huePhase = 0;
  private lastFrame: { bass: number; mid: number; treble: number; level: number; beat: boolean } | null = null;

  constructor(private readonly root: HTMLElement) {
    this.settings = loadSettings();

    const width = root.clientWidth || window.innerWidth;
    const height = root.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.visual.resolution);

    this.engine = new AudioEngine({
      fftSize: this.settings.audio.fftSize,
      smoothingTimeConstant: this.settings.audio.smoothing,
      gain: this.settings.audio.gain,
    });
    this.engine.onEnded = () => {
      this.started = false;
      this.shell.showOverlay();
      this.shell.setStatus('The source ended — pick another to continue.');
    };

    this.manager = new PresetManager(root, width, height, dpr);
    for (const preset of [
      new IcoBlob(),
      new ParticleField(),
      new RadialBars(),
      new ShaderPlane(),
      new LightRays(),
      new Pipes(),
      new Bubbles(),
      new GeoWars(),
      new Prism(),
      new Geode(),
      new Undersea(),
      new Nebula(),
      new Synthwave(),
      new Terrain(),
      new Kaleidoscope(),
      new Aurora(),
      new Fireworks(),
      new Tesla(),
      new LavaLamp(),
      new TropicalFish(),
      new DancingFruits(),
      new Lasers(),
      new Matrix(),
      new PlasmaGlobe(),
      new PianoRoll(),
      new GuitarHero(),
    ]) {
      this.manager.register(preset);
    }
    let pid = this.settings.visual.preset;
    if (!this.manager.getSchema(pid)) {
      pid = 'icoblob';
      this.settings.visual.preset = pid;
    }
    this.manager.setPreset(pid, this.settings.presetParams[pid]!);

    this.shell = new UIShell(
      root,
      {
        source: {
          onMic: () => void this.connect('mic'),
          onDisplay: () => void this.connect('display'),
          onFile: (file) => void this.connect('file', file),
          onUrl: (url) => void this.connect('url', url),
        },
        onTogglePanel: () => this.panel.toggle(),
        onFullscreen: () => this.toggleFullscreen(),
      },
      { showDisplay: hasDisplayMedia(), showFullscreen: hasFullscreen() },
    );

    this.panel = new ControlPanel(root, this.settings, {
      presets: this.manager.list(),
      getSchema: (id) => this.manager.getSchema(id) ?? [],
      onChange: () => this.apply(),
      onPresetChange: (id) => {
        this.manager.setPreset(id, this.settings.presetParams[id]!);
        saveSettings(this.settings);
      },
      onReset: () => this.reset(),
    });

    this.viewport = new ViewportWatcher(root, this.settings.visual.resolution, (size) => this.onResize(size));
    this.loop = new Loop((dt, t) => this.frame(dt, t));

    this.registerEvents();
    this.apply();
  }

  start(): void {
    this.shell.showOverlay();
    this.loop.start(); // idle visuals run behind the overlay
  }

  /** Switch preset by id at runtime (used by deep-links / smoke tests). */
  setPreset(id: string): void {
    if (!this.manager.getSchema(id)) return;
    this.settings.visual.preset = id;
    this.manager.setPreset(id, this.settings.presetParams[id]!);
    saveSettings(this.settings);
  }

  /** Debug/test hooks (only reachable via the ?debug window handle). */
  debugMetrics(): { bass: number; mid: number; treble: number; level: number; beat: boolean } | null {
    return this.lastFrame;
  }
  debugConnect(kind: 'mic' | 'display' | 'file' | 'url', arg?: File | string): Promise<void> {
    return this.connect(kind, arg);
  }

  // ---- source connection ----

  private async connect(kind: 'mic' | 'display' | 'file' | 'url', arg?: File | string): Promise<void> {
    this.shell.setBusy(true);
    this.shell.setStatus('Connecting…');
    this.corsWarned = false;
    try {
      if (kind === 'mic') await this.engine.useMicrophone();
      else if (kind === 'display') await this.engine.useDisplayAudio();
      else if (kind === 'file') await this.engine.useFile(arg as File);
      else await this.engine.useUrl(arg as string);
      this.onConnected();
    } catch (e) {
      this.shell.setBusy(false);
      this.shell.setStatus(describeError(e), true);
    }
  }

  private onConnected(): void {
    this.started = true;
    this.shell.setStatus('');
    this.shell.hideOverlay();
    this.shell.toast('Source connected');
    if (!this.panel.isOpen()) this.shell.toast('Tap ⚙️ to adjust the visuals');
    void this.requestWakeLock();
    if (!this.loop.isRunning) this.loop.start();
  }

  // ---- frame ----

  private frame(dt: number, t: number): void {
    const frame = this.engine.update();
    this.lastFrame = { bass: frame.bass, mid: frame.mid, treble: frame.treble, level: frame.level, beat: frame.beat };

    if (this.settings.visual.rgbRotate) {
      this.huePhase = (this.huePhase + dt * this.settings.visual.rgbSpeed) % 1;
      this.manager.setHue((this.settings.visual.hue + this.huePhase) % 1);
    }

    this.manager.render(frame, dt, t);

    this.panel.readouts.bpm = frame.bpm;
    this.fpsFrames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      this.panel.readouts.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (!this.corsWarned && this.engine.isProbablyCorsBlocked()) {
      this.corsWarned = true;
      this.shell.toast('This stream plays but blocks analysis (no CORS headers).', true);
    }
  }

  // ---- settings ----

  private apply(): void {
    const s = this.settings;
    this.engine.setGain(s.audio.gain);
    this.engine.setSmoothing(s.audio.smoothing);
    this.engine.setFftSize(s.audio.fftSize);
    this.engine.emphasis.bass = s.audio.emphasisBass;
    this.engine.emphasis.mid = s.audio.emphasisMid;
    this.engine.emphasis.treble = s.audio.emphasisTreble;
    this.engine.setBeatSensitivity(s.audio.beatSensitivity);

    this.manager.setStyle(s.visual.palette, s.visual.hue, s.visual.saturation);
    this.manager.setBackground(s.visual.background);
    this.manager.setBloom({
      enabled: s.visual.bloom,
      strength: s.visual.bloomStrength,
      radius: s.visual.bloomRadius,
      threshold: s.visual.bloomThreshold,
    });
    this.viewport.setDprCap(s.visual.resolution);

    saveSettings(s);
  }

  private reset(): void {
    clearSettings();
    applyDefaultsInPlace(this.settings);
    this.manager.setPreset(this.settings.visual.preset, this.settings.presetParams[this.settings.visual.preset]!);
    this.apply();
    this.panel.rebuild();
    this.shell.toast('Settings reset to defaults');
  }

  // ---- view / platform ----

  private onResize(size: ViewportSize): void {
    this.manager.resize(size.width, size.height, size.dpr);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.root.requestFullscreen?.().catch(() => this.shell.toast('Fullscreen is not available here.', true));
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!hasWakeLock()) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* denied / not allowed while hidden */
    }
  }

  private registerEvents(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.loop.stop();
        void this.wakeLock?.release();
        this.wakeLock = null;
      } else {
        if (this.started && this.engine.state === 'suspended') void this.engine.resume();
        this.loop.start();
        if (this.started) void this.requestWakeLock();
      }
    });

    const canvas = this.manager.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.loop.stop();
      this.shell.toast('Graphics context lost — restoring…', true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      const id = this.settings.visual.preset;
      this.manager.setPreset(id, this.settings.presetParams[id]!);
      this.apply();
      this.loop.start();
    });
  }
}
