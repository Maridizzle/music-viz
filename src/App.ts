import { AudioEngine } from './audio/AudioEngine';
import { hasNativeCapture, startNativeCapture, type NativeCapture } from './audio/androidCapture';
import { defaultSettings, type Settings } from './state/Settings';
import { clearSettings, loadSettings, saveSettings } from './state/store';
import { DEFAULT_SPOTIFY_CLIENT_ID } from './spotify/config';
import { platformKind } from './spotify/platform';
import { SpotifyMode } from './spotify/SpotifyMode';
import type { SpotifyModeState, SpotifyTrack, TempoInfo } from './spotify/types';
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
import { Boids } from './visual/presets/Boids';
import { Fluid } from './visual/presets/Fluid';
import { Spectrogram } from './visual/presets/Spectrogram';
import { BlackHole } from './visual/presets/BlackHole';
import { Wormhole } from './visual/presets/Wormhole';
import { FractalZoom } from './visual/presets/FractalZoom';
import { Ferrofluid } from './visual/presets/Ferrofluid';
import { Cymatics } from './visual/presets/Cymatics';
import { Oscilloscope } from './visual/presets/Oscilloscope';
import { Ribbons } from './visual/presets/Ribbons';
import { Vortex } from './visual/presets/Vortex';
import { CitySkyline } from './visual/presets/CitySkyline';
import { DNAHelix } from './visual/presets/DNAHelix';

type SourceRequest = 'mic' | 'display' | 'file' | 'url' | 'spotify';

