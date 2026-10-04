/**
 * 購読の保存（D1）と、購読 API の中身。サーバー側だけが使う。
 *
 * Pages Functions（購読の受け口）と Worker（毎分の送信）が同じ表を読み書きするので、
 * SQL と行の形はここ1か所に置く。どちらか片方だけ直すと、送信時刻がずれる。
 *
 * ⚠ shared/ なので window / document / localStorage / process に触らない。
 *    D1 の型はアプリ側の tsconfig に無いので、使う分だけを SqlDatabase として書いてある。
 *    時刻は必ず引数で受け取る。
 */

import { nextOpenInstant, type Schedule } from "./schedule";
import {
  MAX_REQUEST_BYTES,
  parseSubscribeRequest,
  parseUnsubscribeRequest,
  type SubscribeRequest,
  type SubscribeResponse,
} from "./push";

// ---------------------------------------------------------------- 行

/** worker/migrations/0001_push_subscriptions.sql と同じ形。 */
export interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  salt: string;
  notify_start: number;
  notify_end: number;
  pending_start: number | null;
  pending_end: number | null;
  pending_from: string | null;
  next_open_at: number;
  created_at: number;
  updated_at: number;
}

export function scheduleOfRow(r: SubscriptionRow): Schedule {
  const pending =
    r.pending_start !== null && r.pending_end !== null && r.pending_from !== null
      ? {
          window: { start: r.pending_start, end: r.pending_end },
          effectiveFrom: r.pending_from,
        }
      : null;
  return { salt: r.salt, window: { start: r.notify_start, end: r.notify_end }, pending };
}

export function rowFromRequest(
  req: SubscribeRequest,
  nextOpenAt: number,
  createdAt: number,
  nowMs: number,
): SubscriptionRow {
  return {
    endpoint: req.subscription.endpoint,
    p256dh: req.subscription.keys.p256dh,
    auth: req.subscription.keys.auth,
    salt: req.salt,
    notify_start: req.window.start,
    notify_end: req.window.end,
    pending_start: req.pending?.window.start ?? null,
    pending_end: req.pending?.window.end ?? null,
    pending_from: req.pending?.effectiveFrom ?? null,
    next_open_at: nextOpenAt,
    created_at: createdAt,
    updated_at: nowMs,
  };
}

// ---------------------------------------------------------------- 保存

export interface Advance {
  endpoint: string;
  /** 読んだときの next_open_at。これが変わっていたら（別の起動か PUT が先に触った）進めない。 */
  from: number;
  to: number;
}

export interface PushStore {
  find(endpoint: string): Promise<SubscriptionRow | null>;
  count(): Promise<number>;
  upsert(row: SubscriptionRow): Promise<void>;
  /** endpoint と auth の両方が一致したときだけ消す。 */
  remove(endpoint: string, auth: string): Promise<void>;
  /** プッシュサービスが 404 / 410 を返した宛先を消す。 */
  removeGone(endpoints: readonly string[]): Promise<void>;
  /** 送る時刻が来た行。古い順。 */
  due(nowMs: number, limit: number): Promise<SubscriptionRow[]>;
  /**
   * next_open_at を進める。**実際に進められた endpoint だけ**を返す。
   * 返ってきた行にだけ送れば、同じ分に2回起動しても2通目は出ない。
   */
  advance(list: readonly Advance[], nowMs: number): Promise<Set<string>>;
}

