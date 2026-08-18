// shared/fixtures/openTime.vectors.json を生成する。
//
// このベクタはフロントと Worker が同じ開店時刻を出すことを保証するための凍結値。
// 一度生成したらコミットし、以後は**再生成しない**。
// 再生成が必要になったということは開店時刻の仕様が変わったということで、
// それは既存ユーザの開店時刻が全員ずれることを意味する。
import { writeFileSync } from "node:fs";

const JST_OFFSET_MS = 9 * 3600_000;
const DAY_START_MIN = 240;
const MIN_PER_DAY = 1440;

function jstMinuteToEpoch(dateKey, minuteOfDay) {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  const d = Number(dateKey.slice(8, 10));
  const midnightJst = Date.UTC(y, m - 1, d) - JST_OFFSET_MS;
  const t = midnightJst + minuteOfDay * 60_000;
  return minuteOfDay < DAY_START_MIN ? t + 86_400_000 : t;
}

async function openMinute(salt, dateKey, start, end) {
  const length = (end - start + MIN_PER_DAY) % MIN_PER_DAY;
  const buf = new TextEncoder().encode(salt + dateKey);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const n = new DataView(hash).getUint32(0);
  return (start + (n % length)) % MIN_PER_DAY;
}

const salts = [
  "00000000-0000-4000-8000-000000000000",
  "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f",
  "noren-test-salt",
  "ええと日本語のsalt",
];
const dateKeys = ["2026-01-01", "2026-08-18", "2026-12-31", "2028-02-29"];
const windows = [
  { start: 21 * 60, end: 23 * 60 },
  { start: 19 * 60, end: 22 * 60 },
  { start: 23 * 60, end: 1 * 60 },
];

const vectors = [];
for (const salt of salts) {
  for (const dateKey of dateKeys) {
    for (const win of windows) {
      const minute = await openMinute(salt, dateKey, win.start, win.end);
      vectors.push({
        salt,
        dateKey,
        window: win,
        expectedMinute: minute,
        expectedInstantMs: jstMinuteToEpoch(dateKey, minute),
      });
    }
  }
}

writeFileSync(
  new URL("../shared/fixtures/openTime.vectors.json", import.meta.url),
  JSON.stringify(
    {
      note: "凍結値。フロントと Worker のパリティを守るためのもの。再生成しないこと。",
      algorithm: "SHA-256(salt + dateKey) の先頭4バイトをビッグエンディアン uint32 として読み、窓の長さで剰余",
      vectors,
    },
    null,
    2,
  ) + "\n",
);
console.log(`${vectors.length} 件のベクタを生成しました`);
