/**
 * 通知の購読・解除・同期。**`/api/push` に通信するのはこのファイルだけ。**
 *
 * 約束（CLAUDE.md 1・7）:
 *   - 利用者が「開いたら通知する」を押すまで、サーバーには一度も通信しない
 *   - 送るのは購読情報・salt・時間帯だけ（shared/push.ts の SubscribeRequest）
 *   - 通知が使えなくても、失敗しても、アプリ本体は何も変わらない
 *
 * ブラウザの API は PushDeps として外から渡す（src/push/browser.ts）。
 * テストと dev の模擬（src/dev/fakePush.ts）が同じ経路を通れるようにするため。
 */

import {
  NOTIFY_TAG,
  PUSH_API,
  type SubscribeRequest,
  type SubscribeResponse,
  type UnsubscribeRequest,
} from "@shared/push";
import type { Schedule } from "@shared/schedule";
import { needsResync, pushFingerprint, type PushRecord } from "@/data/push";

export type PushStatus =
  /** 公開鍵の無いビルド。通知の UI ごと出さない。 */
  | "hidden"
  /** Push API が無いブラウザ。 */
  | "unsupported"
  /** iOS でホーム画面から開いていない（iOS はホーム画面のアプリでしか購読できない）。 */
  | "needs-install"
  /** 通知が拒否されている。 */
  | "denied"
  /** Service Worker がまだ古い。開き直すと使える。 */
  | "reopen"
  | "off"
  | "on"
  /** 登録・解除の途中。 */
  | "busy"
  /** 登録できなかった。 */
  | "error";

export type PushSupport = "unsupported" | "needs-install" | "available";

// ---------------------------------------------------------------- ブラウザ API のうち使う分

