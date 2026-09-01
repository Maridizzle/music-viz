import './style.css';
import { App } from './App';
import { SpotifyAuth } from './spotify/auth';
import { onAppUrl, platformKind } from './spotify/platform';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

const app = new App(root);
const platform = platformKind();

// Spotify's OAuth round-trip. On the web it lands back on this page with
// ?code=…&state=…; the native shells (Android app, Windows desktop) deliver the
// musicviz://spotify?… URL as an event instead.
const callbackUrl = SpotifyAuth.isCallbackUrl(location.href) ? location.href : null;
if (callbackUrl) {
  // Tidy the address bar: drop the OAuth params, keep anything else (?debug, …).
  const u = new URL(location.href);
  for (const k of ['code', 'state', 'error']) u.searchParams.delete(k);
  const rest = u.searchParams.toString();
  history.replaceState({}, '', `${u.pathname}${rest ? `?${rest}` : ''}${u.hash}`);
}
void onAppUrl((url) => void app.completeSpotifyLogin(url));

if (platform === 'desktop') {
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

  // iPhone/iPad Safari: once, suggest installing to the Home Screen — that's the
  // "native" experience there (icon, fullscreen, keeps the screen on).
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isIOS && !standalone && platform === 'web') {
    try {
      if (!localStorage.getItem('music-viz:ios-hint')) {
        localStorage.setItem('music-viz:ios-hint', '1');
        setTimeout(() => app.toast('Tip: Share → "Add to Home Screen" turns this into a fullscreen app'), 2500);
      }
    } catch {
      /* storage unavailable */
    }
  }
}

if (callbackUrl) void app.completeSpotifyLogin(callbackUrl);

// Optional debug handle for smoke tests / manual poking: append ?debug to the URL.
if (location.search.includes('debug') || location.search.includes('smoke')) {
  (window as unknown as { __mv?: App }).__mv = app;
}
