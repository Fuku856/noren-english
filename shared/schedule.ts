/**
 * 「次に開く瞬間」。通知の送信時刻を決める。
 *
 * ⚠ フロントと Cloudflare Worker / Pages Functions の両方から読まれる。
 *    DOM / storage / 環境時刻に触らないこと。時刻は必ず引数で受け取る。
 *
 * サーバーは開店時刻を SQL で求められない（SHA-256 由来）ので、
 * 購読ごとに「次に送る瞬間」をこの関数で前もって計算して D1 に入れておく。
 * フロントの開店判定と1ミリ秒でもずれると「通知が来たのに開いていない」になるので、
 * 開店時刻そのものは shared/openTime.ts の関数をそのまま使う。
 */

import { addDays, dateKeyOf } from "./dateKey";
import { openInstantMs } from "./openTime";
import type { TimeWindow } from "./window";

export interface PendingWindow {
  window: TimeWindow;
  /** この のれん日 から有効。当日変更を許すと窓を狭めて即開店できてしまう。 */
  effectiveFrom: string;
}

export interface WindowPlan {
  window: TimeWindow;
  pending: PendingWindow | null;
}

export interface Schedule extends WindowPlan {
  salt: string;
}

/**
 * その のれん日 に実際に効いている時間帯。
 * pending の effectiveFrom に達していれば pending が勝つ。
 * dateKey は "YYYY-MM-DD" なので辞書順比較でそのまま日付比較になる。
 */
export function effectiveWindow(p: WindowPlan, dateKey: string): TimeWindow {
  if (p.pending && dateKey >= p.pending.effectiveFrom) return p.pending.window;
  return p.window;
}

/**
 * afterMs より**後**（厳密に大きい）に来る最初の開店の瞬間。epoch ms。
 *
 * 今日と翌日の2日だけ見れば足りる。窓は 04:00 JST をまたげない（validateWindow）ので、
 * 翌日の開店は必ず今日のどの時刻よりも後に来る。
 *
 * 開店のちょうどその瞬間を渡すと翌日が返る。送信した直後に次の予定へ進めるときの形。
 */
export async function nextOpenInstant(s: Schedule, afterMs: number): Promise<number> {
  const today = dateKeyOf(afterMs);
  for (const dateKey of [today, addDays(today, 1)]) {
    const at = await openInstantMs({
      salt: s.salt,
      dateKey,
      window: effectiveWindow(s, dateKey),
    });
    if (at > afterMs) return at;
  }
  // 窓の検証を通っていればここには来ない
  throw new RangeError("次の開店時刻が見つかりません");
}
