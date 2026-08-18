/**
 * 学習記録。
 *
 * ここに溜まるものがこのアプリの全財産で、サーバーには送らない。
 * だから書き出し（transfer.ts）とホーム画面追加の導線が生命線になる。
 */

import { addDays, daysBetween } from "@shared/dateKey";
import { parseRecords, type DayRecord, type Mode, type SessionSource } from "./schema";
import { KEYS, readJson, writeJson } from "./storage";

/** 記録の保持上限。1日1件なので5年分。溢れたら古い方から捨てる。 */
const MAX_RECORDS = 1830;

export function loadRecords(): DayRecord[] {
  return readJson(KEYS.records, parseRecords);
}

export function saveRecords(records: DayRecord[]): void {
  const trimmed =
    records.length > MAX_RECORDS ? records.slice(records.length - MAX_RECORDS) : records;
  writeJson(KEYS.records, trimmed);
}

export function findRecord(records: DayRecord[], dateKey: string): DayRecord | null {
  return records.find((r) => r.date === dateKey) ?? null;
}

/** 同じ日の記録は1件だけ。既にあれば置き換え、無ければ日付順に挿入する。 */
export function upsertRecord(records: DayRecord[], next: DayRecord): DayRecord[] {
  const out = records.filter((r) => r.date !== next.date);
  out.push(next);
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface NewRecordInput {
  date: string;
  sentenceId: number;
  mode: Mode;
  source: SessionSource;
  kind?: DayRecord["kind"];
  clockAnomaly?: boolean;
}

/** 開店した瞬間の記録。まだ解いていない。 */
export function openedRecord(i: NewRecordInput): DayRecord {
  return {
    date: i.date,
    opened: true,
    solved: false,
    accuracy: null,
    sentenceId: i.sentenceId,
    mode: i.mode,
    source: i.source,
    kind: i.kind ?? "normal",
    clockAnomaly: i.clockAnomaly ?? false,
  };
}

/** 解答した記録。 */
export function solvedRecord(base: DayRecord, accuracy: number, mode: Mode): DayRecord {
  return { ...base, solved: true, accuracy, mode };
}

// ---------------------------------------------------------------- 集計

/** 参加日数。**連続日数ではない**（連続日数はどこにも表示しない）。 */
export function participationDays(records: DayRecord[]): number {
  return records.filter((r) => r.solved).length;
}

/** その週（月曜起点）の記録を日付キー→記録で引けるようにする。 */
export function weekMap(records: DayRecord[], weekStart: string): Map<string, DayRecord> {
  const out = new Map<string, DayRecord>();
  for (let i = 0; i < 7; i++) {
    const key = addDays(weekStart, i);
    const r = findRecord(records, key);
    if (r) out.set(key, r);
  }
  return out;
}

/** n 日前の記録。14日目の抜き打ち再出題に使う。 */
export function recordDaysAgo(
  records: DayRecord[],
  todayKey: string,
  n: number,
): DayRecord | null {
  return findRecord(records, addDays(todayKey, -n));
}

/** 直近 n 日ぶんの一致率。21日目のグラフに使う。未解答の日は含めない。 */
export function accuracySeries(
  records: DayRecord[],
  todayKey: string,
  days: number,
): Array<{ date: string; accuracy: number }> {
  return records
    .filter((r) => r.solved && r.accuracy !== null)
    .filter((r) => {
      const diff = daysBetween(todayKey, r.date);
      return diff >= 0 && diff < days;
    })
    .map((r) => ({ date: r.date, accuracy: r.accuracy as number }));
}
