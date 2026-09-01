// Electron shell that turns the web visualizer into a Windows desktop screensaver
// which reacts to whatever is playing on the PC (Spotify, YouTube, games, …) with
// no setup, by capturing system audio through WASAPI loopback.
const { app, BrowserWindow, protocol, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const WEB_DIR = path.join(__dirname, 'web');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// A privileged, secure, standard scheme so the page runs in a secure context
// (getDisplayMedia / loopback capture require it) and relative asset paths resolve.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    title: 'Music Visualizer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const ses = win.webContents.session;

  // Grant the renderer's getDisplayMedia({ audio }) request the whole system's
  // audio via loopback, with a screen as the (unused) video source. No picker.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (!sources.length) return callback({});
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  ses.setPermissionRequestHandler((_wc, _perm, done) => done(true));
  ses.setPermissionCheckHandler(() => true);

  // Esc / Ctrl+Q quits; F11 toggles fullscreen.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' || (input.control && input.key.toLowerCase() === 'q')) app.quit();
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  win.loadURL('app://bundle/index.html');

  // Kick off system-audio capture once the page is ready. executeJavaScript with
  // userGesture=true satisfies the transient-activation requirement, so capture
  // starts automatically with no click.
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      win.webContents
        .executeJavaScript('window.__mvStartLoopback && window.__mvStartLoopback()', true)
        .catch(() => {});
    }, 600);
  });

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    let pathname = decodeURIComponent(new URL(request.url).pathname);
    if (!pathname || pathname === '/') pathname = '/index.html';
    const filePath = path.join(WEB_DIR, path.normalize(pathname));
    // Never serve outside the bundle directory.
    if (!filePath.startsWith(WEB_DIR)) return new Response('Forbidden', { status: 403 });
    try {
      const data = fs.readFileSync(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
