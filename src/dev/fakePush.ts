/**
 * 通知の模擬。**dev ビルドでのみ効く。**
 *
 * dev サーバには Service Worker も /api/push も無い（Pages Functions が動かない）ので、
 * 本物の経路では設定画面の「通知」が一度も出てこない。ここで各状態を作る。
 * 模擬でもサーバーには一切通信しない。
 */

import { clearPushRecord, loadPushRecord, savePushRecord } from "@/data/push";
import type { PushDeps, RegistrationLike, SubscriptionLike } from "@/push/client";

const KEY = "noren:debug:push";

export type FakePush =
  /** 本物のブラウザ API を使う。 */
  | "real"
  /** Push API の無いブラウザ。 */
  | "unsupported"
  /** iOS でホーム画面から開いていない。 */
  | "needs-install"
  /** 許可ダイアログで拒否される。 */
  | "deny"
  /** 許可され、登録に成功する。 */
  | "ok";

const ORDER: readonly FakePush[] = ["real", "unsupported", "needs-install", "deny", "ok"];

export const FAKE_PUSH_LABEL: Record<FakePush, string> = {
  real: "実機",
  unsupported: "未対応",
  "needs-install": "要追加",
  deny: "拒否",
  ok: "成功",
};

export function fakePush(): FakePush {
  if (!import.meta.env.DEV) return "real";
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.find((o) => o === v) ?? "real";
  } catch {
    return "real";
  }
}

export function cycleFakePush(): FakePush {
  const next = ORDER[(ORDER.indexOf(fakePush()) + 1) % ORDER.length]!;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 保存できなくてもこのセッション中は効かないだけ
  }
  return next;
}

export function fakePushDeps(mode: FakePush, now: () => number): PushDeps {
  let permission: NotificationPermission = "default";
  let sub: SubscriptionLike | null = null;

  const makeSub = (): SubscriptionLike => {
    const s: SubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/dev-fake",
      toJSON: () => ({ endpoint: s.endpoint, keys: { p256dh: "BDevFake", auth: "devFake" } }),
      unsubscribe: async () => {
        sub = null;
        return true;
      },
    };
    return s;
  };

  // 以前「成功」で控えを書いていれば、購読も残っていることにする
  if (mode === "ok" && loadPushRecord()) {
    permission = "granted";
    sub = makeSub();
  }

  const reg: RegistrationLike = {
    pushManager: {
      getSubscription: async () => sub,
      subscribe: async () => (sub = makeSub()),
    },
    getNotifications: async () => [],
  };

  return {
    vapidKey: "dev-fake",
    support: () =>
      mode === "unsupported"
        ? "unsupported"
        : mode === "needs-install"
          ? "needs-install"
          : "available",
    permission: () => permission,
    requestPermission: () => {
      permission = mode === "deny" ? "denied" : "granted";
      // 許可ダイアログの間を模す
      return new Promise((r) => setTimeout(() => r(permission), 400));
    },
    registration: () => reg,
    workerReady: async () => true,
    // サーバーには行かない。受け付けたことにして、端末側の計算だけで返す
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    now,
    store: { load: loadPushRecord, save: savePushRecord, clear: clearPushRecord },
    onServerTime: () => {},
  };
}
