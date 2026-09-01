#!/usr/bin/env node
// Headless end-to-end smoke test for Spotify mode. Every external service is mocked
// (Spotify Web API + accounts, Deezer, the album-art CDN) and Chromium's fake
// microphone stands in for the phone's mic, so this runs anywhere with no keys.
//
//   npm run build && npm i --no-save playwright-core && node scripts/smoke-spotify.mjs
//
// Scenarios: [A] headphones → beat-lock, [B] speakers → listening, [C] web PKCE
// OAuth round-trip, [D] PWA assets.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/music-viz/`;
const EXE = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => fs.existsSync(p));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-smoke-'));
const SILENCE = path.join(TMP, 'silence.wav');

const FLAGS = [
  '--no-sandbox',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

let failures = 0;
function check(cond, label, detail = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, every = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(every);
  }
}

// ---- fixtures ----

function writeSilenceWav(file) {
  const sr = 48000;
  const data = Buffer.alloc(sr * 2 * 2); // 2 s, 16-bit mono
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function waitPort(port) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve();
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - t0 > 20000) reject(new Error('vite preview did not start'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore',
  });
  await waitPort(PORT);
  return child;
}

async function makeArtPng(browser) {
  // Left half red, right half blue → the palette must come back with both hues.
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#e01010';
    x.fillRect(0, 0, 32, 64);
    x.fillStyle = '#1030e0';
    x.fillRect(32, 0, 32, 64);
    return c.toDataURL('image/png');
  });
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function hexHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return Math.round(h);
}

// ---- mocks ----

const TRACK = {
  id: 'trk123',
  name: 'Test Song',
  type: 'track',
  duration_ms: 240000,
  artists: [{ name: 'Test Artist' }],
  album: {
    name: 'Test Album',
    images: [
      { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
      { url: 'https://i.scdn.co/image/mid', width: 300, height: 300 },
      { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
    ],
  },
};
const playStart = Date.now();
const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
});

async function installMocks(context, artPng) {
  await context.route(/^https:\/\/api\.spotify\.com\//, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    const body = JSON.stringify({
      item: TRACK,
      is_playing: true,
      progress_ms: (Date.now() - playStart) % TRACK.duration_ms,
      currently_playing_type: 'track',
    });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors(), body });
  });
  await context.route(/^https:\/\/accounts\.spotify\.com\//, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    if (route.request().url().includes('/api/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors(),
        body: JSON.stringify({
          access_token: 'acc',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'ref',
          scope: 'user-read-currently-playing',
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>spotify-login-stub</title>' });
  });
  await context.route(/^https:\/\/api\.deezer\.com\//, (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get('callback') ?? 'cb';
    const data = u.pathname.startsWith('/search')
      ? { data: [{ id: 999, title: 'Test Song', artist: { name: 'Test Artist' } }] }
      : { id: 999, bpm: 120 };
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: `${cb}(${JSON.stringify(data)})` });
  });
  await context.route(/^https:\/\/i\.scdn\.co\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', headers: cors(), body: artPng }),
  );
}

function seedAuth() {
  localStorage.setItem(
    'music-viz:spotify-auth',
    JSON.stringify({ accessToken: 'acc', refreshToken: 'ref', expiresAt: Date.now() + 3600e3, clientId: 'test-client' }),
  );
}
function seedClientId() {
  localStorage.setItem('music-viz:settings', JSON.stringify({ version: 2, spotify: { clientId: 'test-client' } }));
}
function collectErrors(page, bag) {
  page.on('pageerror', (e) => bag.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') bag.push(`console: ${m.text()}`);
  });
}
const debugSpotify = (page) => page.evaluate(() => window.__mv?.debugSpotify() ?? null);

// ---- scenarios ----

async function scenarioBeatLock(artPng) {
  console.log('\n[A] headphones → beat-lock (silent mic)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: [...FLAGS, `--use-file-for-fake-audio-capture=${SILENCE}`],
  });
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await installMocks(context, artPng);
  await context.addInitScript(seedAuth);
  const page = await context.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(`${BASE}?debug`);
  await page.click('.source-btn.spotify');

  const active = await waitFor(() => page.evaluate(() => window.__mv?.debugSpotify().active), 8000);
  check(active, 'Spotify mode started');
  const st = await waitFor(
    () => page.evaluate(() => {
      const s = window.__mv.debugSpotify();
      return s.state === 'beatlock' ? s : null;
    }),
    12000,
  );
  check(!!st, 'state became beatlock', JSON.stringify(await debugSpotify(page)));
  if (st) {
    check(st.track?.name === 'Test Song', 'track resolved from now-playing');
    check(st.tempo?.bpm === 120 && st.tempo.source === 'deezer', 'tempo from Deezer = 120 BPM', JSON.stringify(st.tempo));
  }

  const beats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let beats = 0;
        let frames = 0;
        let bpm = 0;
        const t0 = performance.now();
        (function tick() {
          const m = window.__mv.debugMetrics();
          if (m?.beat) beats++;
          bpm = m?.bpm ?? 0;
          frames++;
          if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
          else resolve({ beats, frames, bpm });
        })();
      }),
  );
  check(
    beats.beats >= 5 && beats.beats <= 11,
    `beat-lock fires ~8 beats in 4 s at 120 BPM (got ${beats.beats} over ${beats.frames} frames)`,
  );
  check(beats.bpm === 120, 'frame bpm reports 120', String(beats.bpm));

  const pal = await page.evaluate(() => window.__mv.manager.paletteOverride);
  check(Array.isArray(pal) && pal.length >= 2, 'album-art palette applied', JSON.stringify(pal));
  if (Array.isArray(pal)) {
    const hues = pal.map(hexHue);
    check(
      hues.some((h) => h < 20 || h > 340) && hues.some((h) => h > 200 && h < 260),
      "palette carries the cover's red + blue",
      JSON.stringify(hues),
    );
  }

  const card = await page.evaluate(() => {
    const c = document.querySelector('.np-card');
    return c
      ? {
          visible: c.classList.contains('visible'),
          title: c.querySelector('.np-title')?.textContent,
          chip: c.querySelector('.np-chip')?.textContent,
        }
      : null;
  });
  check(card?.visible && card.title === 'Test Song', 'now-playing card shows the track', JSON.stringify(card));
  check(card?.chip?.includes('Beat-locked'), 'card chip says beat-locked', card?.chip);

  const ids = await page.evaluate(() => window.__mv.manager.list().map((p) => p.id));
  for (const id of ids) {
    await page.evaluate((i) => window.__mv.setPreset(i), id);
    await sleep(120);
  }
  check(errors.length === 0, `no console/page errors across ${ids.length} presets in beat-lock`, errors.slice(0, 5).join(' | '));

  await page.click('.np-tap');
  await sleep(250);
  const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent);
  check(/beat/i.test(toast ?? ''), 'tap-beat gives feedback', toast);
  await browser.close();
}

