# Music Visualizer — Windows desktop screensaver

A thin [Electron](https://www.electronjs.org/) shell that runs the visualizer
fullscreen and **reacts to whatever is playing on your PC** — Spotify, YouTube,
a game, anything — with **no setup**. It captures the system's audio through
Windows **WASAPI loopback**, so you don't have to share a tab or enable "Stereo Mix".

## Get the app (no build needed)

The installers are built by CI on a real Windows runner:

1. Open the repo's **Actions → "Build Windows desktop app"**, click the latest
   successful run, and download the **`MusicVisualizer-Windows`** artifact (a zip).
2. Unzip it. You get two options:
   - **`Music Visualizer Setup <version>.exe`** — a normal installer (adds a Start
     Menu / desktop shortcut).
   - **`MusicVisualizer-<version>-portable.exe`** — a single file that runs with no
     install.
3. Run it. Because the build is unsigned, Windows SmartScreen may warn once —
   click **More info → Run anyway**.

> Tagging a commit `v*` (e.g. `v0.1.0`) also attaches these files to a GitHub Release.

## Use it — it's a screensaver

Launch it and it lives in the **system tray** (bottom-right, by the clock), watching
Windows' idle timer. After your chosen number of minutes with no mouse/keyboard, it
takes over the screen with the fullscreen visualizer reacting to whatever's playing.
**Any input dismisses it** back to the tray. (First launch also opens it once so you
can see it works.)

**Right-click the tray icon** for:

- **Start screensaver now** — trigger it immediately.
- **Open visualizer** — an interactive window (not dismissed on input) where **⚙️**
  switches the 39 presets / palette / beat camera / **auto-shuffle**, **🎵** changes
  the audio source, **F11** toggles fullscreen, and **Esc** closes it.
- **Start after…** — the idle timeout (1 / 3 / 5 / 10 / 15 / 30 min).
- **Start with Windows** — launch automatically at login, so it's always watching.
- **Quit** — stop the app entirely.

Just play music (Spotify, YouTube, a game…) and it reacts automatically — no setup.

## Build it yourself

From the repo root (needs Node 22+):

```bash
npm ci
npm run build:desktop        # builds the web app into desktop/web with relative paths

cd desktop
npm install
npm run dist                 # electron-builder → desktop/release/*.exe
```

`npm start` (inside `desktop/`, after `build:desktop`) runs it unpackaged for quick
iteration.

## How it works

- `main.js` creates a frameless fullscreen `BrowserWindow` and serves the built web
  app over a privileged, secure `app://` scheme (a secure context is required for
  audio capture).
- `session.setDisplayMediaRequestHandler(...)` answers the app's
  `getDisplayMedia({ audio })` request with **`audio: 'loopback'`**, which is the
  whole system's audio on Windows — no picker, no tab sharing.
- After load, the main process calls `window.__mvStartLoopback()` with a synthesized
  user gesture so capture starts automatically. If it ever fails, the normal source
  picker appears as a fallback.
- The renderer is the exact same app as the website; only the audio source and the
  fullscreen/ambient chrome differ (see `src/main.ts`, guarded by `window.mvDesktop`).

macOS/Linux aren't packaged here: their system-audio loopback needs an extra virtual
device (e.g. BlackHole), so this shell targets Windows where loopback is built in.
