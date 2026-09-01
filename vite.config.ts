import { defineConfig } from 'vite';

// The web build is served from https://<user>.github.io/music-viz/.
// The desktop (Electron) build — enabled with ELECTRON=1 — uses relative asset
// paths and is emitted into desktop/web/, where the Electron shell serves it over
// the app:// protocol. See desktop/main.js.
const electron = process.env.ELECTRON === '1';

export default defineConfig({
  base: electron ? './' : '/music-viz/',
  build: {
    outDir: electron ? 'desktop/web' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: true,
  },
});
