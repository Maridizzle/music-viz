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

Twenty-six switchable 3D presets:

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

An adaptive **auto‑gain** stage normalizes the bass/mid/treble/level metrics against
the track's own recent dynamics, so every preset uses the full range and stays
responsive on quiet or loud sources alike.

The ⚙️ panel adjusts everything live and remembers it (localStorage):

- **Audio** — sensitivity, smoothing, FFT resolution, per‑band (bass/mid/treble)
  emphasis, beat sensitivity.
- **Visual** — preset, colour palette, hue/saturation, **RGB rotate** (auto‑cycle
  colours through the spectrum) + speed, background, bloom, and a render‑scale
  slider for performance.
- **Per‑preset** parameters, generated automatically from each preset.

Plus a fullscreen button, wake‑lock (keeps the screen on while playing), and a
live FPS / BPM readout.

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
