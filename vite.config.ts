import { defineConfig } from 'vite';

// Four build targets share one codebase:
//  - web (default): served from https://<user>.github.io/music-viz/ → dist/
//  - desktop (ELECTRON=1): relative asset paths → desktop/web/, served by the Electron
//    shell over app:// (see desktop/main.js)
//  - android (ANDROID=1): relative asset paths → dist-android/, copied into the
//    Capacitor project by `npx cap sync android` (see android/README.md)
//  - lively (VITE_MV_LIVELY=1): relative asset paths → dist-lively/, a Lively
//    Wallpaper package (index.html + LivelyInfo.json) that runs as the Windows desktop
//    background and reacts to system audio pushed in by Lively (see lively/README.md).
//    The VITE_ prefix makes the flag visible to the app as import.meta.env.VITE_MV_LIVELY.
const electron = process.env.ELECTRON === '1';
const android = process.env.ANDROID === '1';
const lively = process.env.VITE_MV_LIVELY === '1';

export default defineConfig({
  base: electron || android || lively ? './' : '/music-viz/',
  build: {
    outDir: electron ? 'desktop/web' : android ? 'dist-android' : lively ? 'dist-lively' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: true,
  },
});
