/**
 * 通知（Web Push）の約束ごと。文言・API の形・入力の検証。
 *
 * ⚠ フロント（src/）・Pages Functions（functions/）・Worker（worker/）の全部から読まれる。
 *    window / document / localStorage / process に触らないこと。
 *
 * サーバーに送るのは **購読情報・salt・時間帯だけ**。記録・チケット・モードは送らない
 * （CLAUDE.md 約束1）。この型に項目を足すときは、それが学習データでないことを確かめること。
 */

import { isValidWindow, type TimeWindow } from "./window";
import type { PendingWindow } from "./schedule";

// ---------------------------------------------------------------- 文言

/**
 * 通知の見出しと本文。**問題は含めない。** 中身を見るには開く必要がある。
 *
 * push には中身を載せないので、実際に表示するのは public/sw-push.js が持つ同じ文字列。
 * 両方が一致していることは tests/push/sw.test.ts が確かめる。
 */
export const NOTIFY_TITLE = "のれん";
export const NOTIFY_BODY = "開きました（残り5分）";
/** 同じ tag の通知は置き換わる。開いたらアプリ側でこの tag の通知を消す。 */
export const NOTIFY_TAG = "noren-open";
/** プッシュサービス側で未配達のものを置き換えるための topic（32文字以内）。 */
export const PUSH_TOPIC = "noren-open";

// ---------------------------------------------------------------- API

export const PUSH_API = "/api/push/subscription";

/** 本文の上限。購読1件ぶんなら 1KB に満たない。 */
export const MAX_REQUEST_BYTES = 4096;

export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** PUT /api/push/subscription */
export interface SubscribeRequest {
  subscription: { endpoint: string; keys: PushKeys };
  salt: string;
  window: TimeWindow;
  pending: PendingWindow | null;
}

/** DELETE /api/push/subscription。auth が一致しないと消さない。 */
export interface UnsubscribeRequest {
  endpoint: string;
  auth: string;
}

export interface SubscribeResponse {
  /** サーバーが計算した次の送信時刻（epoch ms）。端末側の計算と一致するはず。 */
  nextOpenAt: number;
}

// ---------------------------------------------------------------- 宛先の制限

/**
 * 受け付けるプッシュサービス。
 *
 * 任意の URL を受けると、Worker が毎日どこにでも POST する踏み台になる。
 * 先頭が "." のものは「そのドメインのサブドメイン」を意味する。
 */
export const PUSH_HOSTS: readonly string[] = [
  "fcm.googleapis.com", // Chrome / Android / Edge(一部)
  ".push.apple.com", // Safari / iOS
  ".push.services.mozilla.com", // Firefox
  ".notify.windows.com", // Edge
];

export function isAllowedEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return false;
  }
  const host = url.hostname;
  return PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

// ---------------------------------------------------------------- 検証

const isObj = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const B64URL = /^[A-Za-z0-9_-]+$/;
const isKey = (u: unknown, max: number): u is string =>
  typeof u === "string" && u.length > 0 && u.length <= max && B64URL.test(u);

const isDateKey = (u: unknown): u is string =>
  typeof u === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u);

/** 端末側と同じ条件（src/data/schema.ts の parseSalt）に上限を足したもの。 */
export const isPushSalt = (u: unknown): u is string =>
  typeof u === "string" && u.length >= 8 && u.length <= 64;

function parseWindow(u: unknown): TimeWindow | null {
  if (!isObj(u)) return null;
  const w = { start: u["start"], end: u["end"] };
  if (typeof w.start !== "number" || typeof w.end !== "number") return null;
  const win = { start: w.start, end: w.end };
  return isValidWindow(win) ? win : null;
}

/** 壊れた入力は丸ごと null。部分的に受け取って既定値で埋めることはしない。 */
export function parseSubscribeRequest(u: unknown): SubscribeRequest | null {
  if (!isObj(u)) return null;

  const sub = u["subscription"];
  if (!isObj(sub)) return null;
  const endpoint = sub["endpoint"];
  if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) return null;
  const keys = sub["keys"];
  if (!isObj(keys) || !isKey(keys["p256dh"], 128) || !isKey(keys["auth"], 64)) return null;

  const salt = u["salt"];
  if (!isPushSalt(salt)) return null;

  // ローカル変数を window と名付けると guard.test.ts のグローバル参照検査に掛かる
  const win = parseWindow(u["window"]);
  if (!win) return null;

  let pending: PendingWindow | null = null;
  const p = u["pending"];
  if (p !== null && p !== undefined) {
    if (!isObj(p)) return null;
    const pw = parseWindow(p["window"]);
    const from = p["effectiveFrom"];
    if (!pw || !isDateKey(from)) return null;
    pending = { window: pw, effectiveFrom: from };
  }

  return {
    subscription: { endpoint, keys: { p256dh: keys["p256dh"], auth: keys["auth"] } },
    salt,
    window: win,
    pending,
  };
}

export function parseUnsubscribeRequest(u: unknown): UnsubscribeRequest | null {
  if (!isObj(u)) return null;
  const endpoint = u["endpoint"];
  const auth = u["auth"];
  if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) return null;
  if (!isKey(auth, 64)) return null;
  return { endpoint, auth };
}
