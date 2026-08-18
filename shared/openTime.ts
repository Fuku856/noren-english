/**
 * 開店時刻のアルゴリズム。
 *
 * サーバーを使わず、かつリロードしても変わらない値が必要なので、
 * 日付と salt から決定論的に導く。
 *
 * ⚠ この関数はフロントと Cloudflare Worker の *両方* が同じ答えを出さなければならない。
 *    片方だけ直すと「通知が違う分に飛ぶ」という最悪の壊れ方をする。
 *    だから1ファイルに切り出し、両方から読む。
 *    仕様を変える前に shared/fixtures/openTime.vectors.json を確認すること。
 *
 * 固定した約束:
 *   - ハッシュは SHA-256(salt + dateKey) の UTF-8 バイト列
 *   - 先頭4バイトを **ビッグエンディアン** の uint32 として読む（DataView の既定）
 *   - 返り値の範囲は [start, start + length)。end は排他
 *   - 剰余バイアスは 2^32 に対し length ≤ 360 なので約 8e-8。無視してよい。
 *     「直そう」として実装を変えると Worker とのパリティが壊れるので触らないこと
 */

import { jstMinuteToEpoch, MIN_PER_DAY } from "./dateKey";
import { validateWindow, windowLength, type TimeWindow } from "./window";

export interface OpenTimeInput {
  salt: string;
  dateKey: string;
  window: TimeWindow;
}

/** 5分。 */
export const SESSION_MS = 5 * 60_000;
/** チケットを使ったときは3分。 */
export const TICKET_SESSION_MS = 3 * 60_000;

async function hashUint32(input: string): Promise<number> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new DataView(hash).getUint32(0);
}

/** その日の開店時刻。JST の分（0-1439）。 */
export async function openMinute(i: OpenTimeInput): Promise<number> {
  const check = validateWindow(i.window);
  if (!check.ok) throw new RangeError(`不正な時間帯: ${check.reason}`);
  const n = await hashUint32(i.salt + i.dateKey);
  return (i.window.start + (n % check.length)) % MIN_PER_DAY;
}

/** その日の開店の瞬間。epoch ms。 */
export async function openInstantMs(i: OpenTimeInput): Promise<number> {
  return jstMinuteToEpoch(i.dateKey, await openMinute(i));
}

/** 窓の長さ（分）。UI から検証なしに聞きたいとき用。 */
export { windowLength };
