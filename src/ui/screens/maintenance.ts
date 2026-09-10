/**
 * メンテナンス中の画面。
 *
 * ここだけは のれんの意匠を外す。営業していないことを伝える1枚で、
 * 学習の文脈を匂わせても混乱させるだけ。
 * サーバ側が返す1枚（functions/_middleware.ts）と同じ見た目にしてある。
 */

import { MAINTENANCE_TITLE, MAINTENANCE_LINES } from "@shared/maintenance";
import type { ScreenModule } from "../render";
import { qs, setText, show, tmpl } from "../dom";

export const maintenanceScreen: ScreenModule = (root, state) => {
  const frag = tmpl("tpl-maintenance");
  const info = state.maintenance;

  setText(qs(frag, "[data-title]"), info?.title ?? MAINTENANCE_TITLE);
  setText(
    qs(frag, "[data-lines]"),
    (info?.lines ?? MAINTENANCE_LINES).join("\n"),
  );

  // 環境変数で与えられた追記。無ければ段落ごと出さない。
  // textContent で入れるので、任意のテキストが来てもマークアップにならない
  const message = qs(frag, "[data-message]");
  const extra = info?.message ?? null;
  show(message, extra !== null);
  if (extra !== null) setText(message, extra);

  root.append(frag);

  return {
    update() {},
    destroy() {},
  };
};
