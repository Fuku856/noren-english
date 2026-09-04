/**
 * アプリアイコンを生成する。
 *
 *   node scripts/make-icons.mjs
 *
 * 図案は語のタイルが3行。アプリの中で実際に触るものと同じ形にしてある。
 * キャラクターも記号的モチーフも置かない。他の語学アプリの図案を真似ない。
 *
 * 依存を増やさないために PNG は自前で書く（zlib は Node 標準）。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url));

const PRIMARY = [0x2f, 0x5b, 0xd8]; // 藍。tokens.css の --primary
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGB のピクセル関数から PNG を作る。 */
function png(size, pixel) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const i = y * (stride + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 角丸の矩形に入っているか。 */
function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * @param size    画像の一辺
 * @param inset   図案を収める割合。maskable は小さめ（角が切られても欠けないように）
 */
function mark(size, inset) {
  const pad = (size * (1 - inset)) / 2;
  const w = size * inset;

  const barH = w * 0.19;
  const gap = w * 0.13;
  const widths = [1, 0.62, 0.85];
  const total = barH * 3 + gap * 2;
  const top = pad + (w - total) / 2;
  const r = barH / 2;

  const bars = widths.map((ratio, i) => ({
    x0: pad,
    x1: pad + w * ratio,
    y0: top + i * (barH + gap),
    y1: top + i * (barH + gap) + barH,
  }));

  return (x, y) => {
    for (const b of bars) {
      if (inRounded(x, y, b.x0, b.y0, b.x1, b.y1, r)) return WHITE;
    }
    return PRIMARY;
  };
}

mkdirSync(OUT, { recursive: true });

const files = [
  ["icon-192.png", 192, 0.7],
  ["icon-512.png", 512, 0.7],
  ["maskable-512.png", 512, 0.52], // マスクで角が落ちても図案が欠けない
  ["apple-touch-icon-180.png", 180, 0.7],
];

for (const [name, size, inset] of files) {
  const buf = png(size, mark(size, inset));
  writeFileSync(OUT + name, buf);
  console.log(`${name.padEnd(28)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
