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
   - from **Actions → "Build Lively wallpaper"** → the latest run → the
     **MusicVisualizer-Lively** artifact (GitHub downloads it as a `.zip`), or
   - build it yourself (below).
3. Drag the `.zip` onto the Lively window. It appears in the library; click it to
   set it as the desktop. Use the zip rather than a loose folder: Lively checks for
   `LivelyInfo.json` at the zip root, and an old Lively bug report notes the audio
   callback only fired for wallpapers added as a zip.
4. Play music (Spotify, YouTube, a game, anything with sound). The desktop reacts.

Lively itself computes the audio spectrum from the system output and hands the page
128 values per frame, so there is no "share tab audio" dialog, no microphone, and
no Stereo Mix.

## Build it yourself

```bash
npm ci
npm run build:lively      # → dist-lively/ (index.html, assets, LivelyInfo.json, thumbnail.png)
```

Then open `dist-lively`, select **everything inside it** (not the folder itself),
right-click → **Compress to ZIP file**, and drag that zip into Lively. The manifest
must sit at the root of the zip, not inside a subfolder.

## How it works

- `lively/LivelyInfo.json` describes the wallpaper to Lively. `"Type": 2` is Lively's
  `webaudio` wallpaper type: for that type Lively itself starts its system-audio
  analyser and streams the spectrum to the page. Do **not** also put `--audio` in
  `Arguments`: Lively rewrites it to a second `--wallpaper-audio` option, the player
  refuses duplicate options, and Lively shows "Error initializing. Unknown options
  are passed." (the wiki's `--audio` advice predates the `webaudio` type).
  `--system-nowplaying` is safe there: Lively does not add that one itself.
- `src/audio/livelyBridge.ts` defines the global `livelyAudioListener(audioArray)`
  that Lively calls with the 128 bands.
- `AudioEngine.useExternalSpectrum()` rebuilds the byte spectrum and a stand-in
  waveform from those bands every frame, so every preset works unchanged.
- `vite.config.ts` builds with relative paths into `dist-lively/` when
  `VITE_MV_LIVELY=1`, and `scripts/lively-package.mjs` drops the manifest and
  thumbnail beside the built page.

## Notes

- **Cover colours:** `"Arguments": "--system-nowplaying"` makes Lively (2.0.6.0 or
  newer) also call `livelyCurrentTrack(data)` with what Windows' media controls
  report for the active player, cover art included, so the visuals recolour from
  the album of whatever is playing, with no Spotify login. Works for any player
  that publishes to Windows' media controls (the same info as the volume popup).
  The gear panel's **Album colours** toggle (under Spotify) turns it off. No
  now-playing card is shown on the desktop.
- Lively pauses wallpapers while a fullscreen app runs (its own performance
  setting); the visualizer picks up again when the desktop is visible.
- Preset, palette and other settings are the same saved settings the interactive
  page uses. Lively can forward mouse input to web wallpapers; if it does on your
  setup, the ⚙️ panel works on the desktop too.
