// @ts-check
/**
 * 通知の受け口。vite-plugin-pwa が生成する Service Worker に importScripts で読ませる
 * （vite.config.ts の workbox.importScripts）。生成される SW 本体には手を入れない。
 *
 * push には中身が無い。文言はここが持つ。**問題は含めない。**
 * 文言は shared/push.ts の NOTIFY_* と同じであること（tests/push/sw.test.ts が確かめる）。
 */

/** @type {ServiceWorkerGlobalScope} */
// @ts-ignore -- この文脈の self は ServiceWorkerGlobalScope
const sw = self;

const NOTIFY_TITLE = "のれん";
const NOTIFY_BODY = "開きました（残り5分）";
const NOTIFY_TAG = "noren-open";
const PING = "noren:push-ping";

/*
 * 毎回必ず通知を出す。出さない分岐を作らないこと。
 * Safari は通知を出さない push が続くと、許可ごと取り消す。
 */
sw.addEventListener("push", (event) => {
  event.waitUntil(
    sw.registration.showNotification(NOTIFY_TITLE, {
      body: NOTIFY_BODY,
      tag: NOTIFY_TAG,
      icon: "/icons/icon-192.png",
      lang: "ja",
      data: { url: "/" },
    }),
  );
});

/*
 * 開いているウィンドウがあれば前に出し、無ければ開く。
 * 開いた後はアプリ側の focus / visibilitychange → TICK が今までどおり開店させるので、
 * ここから状態には触らない。
 */
sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const wins = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = wins.find((c) => new URL(c.url).origin === sw.location.origin);
      if (mine) {
        await mine.focus();
        return;
      }
      await sw.clients.openWindow("/");
    })(),
  );
});

/*
 * 「この SW は通知を扱えるか」の問い合わせに答える（src/push/browser.ts）。
 * 古い SW のまま購読すると、届いた push を誰も表示できない。
 */
sw.addEventListener("message", (event) => {
  const data = /** @type {{ type?: unknown } | null} */ (event.data);
  if (data?.type === PING) event.ports[0]?.postMessage({ type: PING });
});
