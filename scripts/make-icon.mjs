// Génère app-icon.png (1024x1024) sans dépendance, puis `tauri icon` en dérive toutes les tailles.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const px = Buffer.alloc(S * S * 4);

const inRoundRect = (x, y, x0, y0, w, h, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const mix = (a, b, t) => Math.round(a + (b - a) * t);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inRoundRect(x, y, 64, 64, 896, 896, 240)) continue;
    const t = (y - 64) / 896;
    let [r, g, b] = [mix(0x5a, 0x1e, t), mix(0xc8, 0x88, t), mix(0xfa, 0xe5, t)];
    // « Écran du haut » et « écran du bas » façon 3DS.
    if (inRoundRect(x, y, 224, 224, 576, 256, 80)) [r, g, b] = [255, 255, 255];
    else if (inRoundRect(x, y, 288, 544, 448, 256, 80)) [r, g, b] = [mix(r, 255, 0.7), mix(g, 255, 0.7), mix(b, 255, 0.7)];
    if ((x - 512) ** 2 + (y - 672) ** 2 <= 56 ** 2) [r, g, b] = [0x1e, 0x88, 0xe5];
    px.set([r, g, b, 255], i);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);

writeFileSync(
  "app-icon.png",
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log("app-icon.png généré");
