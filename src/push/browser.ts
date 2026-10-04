/**
 * 本物のブラウザ API を PushDeps に詰める。
 *
 * dev ビルドで通知の模擬（dev パネルの `通知:`）が選ばれていれば、そちらを返す。
 * dev サーバには Service Worker も /api/push も無いので、模擬を通さないと
 * 設定画面の各状態を一度も見られない。
 */

import { clearPushRecord, loadPushRecord, savePushRecord } from "@/data/push";
import { fakePush, fakePushDeps } from "@/dev/fakePush";
import { detectPlatform, isStandalone } from "@/pwa/installPrompt";
import type { PushDeps, PushSupport, RegistrationLike } from "./client";

/** sw-push.js が応答するまでの待ち時間。応答が無ければ古い SW とみなす。 */
const PING_TIMEOUT_MS = 1500;

/** public/sw-push.js と同じ文字列。 */
const PING = "noren:push-ping";

function vapidKey(): string | null {
  const key = import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined;
  return key && key.length > 0 ? key : null;
}

function support(): PushSupport {
  // iOS はホーム画面から開いたときにしか PushManager が出てこない
  if (detectPlatform() === "ios" && !isStandalone()) return "needs-install";
  const ok =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  return ok ? "available" : "unsupported";
}

/** 起動時に registration を取っておく。クリック後に await すると iOS で操作の文脈が切れうる。 */
function watchRegistration(): () => RegistrationLike | null {
  let reg: ServiceWorkerRegistration | null = null;
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => {
        reg ??= r ?? null;
      })
      .catch(() => {});
    // 初めて開いた端末では、SW の有効化が起動より後になる
    void navigator.serviceWorker.ready.then((r) => {
      reg = r;
    });
  }
  return () => reg;
}

function ping(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    void navigator.serviceWorker.ready
      .then((r) => {
        const worker = r.active;
        if (!worker) return;
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => {
          clearTimeout(timer);
          resolve((e.data as { type?: unknown } | null)?.type === PING);
        };
        worker.postMessage({ type: PING }, [ch.port2]);
      })
      .catch(() => {});
  });
}

export function browserPushDeps(now: () => number): PushDeps {
  if (import.meta.env.DEV && fakePush() !== "real") return fakePushDeps(fakePush(), now);

  const registration = watchRegistration();
  return {
    vapidKey: vapidKey(),
    support,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration,
    workerReady: ping,
    fetch: (url, init) => fetch(url, init),
    now,
    store: { load: loadPushRecord, save: savePushRecord, clear: clearPushRecord },
    // dev のみ: サーバーの計算した送信時刻を出す。閉店画面の「次に開くのは」と一致するはず
    ...(import.meta.env.DEV
      ? {
          onServerTime: (t: number) =>
            console.info(`[push] サーバーの次の送信時刻 ${new Date(t).toISOString()}`),
        }
      : {}),
  };
}
