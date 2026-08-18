/**
 * 開店時間帯（窓）の検証。
 *
 * ⚠ フロントと Worker の両方から読まれる。DOM / storage / 環境時刻に触らないこと。
 */

import { DAY_START_MIN, MIN_PER_DAY } from "./dateKey";

/** 分単位。21:00 → 1260, 23:00 → 1380。深夜をまたぐ場合 end < start になりうる。 */
export interface TimeWindow {
  start: number;
  end: number;
}

/** 狭すぎると固定時刻と変わらない。 */
export const MIN_WINDOW = 60;
/** 広すぎると張り込みが辛い。 */
export const MAX_WINDOW = 360;

export type WindowError = "out_of_range" | "too_short" | "too_long" | "crosses_day_start";

export type WindowCheck =
  | { ok: true; length: number }
  | { ok: false; reason: WindowError };

/** のれん日の始まり（04:00 JST）を 0 とした分。窓が1日に収まるかの判定に使う。 */
export function dayMinute(minuteOfDay: number): number {
  return (minuteOfDay - DAY_START_MIN + MIN_PER_DAY) % MIN_PER_DAY;
}

/** 深夜またぎを許した窓の長さ。 */
export function windowLength(w: TimeWindow): number {
  return (w.end - w.start + MIN_PER_DAY) % MIN_PER_DAY;
}

/**
 * 窓の妥当性。
 *
 * 04:00 JST をまたぐ窓は禁止する。またぐと1つののれん日の中に開店が2回来るか
 * 1回も来ないかのどちらかになり、「1日1回」という前提が壊れるため。
 *
 * 21:00-23:00 → 可
 * 23:00-01:00 → 可（0時はまたぐが4時はまたがない）
 * 02:00-06:00 → 不可
 */
export function validateWindow(w: TimeWindow): WindowCheck {
  const { start, end } = w;
  const inRange = (m: number) => Number.isInteger(m) && m >= 0 && m < MIN_PER_DAY;
  if (!inRange(start) || !inRange(end)) return { ok: false, reason: "out_of_range" };

  const length = windowLength(w);
  if (length < MIN_WINDOW) return { ok: false, reason: "too_short" };
  if (length > MAX_WINDOW) return { ok: false, reason: "too_long" };
  if (dayMinute(start) + length > MIN_PER_DAY) {
    return { ok: false, reason: "crosses_day_start" };
  }
  return { ok: true, length };
}

export function isValidWindow(w: TimeWindow): boolean {
  return validateWindow(w).ok;
}

/** 既定の窓。夜に開くアプリなので 21:00-23:00。 */
export const DEFAULT_WINDOW: TimeWindow = { start: 21 * 60, end: 23 * 60 };