interface FrameMetrics {
  bass: number;
  mid: number;
  treble: number;
  level: number;
  beat: boolean;
  bpm: number;
}

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
  const clientId = target.spotify.clientId; // configuration, not a preference — survives a reset
  Object.assign(target.spotify, d.spotify);
  target.spotify.clientId = clientId;
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
  private readonly spotify: SpotifyMode;

  private started = false;
  private readonly isDesktop = !!(window as unknown as { mvDesktop?: unknown }).mvDesktop;
  private corsWarned = false;
  private wakeLock: WakeLockSentinel | null = null;
  private nativeCapture: NativeCapture | null = null;
  private resumeArmed = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private huePhase = 0;
  private shuffleAccum = 0;
  private lastFrame: FrameMetrics | null = null;

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
    this.engine.onEnded = (kind) => {
      // In Spotify mode the audio input is just the ears; if it drops (device
      // change), get it back quietly and keep going.
      if (this.spotify.isActive && (kind === 'mic' || (this.isDesktop && kind === 'display'))) {
        void this.spotify.recoverMic();
        return;
      }
      this.started = false;
      if (this.isDesktop) {
        // A device change (e.g. plugging in headphones) ends the loopback stream —
        // auto-reconnect instead of dropping to the picker.
        this.shell.toast('Audio device changed — reconnecting…');
        void this.startDesktopAudio();
        return;
      }
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
      new Boids(),
      new Fluid(),
      new Spectrogram(),
      new BlackHole(),
      new Wormhole(),
      new FractalZoom(),
      new Ferrofluid(),
      new Cymatics(),
      new Oscilloscope(),
      new Ribbons(),
      new Vortex(),
      new CitySkyline(),
      new DNAHelix(),
    ]) {
      this.manager.register(preset);
    }
    let pid = this.settings.visual.preset;
    if (!this.manager.getSchema(pid)) {
      pid = 'icoblob';
      this.settings.visual.preset = pid;
    }
    this.manager.setPreset(pid, this.settings.presetParams[pid]!);

    this.spotify = new SpotifyMode({
      getClientId: () => this.settings.spotify.clientId.trim() || DEFAULT_SPOTIFY_CLIENT_ID,
      // On the desktop the loopback already hears everything; elsewhere listen with the mic.
      connectMic: async () => {
        if (this.isDesktop) {
          if (this.engine.getCurrentSource() !== 'display') await this.engine.useDisplayAudio();
          return;
        }
        await this.engine.useMicrophone();
      },
      onPalette: (colors) => this.manager.setPaletteOverride(colors),
      onTrack: (track, tempo) => this.shell.nowPlaying.setTrack(track, tempo),
      onStatus: (state, detail) => this.onSpotifyStatus(state, detail),
      onError: (message, fatal) => {
        this.shell.toast(message, true);
        if (fatal) {
          this.shell.nowPlaying.hide();
          this.started = false;
          this.shell.showOverlay();
          this.shell.setStatus(message, true);
          this.panel.syncSpotify();
        }
      },
      toast: (message, isError) => this.shell.toast(message, isError),
      engineInfo: () => ({
        binCount: this.engine.analyser.frequencyBinCount,
        fftSize: this.engine.analyser.fftSize,
        sampleRate: this.engine.context.sampleRate,
      }),
    });
    this.spotify.settings = this.settings.spotify;

    this.shell = new UIShell(
      root,
      {
        source: {
          onSpotify: () => void this.connect('spotify'),
          onMic: () => void this.connect('mic'),
          onDisplay: () => void this.connect('display'),
          onFile: (file) => void this.connect('file', file),
          onUrl: (url) => void this.connect('url', url),
        },
        onTogglePanel: () => this.panel.toggle(),
        onFullscreen: () => this.toggleFullscreen(),
        nowPlaying: {
          onTapBeat: () => this.spotify.tapBeat(),
          onDisconnect: () => this.leaveSpotify(),
        },
      },
      {
        showDisplay: hasDisplayMedia() || hasNativeCapture(),
        nativeCapture: hasNativeCapture(),
        showFullscreen: hasFullscreen(),
      },
    );

    this.panel = new ControlPanel(root, this.settings, {
      presets: this.manager.list(),
      getSchema: (id) => this.manager.getSchema(id) ?? [],
      onChange: () => this.apply(),
      onPresetChange: (id) => {
        this.shuffleAccum = 0;
        this.manager.setPreset(id, this.settings.presetParams[id]!);
        saveSettings(this.settings);
      },
      onReset: () => this.reset(),
      spotify: {
        isConnected: () => this.spotify.isConnected(),
        connect: () => void this.connect('spotify'),
        disconnect: () => this.logoutSpotify(),
      },
    });

    this.viewport = new ViewportWatcher(root, this.settings.visual.resolution, (size) => this.onResize(size));
    this.loop = new Loop((dt, t) => this.frame(dt, t));

    this.registerEvents();
    this.apply();
    this.onSpotifyStatus('off', '');
  }

  start(): void {
    this.shell.showOverlay();
    this.loop.start(); // idle visuals run behind the overlay
  }

  /** Desktop (Electron) mode: run ambient visuals with no source overlay. */
  startDesktopIdle(screensaver = false): void {
    this.shell.hideOverlay();
    this.loop.start();
    this.shell.toast(screensaver ? 'Move the mouse or press a key to exit' : 'Esc or close to exit · ⚙️ for presets');
  }

  /** Desktop mode: auto-capture system audio (WASAPI loopback, granted by the Electron shell). */
  async startDesktopAudio(): Promise<void> {
    // Retry a few times — capture can transiently fail right at launch or during a
    // device change before the new default device is ready.
    for (let attempt = 0; attempt < 3 && !this.started; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 700));
      await this.connect('display');
    }
    if (!this.started) this.shell.showOverlay(); // gave up → let the user pick a source manually
    // A Spotify login from an earlier session carries over: resume it for the
    // album colours + now-playing card (the loopback stays the audio input).
    if (this.started && this.spotify.isConnected() && !this.spotify.isActive) await this.connect('spotify');
  }

  /** Switch preset by id at runtime (used by deep-links / smoke tests). */
  setPreset(id: string): void {
    if (!this.manager.getSchema(id)) return;
    this.shuffleAccum = 0;
    this.settings.visual.preset = id;
    this.manager.setPreset(id, this.settings.presetParams[id]!);
    saveSettings(this.settings);
  }

  toast(message: string, isError = false): void {
    this.shell.toast(message, isError);
  }

  // ---- Spotify ----

  /** Finish the OAuth round-trip (the callback URL) and enter Spotify mode. */
  async completeSpotifyLogin(url: string): Promise<void> {
    try {
      await this.spotify.completeLogin(url);
    } catch (e) {
      this.shell.showOverlay();
      this.shell.setStatus(describeError(e), true);
      return;
    }
    this.panel.syncSpotify();
    this.shell.toast('Spotify connected');
    await this.connect('spotify');
  }

  private async connectSpotify(): Promise<void> {
    if (!this.spotify.isConnected()) {
      const clientId = this.settings.spotify.clientId.trim() || DEFAULT_SPOTIFY_CLIENT_ID;
      if (!clientId) {
        this.shell.setBusy(false);
        this.shell.setStatus('Spotify needs a Client ID first: open ⚙️ → Spotify and paste yours (see the README).', true);
        this.panel.setVisible(true);
        return;
      }
      this.shell.setStatus('Opening Spotify login…');
      await this.spotify.login(); // web: navigates away; native shells come back via musicviz://
      this.shell.setBusy(false);
      this.shell.setStatus(platformKind() === 'web' ? 'Redirecting to Spotify…' : 'Finish logging in, then come back here.');
      return;
    }
    await this.stopNativeCapture();
    await this.spotify.start();
    this.onConnected();
    this.shell.nowPlaying.show();
    this.panel.syncSpotify();
    // Browsers (iOS especially) only run audio after a gesture; if we got here from a
    // redirect there hasn't been one yet.
    if (this.engine.state !== 'running') this.armResumeOnGesture();
  }

  private leaveSpotify(): void {
    this.spotify.stop();
    this.shell.nowPlaying.hide();
    this.started = false;
    this.shell.showOverlay();
    this.panel.syncSpotify();
  }

  private logoutSpotify(): void {
    this.spotify.logout();
    this.shell.nowPlaying.hide();
    this.started = false;
    this.shell.showOverlay();
    this.shell.toast('Disconnected from Spotify');
    this.panel.syncSpotify();
  }

  private onSpotifyStatus(state: SpotifyModeState, detail: string): void {
    this.shell.nowPlaying.setState(state, detail);
    this.panel.readouts.spotify =
      state === 'off' ? (this.spotify.isConnected() ? 'Connected (not active)' : 'Not connected') : detail;
  }

  private armResumeOnGesture(): void {
    if (this.resumeArmed) return;
    this.resumeArmed = true;
    this.shell.toast('Tap anywhere to start listening');
    const handler = (): void => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      this.resumeArmed = false;
      void this.engine.resume();
    };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
  }

  /** Debug/test hooks (only reachable via the ?debug window handle). */
  debugMetrics(): FrameMetrics | null {
    return this.lastFrame;
  }
  debugConnect(kind: SourceRequest, arg?: File | string): Promise<void> {
    return this.connect(kind, arg);
  }
  debugSpotify(): {
    connected: boolean;
    active: boolean;
    state: SpotifyModeState;
    track: SpotifyTrack | null;
    tempo: TempoInfo | null;
    rawLevel: number;
  } {
    return {
      connected: this.spotify.isConnected(),
      active: this.spotify.isActive,
      state: this.spotify.state,
      track: this.spotify.currentTrack,
      tempo: this.spotify.currentTempo,
      rawLevel: this.engine.raw.level,
    };
  }
  debugTapBeat(): void {
    this.spotify.tapBeat();
  }

  // ---- source connection ----

  private async connect(kind: SourceRequest, arg?: File | string): Promise<void> {
    this.shell.setBusy(true);
    this.shell.setStatus('Connecting…');
    this.corsWarned = false;
    try {
      if (kind === 'spotify') {
        await this.connectSpotify();
        return;
      }
      if (this.spotify.isActive) {
        this.spotify.stop();
        this.shell.nowPlaying.hide();
        this.panel.syncSpotify();
      }
      if (kind !== 'display') await this.stopNativeCapture();
      if (kind === 'mic') await this.engine.useMicrophone();
      else if (kind === 'display') {
        if (hasNativeCapture()) await this.connectNativeCapture();
        else await this.engine.useDisplayAudio();
      } else if (kind === 'file') await this.engine.useFile(arg as File);
      else await this.engine.useUrl(arg as string);
      this.onConnected();
    } catch (e) {
      this.shell.setBusy(false);
      this.shell.setStatus(describeError(e), true);
    }
  }

  /** Android app: capture other apps' audio natively and feed it to the engine as a stream. */
  private async connectNativeCapture(): Promise<void> {
    await this.engine.resume();
    await this.stopNativeCapture();
    this.shell.setStatus('Choose "Entire screen" when Android asks — only the audio is used.');
    const capture = await startNativeCapture(this.engine.context);
    capture.onEnded = () => {
      this.nativeCapture = null;
      this.engine.onEnded?.('display');
    };
    this.nativeCapture = capture;
    this.engine.useMediaStream(capture.stream, 'display');
  }

  private async stopNativeCapture(): Promise<void> {
    const capture = this.nativeCapture;
    if (!capture) return;
    this.nativeCapture = null;
    capture.onEnded = null;
    await capture.stop();
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
    const engineFrame = this.engine.update();
    const frame = this.spotify.process(engineFrame, this.engine.raw.level, dt);
    this.lastFrame = {
      bass: frame.bass,
      mid: frame.mid,
      treble: frame.treble,
      level: frame.level,
      beat: frame.beat,
      bpm: frame.bpm,
    };

    if (this.settings.visual.rgbRotate) {
      this.huePhase = (this.huePhase + dt * this.settings.visual.rgbSpeed) % 1;
      this.manager.setHue((this.settings.visual.hue + this.huePhase) % 1);
    }

    if (this.settings.visual.autoShuffle) {
      this.shuffleAccum += dt;
      if (this.shuffleAccum >= Math.max(5, this.settings.visual.shuffleSeconds)) {
        this.shuffleAccum = 0;
        this.shuffleToRandomPreset();
      }
    } else if (this.shuffleAccum !== 0) {
      this.shuffleAccum = 0;
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

  /** Auto-shuffle: jump to a random preset different from the current one. */
  private shuffleToRandomPreset(): void {
    const list = this.manager.list();
    if (list.length < 2) return;
    const current = this.settings.visual.preset;
    let pick = current;
    for (let i = 0; i < 12 && pick === current; i++) {
      pick = list[Math.floor(Math.random() * list.length)]!.id;
    }
    this.settings.visual.preset = pick;
    this.manager.setPreset(pick, this.settings.presetParams[pick]!);
    this.panel.syncPreset();
    saveSettings(this.settings);
    this.shell.toast(`Shuffled → ${list.find((p) => p.id === pick)?.label ?? pick}`);
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
    this.manager.setCameraDynamics(s.visual.cameraDynamics, s.visual.cameraZoom, s.visual.cameraShake);
    this.viewport.setDprCap(s.visual.resolution);

    this.spotify.settings = s.spotify;
    this.spotify.refreshPalette();

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
