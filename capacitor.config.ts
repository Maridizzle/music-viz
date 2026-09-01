import type { CapacitorConfig } from '@capacitor/cli';

// Native Android shell for the visualizer. The web app is built with relative
// asset paths into dist-android (npm run build:android) and served from the
// WebView over https://localhost. See android/ and android/README.md.
const config: CapacitorConfig = {
  appId: 'com.maridizzle.musicviz',
  appName: 'Music Visualizer',
  webDir: 'dist-android',
  android: {
    backgroundColor: '#05060a',
  },
};

export default config;
