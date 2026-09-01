// Renders every icon size the web app (PWA) and the Android app need from the
// 1024px master in desktop/build/icon.png, using headless Chromium's canvas.
//   npm i --no-save playwright-core && npm run icons
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'desktop/build/icon.png';
const TILE = '#0c0f20'; // the tile's fill → full-bleed squares for launchers/iOS
const candidates = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];
const executablePath = candidates.find((p) => fs.existsSync(p));

// { out, size, pad (inset fraction per side), bg (null = transparent) }
const RES = 'android/app/src/main/res';
const targets = [
  { out: 'public/icons/icon-192.png', size: 192, pad: 0, bg: TILE },
  { out: 'public/icons/icon-512.png', size: 512, pad: 0, bg: TILE },
  { out: 'public/icons/apple-touch-icon.png', size: 180, pad: 0, bg: TILE },
  { out: 'public/icons/maskable-512.png', size: 512, pad: 0.06, bg: TILE },
  { out: 'public/icons/favicon-32.png', size: 32, pad: 0, bg: TILE },
];
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, scale] of Object.entries(densities)) {
  targets.push({ out: `${RES}/mipmap-${d}/ic_launcher.png`, size: 48 * scale, pad: 0, bg: TILE });
  targets.push({ out: `${RES}/mipmap-${d}/ic_launcher_round.png`, size: 48 * scale, pad: 0, bg: TILE });
  // Adaptive foreground: 108dp canvas, content kept inside the 66dp safe zone.
  targets.push({ out: `${RES}/mipmap-${d}/ic_launcher_foreground.png`, size: 108 * scale, pad: 0.16, bg: null });
}

const b64 = fs.readFileSync(SRC).toString('base64');
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
for (const t of targets) {
  const dataUrl = await page.evaluate(
    async ({ b64, size, pad, bg }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.getElementById('c');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const inner = size * (1 - 2 * pad);
      ctx.drawImage(img, size * pad, size * pad, inner, inner);
      return c.toDataURL('image/png');
    },
    { b64, size: t.size, pad: t.pad, bg: t.bg },
  );
  fs.mkdirSync(path.dirname(t.out), { recursive: true });
  fs.writeFileSync(t.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', t.out, t.size);
}
await browser.close();
