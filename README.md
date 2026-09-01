# Music Visualizer

An adjustable **WebGL 3D music visualizer** that reacts to live audio, built for
both **phone and PC**. It runs entirely in the browser (Three.js + Web Audio API),
has a touch-friendly control panel, and auto-deploys to GitHub Pages.

**Live site:** https://maridizzle.github.io/music-viz/

## Audio sources

Browsers can't read the audio of DRM services like Spotify or Apple Music directly,
so the visualizer reacts to one of three sources you pick in-app:

| Source | Works on | Notes |
| --- | --- | --- |
| 🎤 **Microphone** | phone + PC | Reacts to whatever is playing out loud in the room. |
| 🖥️ **Tab / system audio** | desktop Chrome/Edge only | Capture a Spotify‑web or YouTube tab directly. When the browser asks, tick **"Share tab audio" / "Share system audio"**. |
| 📁 **Audio file** | phone + PC | Play a track from your device. |
| 🔗 **Stream URL** | phone + PC | An internet‑radio / direct audio link. The stream server must send CORS headers (`Access-Control-Allow-Origin`) or the analyser reads silence — the app will warn you when that happens. Must be `https://`. |

> Microphone and tab/system capture require a secure (HTTPS) origin — that's why
> the deployed Pages URL is the easiest way to use it on a phone.

## Presets & controls

Thirty-nine switchable 3D presets:

- **Ico Blob** — audio‑displaced icosahedron
- **Particle Field** — GPU point cloud
- **Radial Bars** — circular equalizer
- **Shader Plane** — fullscreen fragment‑shader patterns
- **Light Rays** — radial god‑rays
- **Pipes** — self‑drawing 3D pipes whose draw‑speed and thickness ride the music
- **Bubbles** — translucent spheres, each dancing to its own frequency band
- **Geo Wars** — interlocking neon triangles flowing through a tunnel
- **Prism** — a glass prism splitting a beam into a reactive rainbow spectrum
- **Geode** — a radiating crystal cluster that grows and glints to the spectrum
- **Undersea** — god‑ray shafts, caustics and drifting plankton
- **Nebula** — a spiral galaxy of stars with a glowing core
- **Synthwave** — Outrun sunset, retro sun and a scrolling neon grid
- **Audio Terrain** — a wireframe mountain range that is the live spectrum
- **Kaleidoscope** — mirrored, symmetric shifting mandalas
- **Aurora** — flowing northern‑lights curtains
- **Fireworks** — particle bursts launched on beats
- **Tesla** — lightning arcs crackling from a core
- **Lava Lamp** — gooey metaball blobs merging and rising
- **Tropical Fish** — a school of fish swimming and darting on beats
- **Dancing Fruits** — a row of fruit each bouncing to its own frequency band
- **Dancing Lasers** — a concert laser rig sweeping, fanning and strobing
- **Matrix Rain** — falling green code glyphs with bright leading heads
- **Plasma Globe** — a glass sphere with electric tendrils wandering to its surface
- **Piano Roll** — synthesia-style notes scrolling onto a light-up keyboard
- **Guitar Hero** — a 5-lane note highway with gems flying at the screen
- **Boids Swarm** — a flock of neon darts that shoals to the music and bursts apart on beats
- **Fluid Smoke** — billowing curl‑noise smoke that advects, swirls and lights up with the sound
- **Spectrogram** — a scrolling waterfall of the live spectrum (frequency ✕ time)
- **Black Hole** — an accretion disk orbiting a dark event horizon, with a photon ring
- **Wormhole** — a fly‑through tunnel of ringed, noise‑textured walls twisting inward
- **Fractal Zoom** — a morphing Julia set that breathes and zooms, pulsing with the bass
- **Ferrofluid** — a magnetic blob sprouting spikes to the treble, pulsing to the bass
- **Cymatics** — Chladni nodal‑line patterns whose mode numbers ride the frequency bands
- **Oscilloscope** — the raw waveform drawn as a glowing scope / Lissajous figure
- **Ribbons** — silky trailing ribbons flowing on a curl field, brightening with the music
- **Vortex** — a whirlpool of points spiralling inward and flung outward on beats
- **City Skyline** — a neon city fly‑through where the buildings are the spectrum bars
- **DNA Helix** — a rotating double helix whose ladder rungs light up per frequency band

An adaptive **auto‑gain** stage normalizes the bass/mid/treble/level metrics against
the track's own recent dynamics, so every preset uses the full range and stays
responsive on quiet or loud sources alike.

The ⚙️ panel adjusts everything live and remembers it (localStorage):

- **Audio** — sensitivity, smoothing, FFT resolution, per‑band (bass/mid/treble)
  emphasis, beat sensitivity.
- **Visual** — preset, **auto‑shuffle** (jump to a random preset every N seconds,
  default 5 min), colour palette, hue/saturation, **RGB rotate** (auto‑cycle
  colours through the spectrum) + speed, background, bloom, a **beat camera**
  (global dolly‑punch + shake that reacts across every preset) with zoom/shake
  amounts, and a render‑scale slider for performance.
- **Per‑preset** parameters, generated automatically from each preset.

Plus a fullscreen button, wake‑lock (keeps the screen on while playing), and a
live FPS / BPM readout.

## Desktop screensaver (Windows)

There's also a **downloadable Windows desktop app** that behaves like a real
**screensaver**: it sits in the system tray, and after a configurable idle timeout
it takes over the screen with the fullscreen visualizer reacting to **whatever is
playing on your PC** (Spotify, YouTube, a game…) with **no setup** — it captures
system audio via WASAPI **loopback**, so you never have to share a tab or enable
"Stereo Mix". Any input dismisses it; the tray menu sets the timeout, opens it
interactively, and can start it with Windows.

Grab it from the repo's **[Releases](https://github.com/Maridizzle/music-viz/releases)**
(installer + portable `.exe`), or from **Actions → "Build Windows desktop app"** → the
latest run's **`MusicVisualizer-Windows`** artifact. Full details and build-it-yourself
steps are in [`desktop/README.md`](desktop/README.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/music-viz/
```

To test the microphone on a phone over your LAN you need HTTPS; open the deployed
Pages URL, or run the dev server behind a tunnel (e.g. cloudflared / ngrok).

```bash
npm run build      # type-check (tsc) + production build to dist/
npm run preview    # serve the production build locally
```

## Deploy (GitHub Pages)

Pushing to `claude/music-visualizer-adjustable-mnlnaj` runs
`.github/workflows/deploy.yml`, which builds with Vite and publishes `dist/` to
GitHub Pages.

**One-time setup:** in the repository's **Settings → Pages**, set
**Source = "GitHub Actions"**. The site publishes to
`https://maridizzle.github.io/music-viz/` (the Vite `base` is set to `/music-viz/`).

## Tech

- **Three.js** (WebGL) — renderer, presets, `EffectComposer` bloom.
- **Web Audio API** — one `AnalyserNode` fed by a swappable source; derives
  bass/mid/treble/level and an adaptive beat/BPM estimate each frame.
- **Tweakpane** — the control panel, generated from each preset's schema.
- **Vite + TypeScript** — build and dev server.

## Project layout

```
src/
  audio/     AudioEngine, analysis, BeatDetector      # Web Audio graph + metrics
  visual/    PresetManager, Composer, palette, presets/  # Three.js rendering
  ui/        overlay, SourcePicker, ControlPanel       # DOM + Tweakpane
  state/     Settings, store                           # defaults + localStorage
  util/      env, viewport, loop                       # platform helpers
  App.ts     wires it all together
```
