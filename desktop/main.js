// Electron shell that turns the web visualizer into a Windows desktop screensaver.
// It lives in the system tray, watches the OS idle timer, and after N minutes of no
// input it launches the fullscreen visualizer (reacting to system audio via WASAPI
// loopback). Any input dismisses it back to the tray. A tray menu also opens it
// interactively and configures the idle timeout / start-with-Windows.
const {
  app, BrowserWindow, protocol, desktopCapturer, powerSaveBlocker, powerMonitor,
  Tray, Menu, nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const WEB_DIR = path.join(__dirname, 'web');
const ICON = path.join(__dirname, 'build', 'icon.png');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

const TIMEOUT_CHOICES = [1, 3, 5, 10, 15, 30];

// A privileged, secure, standard scheme so the page runs in a secure context
// (getDisplayMedia / loopback capture require it) and relative asset paths resolve.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ---- persisted config (idle timeout) ----
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadConfig() {
  try {
    return { timeoutMinutes: 5, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { timeoutMinutes: 5 };
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config));
  } catch { /* ignore */ }
}
let config = { timeoutMinutes: 5 };

// ---- window management ----
let win = null; // the current visualizer window (null while idle-watching)
let winMode = null; // 'saver' | 'interactive'
let tray = null;
let blockerId = -1;

function startBlocker() {
  if (blockerId === -1) blockerId = powerSaveBlocker.start('prevent-display-sleep');
}
function stopBlocker() {
  if (blockerId !== -1 && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = -1;
}

function createVisualizerWindow(mode) {
  const saver = mode === 'saver';
  win = new BrowserWindow({
    fullscreen: saver,
    frame: !saver,
    width: saver ? undefined : 1280,
    height: saver ? undefined : 800,
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    title: 'Music Visualizer',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  winMode = mode;

  const ses = win.webContents.session;
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => (sources.length ? callback({ video: sources[0], audio: 'loopback' }) : callback({})))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  ses.setPermissionRequestHandler((_wc, _perm, done) => done(true));
  ses.setPermissionCheckHandler(() => true);

  // In interactive mode Esc closes the window (back to tray) and F11 toggles
  // fullscreen. In saver mode the idle watcher handles dismissal on any input.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || winMode !== 'interactive') return;
    if (input.key === 'Escape') closeVisualizer();
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  win.loadURL('app://bundle/index.html' + (saver ? '?screensaver' : ''));

  // Auto-start system-audio capture with a synthesized user gesture once loaded.
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (win) win.webContents.executeJavaScript('window.__mvStartLoopback && window.__mvStartLoopback()', true).catch(() => {});
    }, 600);
  });

  win.on('closed', () => {
    win = null;
    winMode = null;
    stopBlocker();
  });

  startBlocker();
}

function activateSaver() {
  if (win) return;
  createVisualizerWindow('saver');
}
function openInteractive() {
  if (win && winMode === 'interactive') {
    win.focus();
    return;
  }
  if (win) win.close();
  createVisualizerWindow('interactive');
}
function closeVisualizer() {
  if (win) win.close();
}

// ---- idle watcher ----
function startWatcher() {
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime(); // seconds since last input
    if (winMode === 'saver') {
      if (idle < 2) closeVisualizer(); // the user came back
    } else if (!win && idle >= config.timeoutMinutes * 60) {
      activateSaver();
    }
    // interactive windows are never idle-dismissed
  }, 500);
}

// ---- tray ----
function buildTray() {
  let img = nativeImage.createFromPath(ICON);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Music Visualizer');
  tray.on('double-click', openInteractive);
  refreshTrayMenu();
}
function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Start screensaver now', click: activateSaver },
    { label: 'Open visualizer', click: openInteractive },
    { type: 'separator' },
    {
      label: 'Start after…',
      submenu: TIMEOUT_CHOICES.map((m) => ({
        label: `${m} min`,
        type: 'radio',
        checked: config.timeoutMinutes === m,
        click: () => {
          config.timeoutMinutes = m;
          saveConfig();
          refreshTrayMenu();
        },
      })),
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---- app lifecycle ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openInteractive());

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      let pathname = decodeURIComponent(new URL(request.url).pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      const filePath = path.join(WEB_DIR, path.normalize(pathname));
      if (!filePath.startsWith(WEB_DIR)) return new Response('Forbidden', { status: 403 });
      try {
        const data = fs.readFileSync(filePath);
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    const firstRun = !fs.existsSync(configPath());
    config = loadConfig();

    try {
      buildTray();
    } catch { /* no system tray available (rare) — the watcher still runs */ }
    startWatcher();

    if (firstRun) {
      // First launch: show it once so the user sees it works, then it lives in the tray.
      saveConfig();
      openInteractive();
      if (tray && tray.displayBalloon) {
        tray.displayBalloon({
          title: 'Music Visualizer',
          content: `Running in the tray. The screensaver starts after ${config.timeoutMinutes} min of inactivity — right-click the tray icon for options.`,
        });
      }
    }
  });

  // Closing the visualizer window returns to the tray watcher; it does NOT quit the
  // app (quit is via the tray menu).
  app.on('window-all-closed', () => {});
}
