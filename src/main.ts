import './style.css';
import { App } from './App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

const app = new App(root);

const desktop = !!(window as unknown as { mvDesktop?: boolean }).mvDesktop;
if (desktop) {
  // Electron shell. In screensaver mode (?screensaver) it runs as a fullscreen saver
  // dismissed on any input; otherwise it's an interactive window. Either way the main
  // process calls this hook with a synthesized user gesture to auto-start system-audio
  // capture (WASAPI loopback) without a click. See desktop/main.js.
  const screensaver = location.search.includes('screensaver');
  (window as unknown as { __mvStartLoopback?: () => void }).__mvStartLoopback = () => {
    void app.startDesktopAudio();
  };
  app.startDesktopIdle(screensaver);

  // Hide the cursor when idle — only as a screensaver (interactive mode keeps it).
  if (screensaver) {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const hide = (): void => {
      document.body.style.cursor = 'none';
    };
    const wake = (): void => {
      document.body.style.cursor = '';
      if (idle) clearTimeout(idle);
      idle = setTimeout(hide, 3000);
    };
    window.addEventListener('mousemove', wake);
    wake();
  }
} else {
  app.start();
}

// Optional debug handle for smoke tests / manual poking: append ?debug to the URL.
if (location.search.includes('debug') || location.search.includes('smoke')) {
  (window as unknown as { __mv?: App }).__mv = app;
}
