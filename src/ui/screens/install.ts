/**
 * ホーム画面追加の案内。
 *
 * バナーではなく初回フローの一部として1画面を使う。
 * 記録が0の初日に促すのが肝で、データが溜まってから追加すると
 * iOS では別のストレージ領域になって記録が引き継がれない場合がある。
 */

import type { AppState } from "@/app/machine";
import type { ScreenModule } from "../render";
import { createPushCard } from "../pushCard";
import { disposer, listen, qs, show, tmpl } from "../dom";
import {
  canPromptInstall,
  detectPlatform,
  isStandalone,
  promptInstall,
} from "@/pwa/installPrompt";

/** その場で通知を使える状態。iOS の Safari で案内を見ている段階では出さない。 */
const PUSH_USABLE_NOW = new Set<AppState["push"]["status"]>(["off", "on", "busy", "error", "denied"]);

export const installScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-install");
  const bag = disposer();

  const platform = detectPlatform();
  show(qs(frag, "[data-ios]"), platform === "ios");
  show(qs(frag, "[data-android]"), platform === "android");
  show(qs(frag, "[data-desktop]"), platform === "desktop" && !canPromptInstall());

  const installBtn = qs<HTMLButtonElement>(frag, "[data-install]");
  show(installBtn, canPromptInstall());
  bag.add(
    listen(installBtn, "click", () => {
      void promptInstall().then((accepted) => {
        if (accepted) dispatch({ type: "INSTALL_ACKNOWLEDGED" });
      });
    }),
  );

  const skip = qs<HTMLButtonElement>(frag, "[data-skip]");
  // 既にホーム画面から開いているなら、案内ではなく確認で済む
  if (isStandalone()) skip.textContent = "はじめる";
  bag.add(
    listen(skip, "click", () => dispatch({ type: "INSTALL_ACKNOWLEDGED" })),
  );

  const pushCard = createPushCard(frag, dispatch, {
    visible: (status) => PUSH_USABLE_NOW.has(status),
  });

  root.append(frag);
  pushCard.update(state);

  return {
    update: (s) => pushCard.update(s),
    destroy() {
      bag.dispose();
      pushCard.destroy();
    },
  };
};
