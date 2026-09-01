# Music Visualizer — Android app

A [Capacitor](https://capacitorjs.com/) shell around the exact same web app, plus one
native plugin: **system-audio capture** (Android 10+ `AudioPlaybackCapture`), so the
visualizer can react to other apps' audio the way the Windows desktop app does.

## Get the APK (no build needed)

Download **`MusicVisualizer-<version>.apk`** from the repo's
**[Releases](https://github.com/Maridizzle/music-viz/releases)** (or the
**Actions → "Build Android app"** artifact), open it on the phone and allow
installing from that source once. Updates install over the old version.

## What it can and can't hear

| Source (🎵 button) | What it reacts to |
| --- | --- |
| **Spotify** | Logs into your Spotify, shows the track + album art, recolours the visuals from the cover. Reacts through the **mic** whenever it can hear the music; on **headphones** it **beat-locks** to the song's tempo instead (see the main README). |
| **System audio** | Any app that *allows* capture: YouTube, local players, games, most podcast apps… Android asks for screen-capture consent (pick **Entire screen**; only the audio is used). **Spotify, YouTube Music, Apple Music and most DRM streamers opt out** and contribute silence — that's their policy, not a bug. |
| **Microphone / file / URL** | As on the web. |

## Build it yourself

Needs Node 22+, JDK 21 and the Android SDK (platform 36).

```bash
npm ci
npm run build:android          # web app → dist-android (relative paths)
npx cap sync android           # copy it into android/ + wire plugins
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`npx cap open android` opens the project in Android Studio.

## Layout

- `app/src/main/java/com/maridizzle/musicviz/`
  - `MainActivity.java` — registers the plugin, keeps the screen on, immersive mode.
  - `AudioCapturePlugin.java` — JS ⇄ native bridge (`start`/`stop`, `pcm` + `stopped` events).
  - `CaptureService.java` — foreground service (type `mediaProjection`) owning the
    MediaProjection + AudioRecord; streams 16-bit mono PCM to the plugin.
- `src/audio/androidCapture.ts` (web side) feeds that PCM through an AudioWorklet into
  a MediaStream the normal engine consumes.
- Release builds are signed with `../android-signing/musicviz.jks` (see its README).
- The `musicviz://spotify` intent filter receives the Spotify login callback.
