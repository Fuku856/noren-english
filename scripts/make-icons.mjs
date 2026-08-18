/**
 * アプリアイコンを生成する。
 *
 *   node scripts/make-icons.mjs
 *
 * 図案は暖簾そのもの。横木から錆朱の布が下がり、縦のスリットが入っている。
 * 提灯も徳利も桜も使わない。居酒屋の看板にしないこと。
 * 暖簾に屋号は入れない（文字を入れた瞬間に看板になる）。
 *
 * 依存を増やさないために PNG は自前で書く（zlib は Node 標準）。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url));

const INK = [0x15, 0x13, 0x0f];
const RUST = [0xa8, 0x41, 0x2f];
const BAR = [0x9a, 0x95, 0x8a];

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

/**
 * @param size    画像の一辺
 * @param inset   図案を収める割合。maskable は 0.8（角が切られても欠けないように）
 */
function noren(size, inset) {
  const pad = (size * (1 - inset)) / 2;
  const w = size * inset;

  const barY = pad + w * 0.16;
  const barH = Math.max(2, Math.round(w * 0.045));
  const clothTop = barY + barH;
  const clothH = w * 0.62;
  const left = pad;
  const right = pad + w;

  // 3枚に割る。スリットは布の下半分だけに入る（暖簾の作り）
  const slitW = Math.max(2, Math.round(w * 0.022));
  const panel = w / 3;
  const slitTop = clothTop + clothH * 0.35;

  return (x, y) => {
    if (x >= left && x < right && y >= barY && y < barY + barH) return BAR;

    if (x >= left && x < right && y >= clothTop && y < clothTop + clothH) {
      if (y >= slitTop) {
        for (const s of [left + panel, left + panel * 2]) {
          if (x >= s - slitW / 2 && x < s + slitW / 2) return INK;
        }
      }
      return RUST;
    }
    return INK;
  };
}

mkdirSync(OUT, { recursive: true });

const files = [
  ["icon-192.png", 192, 0.86],
  ["icon-512.png", 512, 0.86],
  ["maskable-512.png", 512, 0.62], // マスクで角が落ちても図案が欠けない
  ["apple-touch-icon-180.png", 180, 0.86],
];

for (const [name, size, inset] of files) {
  const buf = png(size, noren(size, inset));
  writeFileSync(OUT + name, buf);
  console.log(`${name.padEnd(28)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
