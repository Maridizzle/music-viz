# Music Visualizer

An adjustable **WebGL 3D music visualizer** that reacts to live audio, built for
both **phone and PC**. It runs entirely in the browser (Three.js + Web Audio API),
has a touch-friendly control panel, and auto-deploys to GitHub Pages. It also ships
as a **Windows screensaver app** and an **Android app**, and installs on **iPhone**
from Safari.

**Live site:** https://maridizzle.github.io/music-viz/

## Audio sources

Browsers (and phones) can't read the audio of DRM services like Spotify or Apple
Music directly, so the visualizer reacts to one of these sources you pick in-app:

| Source | Works on | Notes |
| --- | --- | --- |
| 🟢 **Spotify** | phone + PC | Logs into your Spotify, shows what's playing and recolours the visuals from the album art. Reacts through the **mic** whenever it can hear the music; on **headphones** it **beat-locks** to the song's tempo instead. See [Spotify mode](#spotify-mode). |
| 🎤 **Microphone** | phone + PC | Reacts to whatever is playing out loud in the room. |
| 🖥️ **Tab / system audio** | desktop Chrome/Edge; Android app | On the web: capture a Spotify‑web or YouTube tab (tick **"Share tab audio"**). In the Android app: any app that allows capture. |
| 📁 **Audio file** | phone + PC | Play a track from your device. |
| 🔗 **Stream URL** | phone + PC | An internet‑radio / direct audio link. The stream server must send CORS headers or the analyser reads silence — the app warns you. Must be `https://`. |

> Microphone and tab/system capture require a secure (HTTPS) origin — that's why
> the deployed Pages URL is the easiest way to use it on a phone.

## Phones

**iPhone / iPad** — open the [live site](https://maridizzle.github.io/music-viz/) in
Safari, tap **Share → Add to Home Screen**. That gives you an icon, fullscreen with no
browser chrome, the mic, and keep‑awake — everything a native iOS app could give
here. (iOS doesn't let any third‑party app capture other apps' audio, so Spotify
reacts via the mic on speakers, or beat‑lock on headphones.)

**Android** — download **`MusicVisualizer-<version>.apk`** from the
**[Releases](https://github.com/Maridizzle/music-viz/releases)** page and open it
(allow installs from that source once; Android 10+). It's the same app with two
extras: a native **System audio** source that captures other apps' audio directly
(YouTube, local players, games — anything that *allows* capture; **Spotify and most
DRM streamers opt out** and give silence, so use Spotify mode for those), and the
screen never sleeps. Details in [`android/README.md`](android/README.md).

## Spotify mode

The honest situation: **no app on a phone can hear Spotify's audio** — Spotify
blocks Android's capture API and iOS has none. Spotify mode is the best a phone can
do, and it's pretty good:

- **Knows what's playing.** Logs into your Spotify (PKCE, nothing stored but your
  own tokens on your device), shows the track + album art in a small card, and
  pulls the **album art's colours into the palette** (toggle in ⚙️ → Spotify).
- **Listens when it can.** Whenever the mic hears the music (phone speaker, a
  Bluetooth speaker, the room) you get the full spectrum‑reactive visuals.
- **Beat‑locks when it can't.** On headphones the mic hears nothing, so instead of
  going dead the visuals pulse on the song's **beat grid**, synced to Spotify's
  playback position. The tempo comes from Deezer's public catalogue; the app also
  **learns** each song's exact beat timing the first time it hears it on speakers and
  remembers it; and you can always **tap the beat** on the card to sync (or set the
  tempo when nothing knows it). Beat‑lock follows the grid, not the dynamics — a
  quiet verse and a loud chorus look alike — and may need a tap to land on‑beat.
- **Works everywhere**: website, Home‑Screen app, Android app, and the Windows
  screensaver (where it adds the album colours + now‑playing card on top of the
  loopback audio).

### One‑time setup (a Spotify app of your own)

Spotify requires each app to be registered, so this needs a Client ID:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   → **Create app** (name/description: anything; API: **Web API**).
2. Under **Redirect URIs** add, exactly:
   - `https://maridizzle.github.io/music-viz/` (the website / Home‑Screen app)
   - `musicviz://spotify` (the Android and Windows apps)
   - `http://127.0.0.1:5173/music-viz/` (only if you run the dev server; open it via
     `127.0.0.1`, not `localhost`)
3. Copy the **Client ID** and paste it into the visualizer: **⚙️ → Spotify → Client
   ID** (any platform; it's saved on the device). Or bake it in for everyone by
   setting `DEFAULT_SPOTIFY_CLIENT_ID` in
   [`src/spotify/config.ts`](src/spotify/config.ts) — it's public by design (PKCE
   needs no secret).
4. Tap **🟢 Spotify** → log in → play something.

> Spotify apps start in **Development Mode**: up to 25 users, and each Spotify
> account that will log in must be added under the app's **User Management** (by
> the email on their Spotify account) — friends included. Spotify may also require
> a Premium account to use the Developer Dashboard.

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
- **Spotify** — connect/disconnect, album colours, beat‑lock on/off + intensity,
  Client ID.
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
interactively, and can start it with Windows. Log into Spotify once (🎵 → Spotify
in the interactive window; the login opens in your browser and comes back to the
app) and the screensaver also shows the track and takes its colours from the album.

Grab it from the repo's **[Releases](https://github.com/Maridizzle/music-viz/releases)**
(installer + portable `.exe`), or from **Actions → "Build Windows desktop app"** → the
latest run's **`MusicVisualizer-Windows`** artifact. Full details and build-it-yourself
steps are in [`desktop/README.md`](desktop/README.md).

## Develop

```bash
npm install
npm run dev        # http://127.0.0.1:5173/music-viz/
```

To test the microphone on a phone over your LAN you need HTTPS; open the deployed
Pages URL, or run the dev server behind a tunnel (e.g. cloudflared / ngrok).

```bash
npm run build          # type-check (tsc) + production web build to dist/
npm run build:desktop  # relative-path build for the Electron shell → desktop/web/
npm run build:android  # relative-path build for the Android app → dist-android/
npm run preview        # serve the production build locally
npm run icons          # regenerate PWA + Android icons from desktop/build/icon.png
node scripts/smoke-spotify.mjs   # headless end-to-end check of Spotify mode (mocked services)
```

## Deploy (GitHub Pages)

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds with Vite and
publishes `dist/` to GitHub Pages. `desktop.yml` and `android.yml` build the Windows
and Android apps (run them manually with a `release_tag` to publish a Release).

**One-time setup:** in the repository's **Settings → Pages**, set
**Source = "GitHub Actions"**. The site publishes to
`https://maridizzle.github.io/music-viz/` (the Vite `base` is set to `/music-viz/`).

## Tech

- **Three.js** (WebGL) — renderer, presets, `EffectComposer` bloom.
- **Web Audio API** — one `AnalyserNode` fed by a swappable source; derives
  bass/mid/treble/level and an adaptive beat/BPM estimate each frame.
- **Spotify Web API** (PKCE) + **Deezer** catalogue tempo + an in‑app beat learner
  for Spotify mode; a synthetic beat‑locked signal stands in when the mic is silent.
- **Tweakpane** — the control panel, generated from each preset's schema.
- **Vite + TypeScript** — build and dev server; **Electron** (Windows) and
  **Capacitor** (Android) shells around the same bundle.

## Project layout

```
src/
  audio/     AudioEngine, analysis, BeatDetector, androidCapture   # Web Audio graph + metrics
  spotify/   auth (PKCE), client, nowPlaying, tempo, beatLock, learn, albumPalette, SpotifyMode
  visual/    PresetManager, Composer, palette, presets/  # Three.js rendering
  ui/        overlay, SourcePicker, NowPlayingCard, ControlPanel   # DOM + Tweakpane
  state/     Settings, store                           # defaults + localStorage
  util/      env, viewport, loop                       # platform helpers
  App.ts     wires it all together
desktop/     Electron shell (Windows screensaver)
android/     Capacitor project + native audio-capture plugin
public/      manifest + icons (installable web app)
scripts/     icon renderer, headless smoke test
```
