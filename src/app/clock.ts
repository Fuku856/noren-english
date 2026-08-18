/**
 * アプリ内で唯一、実時刻に触ってよい場所。
 *
 * ここ以外で `Date.now()` や引数なし `new Date()` を書かないこと
 * （tests/guard.test.ts が grep して落とす）。
 *
 * 理由は単純で、1日1回・決まった時刻にしか開かないアプリは、
 * 時刻を注入できないとそもそもテストできない。開発中に開店を待っていられない。
 */

const OFFSET_KEY = "noren:debug:offsetMs";

let offsetMs = 0;

/** dev ビルドでのみ有効。`?t=2026-08-18T21:46:30+09:00` と localStorage のオフセットを読む。 */
export function initClock(): void {
  if (!import.meta.env.DEV) return;

  try {
    const stored = localStorage.getItem(OFFSET_KEY);
    if (stored) offsetMs = Number(stored) || 0;
  } catch {
    // ストレージが使えない環境。オフセットなしで続行する
  }

  const t = new URLSearchParams(location.search).get("t");
  if (t) {
    const target = Date.parse(t);
    if (!Number.isNaN(target)) setNow(target);
  }
}

/** 現在時刻。epoch ms。 */
export function now(): number {
  return Date.now() + offsetMs;
}

/** dev のみ: 指定時刻に飛ぶ。 */
export function setNow(targetMs: number): void {
  if (!import.meta.env.DEV) return;
  setOffset(targetMs - Date.now());
}

/** dev のみ: オフセットを直接指定する。 */
export function setOffset(ms: number): void {
  if (!import.meta.env.DEV) return;
  offsetMs = ms;
  try {
    localStorage.setItem(OFFSET_KEY, String(ms));
  } catch {
    // 保存できなくてもこのセッション中は効く
  }
}

/** dev のみ: 実時刻に戻す。 */
export function resetClock(): void {
  if (!import.meta.env.DEV) return;
  offsetMs = 0;
  try {
    localStorage.removeItem(OFFSET_KEY);
  } catch {
    // no-op
  }
}

export function getOffset(): number {
  return offsetMs;
}

/**
 * 1秒ごと、および画面が戻ってきた瞬間に `cb(now())` を呼ぶ。
 *
 * `visibilitychange` / `focus` / `pageshow` を拾うのが肝。
 * 端末がスリープしている間はタイマーが止まるので、復帰した瞬間に
 * 「実はもう時間切れだった」を検出できないと5分が伸びてしまう。
 */
export function startTicker(cb: (nowMs: number) => void): () => void {
  const fire = () => cb(now());

  const id = setInterval(fire, 1000);
  const onVisible = () => {
    if (document.visibilityState === "visible") fire();
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", fire);
  window.addEventListener("pageshow", fire);

  fire();

  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", fire);
    window.removeEventListener("pageshow", fire);
  };
}