export interface SubscriptionLike {
  readonly endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface RegistrationLike {
  pushManager: {
    getSubscription(): Promise<SubscriptionLike | null>;
    subscribe(o: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array<ArrayBuffer>;
    }): Promise<SubscriptionLike>;
  };
  getNotifications?(o: { tag: string }): Promise<Array<{ close(): void }>>;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface PushDeps {
  /** VAPID 公開鍵（base64url）。無ければ通知の UI を出さない。 */
  vapidKey: string | null;
  support(): PushSupport;
  permission(): NotificationPermission;
  /** **クリックの同期区間で呼ばれる。** 中で await を挟まないこと。 */
  requestPermission(): Promise<NotificationPermission>;
  /** 起動時に取っておいた registration。クリック後に await すると操作の文脈が切れうる。 */
  registration(): RegistrationLike | null;
  /** Service Worker が sw-push.js を読み込み済みか（postMessage の応答で確かめる）。 */
  workerReady(): Promise<boolean>;
  fetch(url: string, init: RequestInit): Promise<FetchResult>;
  now(): number;
  store: {
    load(): PushRecord | null;
    save(r: PushRecord): void;
    clear(): void;
  };
  /** dev のみ: サーバーが返した次の送信時刻を見せる。 */
  onServerTime?(nextOpenAt: number): void;
}

export interface PushClient {
  /** 起動時。状態を調べ、オンなら同期する。 */
  start(s: Schedule): Promise<PushStatus>;
  /** 「開いたら通知する」。**クリックの同期区間で呼ぶこと。** */
  enable(s: Schedule): Promise<PushStatus>;
  disable(): Promise<PushStatus>;
  /** 時間帯や salt が変わったら呼ぶ。変化が無ければ通信しない。 */
  sync(s: Schedule): Promise<PushStatus>;
  /** 開いたら、残っている「開きました」を消す。 */
  clearNotifications(): void;
}

const TIMEOUT_MS = 5000;

function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function keysOf(sub: SubscriptionLike): { p256dh: string; auth: string } | null {
  const keys = sub.toJSON().keys;
  const p256dh = keys?.["p256dh"];
  const auth = keys?.["auth"];
  return p256dh && auth ? { p256dh, auth } : null;
}

export function createPushClient(d: PushDeps): PushClient {
  let workerReady = false;

  /** サーバーに預ける。成功したら控えを書く。失敗しても控えは触らない（次の起動でやり直す）。 */
  async function put(sub: SubscriptionLike, s: Schedule): Promise<boolean> {
    const keys = keysOf(sub);
    if (!keys) return false;
    const body: SubscribeRequest = {
      subscription: { endpoint: sub.endpoint, keys },
      salt: s.salt,
      window: s.window,
      pending: s.pending,
    };
    try {
      const res = await d.fetch(PUSH_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as Partial<SubscribeResponse>;
      if (typeof json.nextOpenAt === "number") d.onServerTime?.(json.nextOpenAt);
    } catch {
      return false;
    }
    d.store.save({
      endpoint: sub.endpoint,
      synced: pushFingerprint(sub.endpoint, s.salt, s),
      syncedAtMs: d.now(),
    });
    return true;
  }

  async function sync(s: Schedule): Promise<PushStatus> {
    const record = d.store.load();
    const reg = d.registration();
    if (!reg) return record ? "on" : "off";

    let sub: SubscriptionLike | null = null;
    try {
      sub = await reg.pushManager.getSubscription();
    } catch {
      return record ? "on" : "off";
    }

    if (!record) {
      /*
       * 控えが無いのにブラウザ側の購読だけ残っている（記録を消した・読み込み直したなど）。
       * 利用者がいまオンにしたいのか分からないので、**サーバーには送らずブラウザ側だけ解除する。**
       * サーバーの行は、次の送信でプッシュサービスが 410 を返して消える。
       */
      if (sub) await sub.unsubscribe().catch(() => false);
      return "off";
    }

    if (d.permission() === "denied" || !sub) {
      d.store.clear();
      return d.permission() === "denied" ? "denied" : "off";
    }

    const fp = pushFingerprint(sub.endpoint, s.salt, s);
    if (sub.endpoint !== record.endpoint || needsResync(record, fp, d.now())) {
      await put(sub, s);
    }
    return "on";
  }

  return {
    async start(s) {
      if (!d.vapidKey) return "hidden";
      const support = d.support();
      if (support !== "available") return support;
      if (d.permission() === "denied") {
        d.store.clear();
        return "denied";
      }
      workerReady = await d.workerReady().catch(() => false);
      if (!workerReady) return d.store.load() ? "on" : "reopen";
      return sync(s);
    },

    enable(s) {
      const reg = d.registration();
      const key = d.vapidKey;
      if (!key || !reg || !workerReady) return Promise.resolve<PushStatus>("reopen");

      // ここまで await を挟んでいない。iOS はユーザー操作の直後でないと許可ダイアログを出さない
      let asked: Promise<NotificationPermission>;
      try {
        asked = d.requestPermission();
      } catch {
        return Promise.resolve<PushStatus>("error");
      }

      return asked
        .then(async (perm): Promise<PushStatus> => {
          if (perm === "denied") return "denied";
          if (perm !== "granted") return "off"; // ダイアログを閉じただけ

          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64urlToBytes(key),
          });
          if (await put(sub, s)) return "on";

          // 預けられなかった。ブラウザ側だけ購読が残ると次の起動で迷うので、揃えて外す
          await sub.unsubscribe().catch(() => false);
          return "error";
        })
        .catch((): PushStatus => "error");
    },

    async disable() {
      d.store.clear();
      const reg = d.registration();
      const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      if (!sub) return "off";

      const keys = keysOf(sub);
      // ブラウザ側を先に外す。サーバーへの削除は失敗してもよい（行は 410 で消える）
      await sub.unsubscribe().catch(() => false);
      if (keys) {
        const body: UnsubscribeRequest = { endpoint: sub.endpoint, auth: keys.auth };
        await d
          .fetch(PUSH_API, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          .catch(() => null);
      }
      return "off";
    },

    sync,

    clearNotifications() {
      const reg = d.registration();
      if (!reg?.getNotifications) return;
      void reg
        .getNotifications({ tag: NOTIFY_TAG })
        .then((ns) => {
          for (const n of ns) n.close();
        })
        .catch(() => {});
    },
  };
}
