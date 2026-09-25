// Finishes the Lively Wallpaper package after `vite build` (VITE_MV_LIVELY=1):
// copies the wallpaper manifest and a thumbnail next to the built index.html in
// dist-lively/. Lively imports a folder or a .zip of it; zipping is left to the OS
// (Windows: right-click dist-lively → "Compress to ZIP file") or to CI.
//   npm run build:lively
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'dist-lively';
const copies = [
  ['lively/LivelyInfo.json', 'LivelyInfo.json'],
  ['public/icons/icon-512.png', 'thumbnail.png'],
];

if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.error(`${OUT}/index.html not found: run "vite build" with VITE_MV_LIVELY=1 first.`);
  process.exit(1);
}
for (const [src, dst] of copies) {
  fs.copyFileSync(src, path.join(OUT, dst));
  console.log(`copied ${src} -> ${OUT}/${dst}`);
}
console.log(`Lively package ready in ${OUT}/ (drag the folder or a .zip of it into Lively).`);
