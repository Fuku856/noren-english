/**
 * 書き出し / 読み込み。
 *
 * 記録は端末の中にしか無い。iOS Safari は7日アクセスが無いサイトの localStorage を
 * 消すので、**書き出したファイルが唯一の控え**になる。
 * バックアップであると同時に「自分のデータは自分のもの」という思想の表明でもある。
 *
 * salt も一緒に運ぶ。salt が変わると開店時刻が変わってしまい、
 * 復元したのに「昨日までと違う時間に開く」ことになるため。
 */

import {
  parseMilestones,
  parseRecords,
  parseSalt,
  parseSettings,
  parseTickets,
  type DayRecord,
  type Milestones,
  type Settings,
  type Tickets,
} from "./schema";
import { KEYS, writeJson, writeRaw } from "./storage";

export const BACKUP_VERSION = 1;

export interface Backup {
  app: "noren";
  version: number;
  /** 書き出した時刻（ISO 8601）。復元の判断材料として人が読むためだけのもの。 */
  exportedAt: string;
  salt: string;
  settings: Settings;
  records: DayRecord[];
  tickets: Tickets;
  milestones: Milestones;
}

export interface BackupInput {
  nowMs: number;
  salt: string;
  settings: Settings;
  records: DayRecord[];
  tickets: Tickets;
  milestones: Milestones;
}

export function buildBackup(i: BackupInput): Backup {
  return {
    app: "noren",
    version: BACKUP_VERSION,
    exportedAt: new Date(i.nowMs).toISOString(),
    salt: i.salt,
    settings: i.settings,
    records: i.records,
    tickets: i.tickets,
    milestones: i.milestones,
  };
}

/**
 * 読み込んだ JSON の検証。
 *
 * 他のアプリのファイルを掴まされて記録が消えるのが最悪なので、
 * `app` の印が無いものは受け取らない。中身の各項目は既存の検証器を通すので、
 * 一部が壊れていても残りは復元できる。
 */
export function parseBackup(u: unknown): Backup | null {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return null;
  const o = u as Record<string, unknown>;
  if (o["app"] !== "noren") return null;

  const version = typeof o["version"] === "number" ? o["version"] : 0;
  if (version < 1 || version > BACKUP_VERSION) return null;

  const salt = parseSalt(o["salt"]);
  if (!salt) return null;

  return {
    app: "noren",
    version: BACKUP_VERSION,
    exportedAt: typeof o["exportedAt"] === "string" ? o["exportedAt"] : "",
    salt,
    settings: parseSettings(o["settings"]),
    records: parseRecords(o["records"]),
    tickets: parseTickets(o["tickets"]),
    milestones: parseMilestones(o["milestones"]),
  };
}

/** 復元して端末に書き込む。呼ぶ前に必ず利用者へ確認すること（上書きになる）。 */
export function applyBackup(b: Backup): void {
  writeRaw(KEYS.salt, b.salt);
  writeJson(KEYS.settings, b.settings);
  writeJson(KEYS.records, b.records);
  writeJson(KEYS.tickets, b.tickets);
  writeJson(KEYS.milestones, b.milestones);
}

/** 「のれん-2026-08-18.json」。日付が入っていないと控えが並んだとき見分けられない。 */
export function backupFilename(dateKey: string): string {
  return `noren-${dateKey}.json`;
}

/** 復元の確認文。何日ぶんの記録で上書きするのかを見せてから聞く。 */
export function backupSummary(b: Backup): string {
  const solved = b.records.filter((r) => r.solved).length;
  const day = b.exportedAt ? b.exportedAt.slice(0, 10) : "不明";
  return `${day} に書き出された記録（${b.records.length}日ぶん・解いた日 ${solved}日）`;
}
