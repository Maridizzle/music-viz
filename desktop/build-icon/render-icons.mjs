// Renders desktop/build-icon/icon.html to per-size PNGs, then run make-ico.mjs to
// pack desktop/build/icon.ico. Dev-only: needs `npm i -D playwright-core` and the
// bundled Chromium. Usage: node render-icons.mjs && node make-ico.mjs .
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HTML = new URL('./icon.html', import.meta.url).href;
const DIR = new URL('.', import.meta.url).pathname;
const sizes = [1024, 256, 128, 64, 48, 32, 24, 16];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
  await page.goto(HTML, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${DIR}/size_${s}.png`, omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
  await page.close();
}
await browser.close();
console.log('rendered', sizes.join(' '));