/** D1 のうち、ここで使う分だけ。 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<Array<{ meta: { changes: number } }>>;
}

const COLUMNS =
  "endpoint, p256dh, auth, salt, notify_start, notify_end, pending_start, pending_end, " +
  "pending_from, next_open_at, created_at, updated_at";

export function d1Store(db: SqlDatabase): PushStore {
  return {
    find: (endpoint) =>
      db
        .prepare(`SELECT ${COLUMNS} FROM push_subscriptions WHERE endpoint = ?`)
        .bind(endpoint)
        .first<SubscriptionRow>(),

    async count() {
      const r = await db
        .prepare("SELECT COUNT(*) AS n FROM push_subscriptions")
        .first<{ n: number }>();
      return r?.n ?? 0;
    },

    async upsert(r) {
      await db
        .prepare(
          `INSERT INTO push_subscriptions (${COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (endpoint) DO UPDATE SET
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             salt = excluded.salt,
             notify_start = excluded.notify_start,
             notify_end = excluded.notify_end,
             pending_start = excluded.pending_start,
             pending_end = excluded.pending_end,
             pending_from = excluded.pending_from,
             next_open_at = excluded.next_open_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          r.endpoint,
          r.p256dh,
          r.auth,
          r.salt,
          r.notify_start,
          r.notify_end,
          r.pending_start,
          r.pending_end,
          r.pending_from,
          r.next_open_at,
          r.created_at,
          r.updated_at,
        )
        .run();
    },

    async remove(endpoint, auth) {
      await db
        .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND auth = ?")
        .bind(endpoint, auth)
        .run();
    },

    async removeGone(endpoints) {
      if (endpoints.length === 0) return;
      await db.batch(
        endpoints.map((e) =>
          db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(e),
        ),
      );
    },

    async due(nowMs, limit) {
      const r = await db
        .prepare(
          `SELECT ${COLUMNS} FROM push_subscriptions
           WHERE next_open_at <= ? ORDER BY next_open_at LIMIT ?`,
        )
        .bind(nowMs, limit)
        .all<SubscriptionRow>();
      return r.results;
    },

    async advance(list, nowMs) {
      if (list.length === 0) return new Set();
      const results = await db.batch(
        list.map((a) =>
          db
            .prepare(
              `UPDATE push_subscriptions SET next_open_at = ?, updated_at = ?
               WHERE endpoint = ? AND next_open_at = ?`,
            )
            .bind(a.to, nowMs, a.endpoint, a.from),
        ),
      );
      const done = new Set<string>();
      results.forEach((r, i) => {
        if (r.meta.changes > 0) done.add(list[i]!.endpoint);
      });
      return done;
    },
  };
}

// ---------------------------------------------------------------- API の中身

export interface ApiResult {
  status: number;
  body: SubscribeResponse | { error: string } | null;
}

/**
 * 行数の上限の既定値。誰でも登録できる（アカウントが無い）ので、
 * 大量登録で D1 の書き込み枠（Free: 10万行/日）を食い潰されないようにする。
 */
export const DEFAULT_MAX_SUBSCRIPTIONS = 20_000;

const bad = (error: string, status = 400): ApiResult => ({ status, body: { error } });

/** 本文を読む。大きすぎるものや JSON でないものは null。 */
export function parseBody(text: string): unknown {
  // 文字数ではなくバイト数で見る（日本語の salt でも上限が効くように）
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** PUT /api/push/subscription */
export async function handleSubscribe(
  store: PushStore,
  raw: unknown,
  nowMs: number,
  maxSubscriptions = DEFAULT_MAX_SUBSCRIPTIONS,
): Promise<ApiResult> {
  const req = parseSubscribeRequest(raw);
  if (!req) return bad("invalid");

  const existing = await store.find(req.subscription.endpoint);
  if (existing) {
    // 宛先を知っているだけの第三者に salt や窓を書き換えさせない
    if (existing.auth !== req.subscription.keys.auth) return bad("forbidden", 403);
  } else if ((await store.count()) >= maxSubscriptions) {
    return bad("full", 503);
  }

  const nextOpenAt = await nextOpenInstant(
    { salt: req.salt, window: req.window, pending: req.pending },
    nowMs,
  );
  await store.upsert(rowFromRequest(req, nextOpenAt, existing?.created_at ?? nowMs, nowMs));
  return { status: 200, body: { nextOpenAt } };
}

/** DELETE /api/push/subscription。行の有無に関わらず 204（存在を漏らさない）。 */
export async function handleUnsubscribe(store: PushStore, raw: unknown): Promise<ApiResult> {
  const req = parseUnsubscribeRequest(raw);
  if (!req) return bad("invalid");
  await store.remove(req.endpoint, req.auth);
  return { status: 204, body: null };
}