async function scenarioListening(artPng) {
  console.log('\n[B] speakers → listening (fake mic tone)');
  const browser = await chromium.launch({ executablePath: EXE, args: FLAGS });
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await installMocks(context, artPng);
  await context.addInitScript(seedAuth);
  const page = await context.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(`${BASE}?debug`);
  await page.click('.source-btn.spotify');
  const s = await waitFor(
    () => page.evaluate(() => {
      const s = window.__mv?.debugSpotify();
      return s?.active && s.state === 'listening' && s.rawLevel > 0.005 ? s : null;
    }),
    10000,
  );
  check(!!s, 'state is listening with mic signal', JSON.stringify(await debugSpotify(page)));
  await sleep(3000);
  const still = await debugSpotify(page);
  check(still?.state === 'listening', 'stays listening while the mic hears signal', JSON.stringify(still));
  check(errors.length === 0, 'no errors', errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function scenarioOAuth(artPng) {
  console.log('\n[C] web OAuth round-trip (PKCE)');
  const browser = await chromium.launch({ executablePath: EXE, args: FLAGS });
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await installMocks(context, artPng);
  await context.addInitScript(seedClientId);
  const page = await context.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(`${BASE}?debug`);
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith('https://accounts.spotify.com/authorize')),
    page.click('.source-btn.spotify'),
  ]);
  const q = new URL(req.url()).searchParams;
  check(q.get('client_id') === 'test-client', 'authorize URL carries the client id');
  check(
    q.get('code_challenge_method') === 'S256' && (q.get('code_challenge') ?? '').length >= 40,
    'PKCE S256 challenge present',
  );
  check(q.get('redirect_uri') === BASE, `redirect_uri is the page URL (${q.get('redirect_uri')})`);
  check((q.get('scope') ?? '').includes('user-read-currently-playing'), 'scope requested');
  const state = q.get('state');
  check(!!state, 'state present');

  // "Spotify" sends the user back with a code.
  await page.goto(`${BASE}?code=fake-code&state=${state}&debug`);
  const done = await waitFor(
    () => page.evaluate(() => {
      const s = window.__mv?.debugSpotify();
      return s?.connected && s.active ? s : null;
    }),
    10000,
  );
  check(!!done, 'callback exchanged for tokens and Spotify mode auto-started', JSON.stringify(await debugSpotify(page)));
  const url = await page.evaluate(() => location.href);
  check(!url.includes('code=') && url.includes('debug'), 'address bar cleaned (code removed, other params kept)', url);
  check(errors.length === 0, 'no errors', errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function scenarioPwa() {
  console.log('\n[D] PWA assets');
  const browser = await chromium.launch({ executablePath: EXE, args: FLAGS });
  const page = await browser.newPage();
  const m = await page.goto(`${BASE}manifest.webmanifest`);
  const manifest = await m.json().catch(() => null);
  check(m.ok() && manifest?.display === 'standalone' && manifest.icons?.length === 3, 'manifest served', String(m.status()));
  const i = await page.goto(`${BASE}icons/icon-192.png`);
  check(i.ok() && (i.headers()['content-type'] ?? '').includes('image/png'), 'icon-192 served');
  const html = await (await page.goto(BASE)).text();
  check(
    html.includes('/music-viz/manifest.webmanifest') && html.includes('apple-touch-icon'),
    'index.html links manifest + apple-touch-icon',
  );
  await browser.close();
}

// ---- run ----

const preview = await startPreview();
try {
  writeSilenceWav(SILENCE);
  const b = await chromium.launch({ executablePath: EXE, args: FLAGS });
  const artPng = await makeArtPng(b);
  await b.close();
  await scenarioBeatLock(artPng);
  await scenarioListening(artPng);
  await scenarioOAuth(artPng);
  await scenarioPwa();
} finally {
  preview.kill('SIGTERM');
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
