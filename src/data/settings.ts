/**
 * 時間帯設定と salt。
 *
 * 時間帯の変更が翌日から反映されるのがここの肝。
 * 本当の脅威は開店時刻の総当たり発見ではない（閉店画面が今日の開店時刻を出しているので
 * 発見に意味がない）。脅威は **窓を今すぐ狭めて即座に開店させること**。
 */

import { addDays } from "@shared/dateKey";
import { isValidWindow, type TimeWindow } from "@shared/window";
import {
  defaultSettings,
  parseSalt,
  parseSettings,
  type PendingWindow,
  type Mode,
  type Settings,
} from "./schema";
import { KEYS, readJson, readRaw, writeJson, writeRaw } from "./storage";

export function loadSettings(): Settings {
  return readJson(KEYS.settings, parseSettings);
}

export function saveSettings(s: Settings): void {
  writeJson(KEYS.settings, s);
}

/**
 * その のれん日 に実際に効いている時間帯。
 * pending の effectiveFrom に達していれば pending が勝つ。
 * dateKey は "YYYY-MM-DD" なので辞書順比較でそのまま日付比較になる。
 */
export function effectiveWindow(s: Settings, dateKey: string): TimeWindow {
  if (s.pending && dateKey >= s.pending.effectiveFrom) return s.pending.window;
  return s.window;
}

/** 時間帯の変更を予約する。反映は翌日から。 */
export function requestWindow(
  s: Settings,
  next: TimeWindow,
  todayKey: string,
): Settings {
  if (!isValidWindow(next)) return s;
  const pending: PendingWindow = { window: next, effectiveFrom: addDays(todayKey, 1) };
  return { ...s, pending };
}

/**
 * effectiveFrom に達した pending を本採用に昇格させる。
 * 起動時に1度呼べばよい（画面表示を素直に保つため）。
 */
export function promotePending(s: Settings, todayKey: string): Settings {
  if (!s.pending || todayKey < s.pending.effectiveFrom) return s;
  return { ...s, window: s.pending.window, pending: null };
}

export function setMode(s: Settings, mode: Mode): Settings {
  return { ...s, mode };
}

export function markInstallPrompted(s: Settings): Settings {
  return { ...s, installedPrompted: true };
}

/** 初回設定が済んでいるか。窓を1度も選んでいなければ未了。 */
export function isConfigured(s: Settings): boolean {
  return s.installedPrompted;
}

// ---------------------------------------------------------------- salt

/**
 * 開店時刻を決める種。初回に1度だけ生成して持ち続ける。
 * これが変わると開店時刻が変わるので、読み込み（インポート）時の扱いに注意すること。
 */
export function loadOrCreateSalt(): string {
  const existing = parseSalt(readRaw(KEYS.salt));
  if (existing) return existing;
  const salt = crypto.randomUUID();
  writeRaw(KEYS.salt, salt);
  return salt;
}

export function currentSalt(): string | null {
  return parseSalt(readRaw(KEYS.salt));
}

export { defaultSettings };
