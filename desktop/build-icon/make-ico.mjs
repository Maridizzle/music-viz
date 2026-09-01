// Pack per-size PNGs into a multi-resolution Windows .ico (PNG-compressed entries,
// supported by Windows Vista+). No native image tooling required.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] || '.';
const out = process.argv[3] || `${dir}/icon.ico`;
const sizes = [256, 128, 64, 48, 32, 24, 16];

const imgs = sizes.map((s) => ({ s, data: readFileSync(`${dir}/size_${s}.png`) }));
const count = imgs.length;

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4);

const entries = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
imgs.forEach((im, i) => {
  const e = i * 16;
  entries.writeUInt8(im.s >= 256 ? 0 : im.s, e + 0); // width (0 => 256)
  entries.writeUInt8(im.s >= 256 ? 0 : im.s, e + 1); // height
  entries.writeUInt8(0, e + 2); // palette colors
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // color planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(im.data.length, e + 8);
  entries.writeUInt32LE(offset, e + 12);
  offset += im.data.length;
});

writeFileSync(out, Buffer.concat([header, entries, ...imgs.map((i) => i.data)]));
console.log(`wrote ${out}: ${count} sizes, ${offset} bytes`);
