import { defineConfig } from 'vite';

// Project site is served from https://<user>.github.io/music-viz/
export default defineConfig({
  base: '/music-viz/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    host: true,
  },
});
