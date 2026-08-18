/**
 * のれん日（JST 午前4時境界）の計算。
 *
 * ⚠ このファイルはフロントと Cloudflare Worker の両方から読まれる。
 *    使ってよいのは `Date.UTC` / 引数つき `new Date(ms)` / UTC ゲッタのみ。
 *    `window` `document` `localStorage` `process` `Date.now()` に触らないこと。
 *
 * 日本は 1951 年以降サマータイムを採用していないので、固定 +09:00 で厳密に正しい。
 * タイムゾーンデータベースは不要。
 */

export const JST_OFFSET_MS = 9 * 3_600_000;

/** のれん日の始まり。04:00 JST。深夜に解く人が「日をまたいだせいで2日消費した」とならないように。 */
export const DAY_START_MIN = 240;
export const DAY_START_MS = DAY_START_MIN * 60_000;

export const MS_PER_DAY = 86_400_000;
export const MIN_PER_DAY = 1440;

/** `dayNumber` の基準日。ここを動かすと例文の並びが全部ずれるので変更しないこと。 */
export const EPOCH_DATE_KEY = "2026-01-01";

const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * epoch ms → "YYYY-MM-DD"。
 * 1日は 04:00:00 JST から翌カレンダー日の 03:59:59.999 JST まで。
 *
 * 仕組み: `+9h` すると UTC フィールドが JST の壁時計として読める。
 * さらに `-4h` すると 04:00 JST がシフト後の 00:00 に乗るので、
 * シフト値の *UTC 日付* がそのまま「のれん日」になる。
 * 端末のタイムゾーンは一度も参照されない。
 */
export function dateKeyOf(nowMs: number): string {
  const d = new Date(nowMs + JST_OFFSET_MS - DAY_START_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" → [年, 月(1-12), 日] */
function parseKey(dateKey: string): [number, number, number] {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  const d = Number(dateKey.slice(8, 10));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new RangeError(`不正な dateKey: ${dateKey}`);
  }
  return [y, m, d];
}

/** そののれん日が始まる瞬間（04:00 JST）の epoch ms。 */
export function dayStartMs(dateKey: string): number {
  const [y, m, d] = parseKey(dateKey);
  return Date.UTC(y, m - 1, d) - JST_OFFSET_MS + DAY_START_MS;
}

/**
 * のれん日 `dateKey` の中の JST 分（0-1439）→ epoch ms。
 *
 * ⚠ 非対称に注意。分 0〜239（00:00〜03:59 JST）は のれん日の *末尾* なので、
 *    カレンダー上は `dateKey` の翌日に落ちる。ここを逆にするのが
 *    このコードベースで最も起きやすいバグ。
 */
export function jstMinuteToEpoch(dateKey: string, minuteOfDay: number): number {
  const [y, m, d] = parseKey(dateKey);
  const midnightJst = Date.UTC(y, m - 1, d) - JST_OFFSET_MS;
  const t = midnightJst + minuteOfDay * 60_000;
  return minuteOfDay < DAY_START_MIN ? t + MS_PER_DAY : t;
}

/** epoch ms → JST の分（0-1439）。壁時計としての「今何時何分か」。 */
export function jstMinuteOfDay(nowMs: number): number {
  const d = new Date(nowMs + JST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** dateKey に n 日足す（負も可）。 */
export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = parseKey(dateKey);
  const shifted = new Date(Date.UTC(y, m - 1, d) + n * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${p2(shifted.getUTCMonth() + 1)}-${p2(shifted.getUTCDate())}`;
}

/** EPOCH_DATE_KEY からの経過日数。例文デッキの位置に使う。 */
export function dayNumber(dateKey: string): number {
  const [y, m, d] = parseKey(dateKey);
  const [ey, em, ed] = parseKey(EPOCH_DATE_KEY);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / MS_PER_DAY);
}

/** 2つの dateKey の日数差（a - b）。 */
export function daysBetween(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

/** そののれん日が月曜に始まるか。チケットの補充判定（JST 月曜 4:00）に使う。 */
export function isMondayJst(dateKey: string): boolean {
  const [y, m, d] = parseKey(dateKey);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

/** そののれん日が属する週のキー（その週の月曜の dateKey）。繰り越しなしの補充判定に使う。 */
export function weekKeyOf(dateKey: string): string {
  const [y, m, d] = parseKey(dateKey);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日
  const backToMonday = (dow + 6) % 7;
  return addDays(dateKey, -backToMonday);
}

/** 分（0-1439）→ "HH:MM"。画面表示用。 */
export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  return `${p2(h)}:${p2(minuteOfDay % 60)}`;
}
