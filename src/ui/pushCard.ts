/**
 * 「通知」のカード。設定画面と初回の案内画面で同じものを使う。
 *
 * 色や形は既存の btn だけ。押せるものは藍（btn）で、状態を色で塗り分けない。
 * 文言は「何を預けるか」を正直に書く。学習の記録は送らない。
 */

import type { AppState } from "@/app/machine";
import type { Dispatch } from "@/app/store";
import type { PushStatus } from "@/push/client";
import { listen, qs, setText, show } from "./dom";

const HINT: Record<PushStatus, string> = {
  hidden: "",
  unsupported:
    "このブラウザは通知に対応していません。時刻になったらアプリを開いてください。",
  "needs-install": "iPhone では、ホーム画面に追加したアプリからだけ通知を受け取れます。",
  denied:
    "通知が許可されていません。端末の設定でこのアプリの通知を許可すると使えます。",
  reopen: "アプリを一度閉じて開き直すと、通知を使えるようになります。",
  off:
    "開いた瞬間に「開きました（残り5分）」とだけ届きます。" +
    "オンにすると、開く時刻の計算に必要な値（時間帯と乱数の種）だけをサーバーに預けます。" +
    "学習の記録は送りません。",
  on: "開いた瞬間にお知らせします。止めると、預けた値はサーバーから消します。",
  busy: "設定しています…",
  error: "通知の登録に失敗しました。通信できる場所でもう一度お試しください。",
};

/** 押せるボタンの文言。null なら出さない。 */
function toggleLabel(status: PushStatus): string | null {
  switch (status) {
    case "off":
    case "error":
      return "開いたら通知する";
    case "on":
      return "通知を止める";
    case "busy":
      return "設定しています";
    default:
      return null;
  }
}

export interface PushCardOptions {
  /** この状態のときだけカードを出す。 */
  visible(status: PushStatus): boolean;
  /** 「追加のしかた」を押したとき。無ければそのボタンは出さない。 */
  onInstallGuide?: () => void;
}

export function createPushCard(
  root: ParentNode,
  dispatch: Dispatch,
  opts: PushCardOptions,
) {
  const card = qs<HTMLElement>(root, "[data-push]");
  const toggle = qs<HTMLButtonElement>(root, "[data-push-toggle]");
  const guide = qs<HTMLButtonElement>(root, "[data-push-guide]");
  const hint = qs(root, "[data-push-hint]");

  let status: PushStatus = "hidden";

  // dispatch はクリックの中で同期に呼ぶ。許可ダイアログはこの文脈でしか出ない（iOS）
  const offToggle = listen(toggle, "click", () => {
    if (status === "on") dispatch({ type: "PUSH_DISABLE_REQUESTED" });
    else dispatch({ type: "PUSH_ENABLE_REQUESTED" });
  });
  const offGuide = listen(guide, "click", () => opts.onInstallGuide?.());

  return {
    update(s: AppState) {
      status = s.push.status;
      show(card, opts.visible(status));

      const label = toggleLabel(status);
      show(toggle, label !== null);
      if (label) setText(toggle, label);
      toggle.disabled = status === "busy";

      show(guide, status === "needs-install" && opts.onInstallGuide !== undefined);
      setText(hint, HINT[status]);
    },
    destroy() {
      offToggle();
      offGuide();
    },
  };
}
