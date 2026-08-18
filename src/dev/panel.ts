/**
 * 開発用のパネル。**dev ビルドでのみ読み込まれる。**
 *
 * これはハックではなく必要な道具。1日1回・自分で決めた時間帯のランダムな時刻にしか
 * 開かないアプリを、実時刻のまま開発するのは不可能に近い。
 */

import { dateKeyOf } from "@shared/dateKey";
import { SESSION_MS } from "@shared/openTime";
import { getOffset, now, resetClock, setNow } from "@/app/clock";
import { clearAll } from "@/data/storage";
import type { Store } from "@/app/store";

export function installDevPanel(store: Store): void {
  const host = document.createElement("div");
  host.className = "devpanel";
  host.innerHTML = `
    <button data-open>開店時刻へ</button>
    <button data-expire>時間切れ</button>
    <button data-nextday>+1日</button>
    <button data-reset>実時刻に戻す</button>
    <button data-wipe>記録を消す</button>
    <span data-info></span>
  `;

  const info = host.querySelector("[data-info]")!;
  const refresh = () => {
    const s = store.getState();
    const off = Math.round(getOffset() / 60_000);
    info.textContent = `${dateKeyOf(s.nowMs)} ${new Date(s.nowMs).toISOString().slice(11, 19)}Z / 開店 ${
      s.openMinute ?? "?"
    } / ずれ ${off}分`;
  };

  const jump = (ms: number) => {
    setNow(ms);
    store.dispatch({ type: "TICK", nowMs: now() });
    refresh();
  };

  host.querySelector("[data-open]")!.addEventListener("click", () => {
    const at = store.getState().openAtMs;
    if (at !== null) jump(at + 500);
  });

  host.querySelector("[data-expire]")!.addEventListener("click", () => {
    const s = store.getState();
    jump((s.session?.endsAtMs ?? s.nowMs) + 1000);
  });

  host.querySelector("[data-nextday]")!.addEventListener("click", () => {
    jump(store.getState().nowMs + 86_400_000);
  });

  host.querySelector("[data-reset]")!.addEventListener("click", () => {
    resetClock();
    location.reload();
  });

  host.querySelector("[data-wipe]")!.addEventListener("click", () => {
    clearAll();
    resetClock();
    location.reload();
  });

  document.body.append(host);
  store.subscribe(refresh);
  refresh();

  // 5分の枠が短すぎて検証しづらいときのための目安をコンソールに出す
  console.info(`[dev] 1セッション = ${SESSION_MS / 60000}分。?t=ISO8601 で時刻を指定できます`);
}
