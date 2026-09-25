# Music Visualizer as your desktop (Lively Wallpaper)

[Lively Wallpaper](https://github.com/rocksdanister/lively) is a free, open source
Windows app that runs videos, web pages and other content as the desktop background.
It can also push the PC's **system audio** into a web wallpaper, which is exactly
what this visualizer needs. So the whole visualizer, all presets included, can be
your live desktop with no capture setup at all.

## Install

1. Install Lively Wallpaper (Microsoft Store or the installer from its GitHub page).
2. Get the wallpaper package **`MusicVisualizer-Lively.zip`**:
   - from the repo's **Releases** page, or
   - from **Actions → "Build Lively wallpaper"** → the latest run's artifact, or
   - build it yourself (below).
3. Drag the `.zip` (or the unzipped folder) onto the Lively window. It appears in
   the library; click it to set it as the desktop.
4. Play music (Spotify, YouTube, a game, anything with sound). The desktop reacts.

Lively itself computes the audio spectrum from the system output and hands the page
128 values per frame, so there is no "share tab audio" dialog, no microphone, and
no Stereo Mix.

## Build it yourself

```bash
npm ci
npm run build:lively      # → dist-lively/ (index.html, assets, LivelyInfo.json, thumbnail.png)
```

Then drag the `dist-lively` folder into Lively, or right-click it in Explorer →
**Compress to ZIP file** and drag the zip.

## How it works

- `lively/LivelyInfo.json` describes the wallpaper to Lively. `"Type": 2` is a web
  wallpaper and `"Arguments": "--audio"` asks Lively to stream the audio spectrum.
- `src/audio/livelyBridge.ts` defines the global `livelyAudioListener(audioArray)`
  that Lively calls with the 128 bands.
- `AudioEngine.useExternalSpectrum()` rebuilds the byte spectrum and a stand-in
  waveform from those bands every frame, so every preset works unchanged.
- `vite.config.ts` builds with relative paths into `dist-lively/` when
  `VITE_MV_LIVELY=1`, and `scripts/lively-package.mjs` drops the manifest and
  thumbnail beside the built page.

## Notes

- The Spotify now-playing card and album colours are not part of this mode yet.
  Lively offers a `livelyCurrentTrack` callback that could provide them later.
- Lively pauses wallpapers while a fullscreen app runs (its own performance
  setting); the visualizer picks up again when the desktop is visible.
- Preset, palette and other settings are the same saved settings the interactive
  page uses. Lively can forward mouse input to web wallpapers; if it does on your
  setup, the ⚙️ panel works on the desktop too.
