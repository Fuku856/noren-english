/**
 * 画面の差し替え。
 *
 * 仮想DOMも差分エンジンも作らない。画面が変わったら destroy → mount、
 * 変わらなければ update を呼ぶだけ。各画面は mount 時に要素参照を1度取り、
 * update では textContent / classList / dataset だけを書く。
 */

import type { AppState } from "@/app/machine";
import type { Dispatch } from "@/app/store";

export interface ScreenHandle {
  update(s: AppState): void;
  destroy(): void;
}

export type ScreenModule = (
  root: HTMLElement,
  s: AppState,
  dispatch: Dispatch,
) => ScreenHandle;

export interface RendererDeps {
  screens: Partial<Record<AppState["screen"], ScreenModule>>;
  dispatch: Dispatch;
}

export function createRenderer(
  root: HTMLElement,
  deps: RendererDeps,
): (s: AppState) => void {
  let current: AppState["screen"] | null = null;
  let handle: ScreenHandle | null = null;
  let banner: HTMLElement | null = null;

  const syncBanner = (s: AppState) => {
    /*
     * メンテナンス画面にだけは出さない。
     *
     * あの1枚は のれん の意匠を全部外して「営業していない」だけを伝える。
     * 記録が残らないという別の話を朱の帯で載せても行き場がないうえ、
     * #app の padding を 0 にしてある画面なので帯が縁まで届いて壊れて見える。
     */
    const wanted = s.ephemeral && s.screen !== "maintenance";
    if (wanted && !banner) {
      banner = document.createElement("p");
      banner.className = "ephemeral-banner";
      banner.textContent =
        "この環境では記録が残りません。ブラウザの設定をご確認ください。";
      root.prepend(banner);
    } else if (!wanted && banner) {
      banner.remove();
      banner = null;
    }
  };

  return (s: AppState) => {
    if (s.screen !== current) {
      handle?.destroy();
      root.replaceChildren();
      banner = null;

      // 錆朱が解決するかどうかはここで決まる（tokens.css を参照）
      root.dataset["screen"] = s.screen;
      current = s.screen;

      const mod = deps.screens[s.screen];
      handle = mod ? mod(root, s, deps.dispatch) : null;
      syncBanner(s);
      return;
    }

    syncBanner(s);
    handle?.update(s);
  };
}
