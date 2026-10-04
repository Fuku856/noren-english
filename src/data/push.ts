/**
 * 通知の購読を、この端末がどう登録したかの控え。
 *
 * **書き出し（バックアップ）には含めない。** 購読は端末ごとのもので、
 * 別の端末に持っていっても使えない。読み込み後は起動時の同期で salt の変化を拾う。
 */

import type { WindowPlan } from "@shared/schedule";
import { KEYS, readJson, removeRaw, writeJson } from "./storage";

export interface PushRecord {
  endpoint: string;
  /** 最後にサーバーへ送った内容の指紋。変わっていたら送り直す。 */
  synced: string;
  /** 最後にサーバーへ送った時刻。7日たったら変化が無くても送り直す（自己修復）。 */
  syncedAtMs: number;
}

/** 変化が無くても送り直すまでの間隔。サーバー側で行が消えていた場合に戻すため。 */
export const RESYNC_MS = 7 * 86_400_000;

export function parsePushRecord(u: unknown): PushRecord | null {
  if (typeof u !== "object" || u === null) return null;
  const o = u as Record<string, unknown>;
  const { endpoint, synced, syncedAtMs } = o;
  if (typeof endpoint !== "string" || typeof synced !== "string") return null;
  if (typeof syncedAtMs !== "number" || !Number.isFinite(syncedAtMs)) return null;
  return { endpoint, synced, syncedAtMs };
}

export function loadPushRecord(): PushRecord | null {
  return readJson(KEYS.push, parsePushRecord);
}

export function savePushRecord(r: PushRecord): void {
  writeJson(KEYS.push, r);
}

export function clearPushRecord(): void {
  removeRaw(KEYS.push);
}

/** サーバーに預けている内容の指紋。ここに並ぶ項目以外は送っていない。 */
export function pushFingerprint(endpoint: string, salt: string, plan: WindowPlan): string {
  return JSON.stringify({ endpoint, salt, window: plan.window, pending: plan.pending });
}

/** 送り直すべきか。 */
export function needsResync(r: PushRecord, fingerprint: string, nowMs: number): boolean {
  return r.synced !== fingerprint || nowMs - r.syncedAtMs >= RESYNC_MS;
}
