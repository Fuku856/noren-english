/**
 * ホーム画面追加の判定と導線。
 *
 * これは飾りではない。iOS の Safari は7日間アクセスがないサイトの localStorage を
 * 消すので、追加してもらえないと30日の継続そのものが成立しない。
 * だから Phase 1 で作る。Phase 4 で気づくと手戻りが大きい。
 *
 * iOS には beforeinstallprompt が無いので、共有→ホーム画面に追加 を図解するしかない。
 */

export type Platform = "ios" | "android" | "desktop";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

/** main.ts の最初で1度だけ呼ぶ。イベントは早く飛んでくるので登録も早く。 */
export function watchInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
  });
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS は Mac を名乗るので、タッチ有無で見分ける
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** ホーム画面から起動しているか。iOS の Web Push はこれが true でないと使えない。 */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

/** ブラウザ側のインストール導線が使えるか（Android / デスクトップ Chrome）。 */
export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** ネイティブのインストールダイアログを出す。使えなければ false。 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}
