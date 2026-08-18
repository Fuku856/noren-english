/**
 * localStorage に入るデータの型と、その検証。
 *
 * 検証を手書きしているのはライブラリを増やさないためだけではなく、
 * **壊れた値で起動不能にしない**ことが目的。読めなかった項目は既定値に落として、
 * アプリは必ず立ち上がる。30日続けてもらうアプリで白画面は許されない。
 */

import { DEFAULT_WINDOW, isValidWindow, type TimeWindow } from "@shared/window";

/** 保存形式のバージョン。上げたら src/data/migrate.ts に移行を書く。 */
export const SCHEMA_VERSION = 1;

export type Mode = "speak" | "arrange";
export type SessionSource = "daily" | "ticket";
export type RecordKind = "normal" | "review";

export interface PendingWindow {
  window: TimeWindow;
  /** この のれん日 から有効。当日変更を許すと窓を狭めて即開店できてしまう。 */
  effectiveFrom: string;
}

export interface Settings {
  schemaVersion: number;
  window: TimeWindow;
  pending: PendingWindow | null;
  /** 利用者が選んだ既定のモード。端末が音読に非対応なら実行時に arrange へ落ちる。 */
  mode: Mode;
  /** ホーム画面追加の案内を出したか。 */
  installedPrompted: boolean;
}

export interface DayRecord {
  /** のれん日（JST午前4時境界）。 */
  date: string;
  opened: boolean;
  solved: boolean;
  /** 0〜1。未解答なら null。 */
  accuracy: number | null;
  sentenceId: number;
  mode: Mode;
  source: SessionSource;
  kind: RecordKind;
  /** 端末の時計が巻き戻された日。Phase 4 の集計から除外する。 */
  clockAnomaly: boolean;
}

export interface Tickets {
  count: number;
  /** 補充した週のキー（その週の月曜の dateKey）。繰り越しなしの判定に使う。 */
  refilledWeek: string;
}

export interface Milestones {
  seen7: boolean;
  seen14: boolean;
  seen21: boolean;
  seen30: boolean;
}

// ---------------------------------------------------------------- 既定値

export const WEEKLY_TICKETS = 2;

export function defaultSettings(): Settings {
  return {
    schemaVersion: SCHEMA_VERSION,
    window: { ...DEFAULT_WINDOW },
    pending: null,
    // Phase 1 は並べ替えのみ。Phase 2 で SpeechRecognition が使える端末だけ
    // "speak" に切り替える（capabilities.ts）
    mode: "arrange",
    installedPrompted: false,
  };
}

export function defaultTickets(): Tickets {
  return { count: WEEKLY_TICKETS, refilledWeek: "" };
}

export function defaultMilestones(): Milestones {
  return { seen7: false, seen14: false, seen21: false, seen30: false };
}

// ---------------------------------------------------------------- 検証

const isObj = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const bool = (u: unknown, fallback: boolean): boolean =>
  typeof u === "boolean" ? u : fallback;

const str = (u: unknown, fallback: string): string =>
  typeof u === "string" ? u : fallback;

const int = (u: unknown, fallback: number): number =>
  typeof u === "number" && Number.isInteger(u) ? u : fallback;

const isDateKey = (u: unknown): u is string =>
  typeof u === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u);

function parseWindow(u: unknown): TimeWindow | null {
  if (!isObj(u)) return null;
  const w = { start: int(u["start"], -1), end: int(u["end"], -1) };
  return isValidWindow(w) ? w : null;
}

function parseMode(u: unknown): Mode {
  return u === "speak" ? "speak" : "arrange";
}

export function parseSettings(u: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(u)) return d;

  const pendingRaw = u["pending"];
  let pending: PendingWindow | null = null;
  if (isObj(pendingRaw)) {
    const w = parseWindow(pendingRaw["window"]);
    const from = pendingRaw["effectiveFrom"];
    if (w && isDateKey(from)) pending = { window: w, effectiveFrom: from };
  }

  return {
    schemaVersion: int(u["schemaVersion"], SCHEMA_VERSION),
    window: parseWindow(u["window"]) ?? d.window,
    pending,
    mode: parseMode(u["mode"]),
    installedPrompted: bool(u["installedPrompted"], d.installedPrompted),
  };
}

export function parseRecord(u: unknown): DayRecord | null {
  if (!isObj(u) || !isDateKey(u["date"])) return null;

  const acc = u["accuracy"];
  const accuracy =
    typeof acc === "number" && acc >= 0 && acc <= 1 ? acc : null;

  return {
    date: u["date"],
    opened: bool(u["opened"], false),
    solved: bool(u["solved"], false),
    accuracy,
    sentenceId: int(u["sentenceId"], -1),
    mode: parseMode(u["mode"]),
    source: u["source"] === "ticket" ? "ticket" : "daily",
    kind: u["kind"] === "review" ? "review" : "normal",
    clockAnomaly: bool(u["clockAnomaly"], false),
  };
}

/** 記録の配列。壊れた行は捨てて残りを活かす。日付順に整列し、重複は後勝ち。 */
export function parseRecords(u: unknown): DayRecord[] {
  if (!Array.isArray(u)) return [];
  const byDate = new Map<string, DayRecord>();
  for (const row of u) {
    const r = parseRecord(row);
    if (r) byDate.set(r.date, r);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseTickets(u: unknown): Tickets {
  const d = defaultTickets();
  if (!isObj(u)) return d;
  const count = int(u["count"], d.count);
  return {
    count: Math.max(0, Math.min(WEEKLY_TICKETS, count)),
    refilledWeek: isDateKey(u["refilledWeek"]) ? u["refilledWeek"] : d.refilledWeek,
  };
}

export function parseMilestones(u: unknown): Milestones {
  const d = defaultMilestones();
  if (!isObj(u)) return d;
  return {
    seen7: bool(u["seen7"], d.seen7),
    seen14: bool(u["seen14"], d.seen14),
    seen21: bool(u["seen21"], d.seen21),
    seen30: bool(u["seen30"], d.seen30),
  };
}

export function parseSalt(u: unknown): string | null {
  return typeof u === "string" && u.length >= 8 ? u : null;
}

export { str, isDateKey };
