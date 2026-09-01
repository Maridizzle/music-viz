import { defineConfig } from 'vite';

// Three build targets share one codebase:
//  - web (default): served from https://<user>.github.io/music-viz/ → dist/
//  - desktop (ELECTRON=1): relative asset paths → desktop/web/, served by the Electron
//    shell over app:// (see desktop/main.js)
//  - android (ANDROID=1): relative asset paths → dist-android/, copied into the
//    Capacitor project by `npx cap sync android` (see android/README.md)
const electron = process.env.ELECTRON === '1';
const android = process.env.ANDROID === '1';

export default defineConfig({
  base: electron || android ? './' : '/music-viz/',
  build: {
    outDir: electron ? 'desktop/web' : android ? 'dist-android' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: true,
  },
});
