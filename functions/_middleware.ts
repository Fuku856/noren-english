/**
 * メンテナンス表示の入口（サーバ側）。
 *
 * Cloudflare Pages の環境変数 MAINTENANCE_MODE が "true" のあいだ、
 * /api/maintenance 以外のすべてのパスに 503 とこの1枚を返す。
 * 切り替えはダッシュボードで値を変えて Retry deployment するだけで、
 * リポジトリには一切触らない。
 *
 * ⚠ これが効くのは Service Worker のキャッシュを持たない端末だけ。
 *   インストール済みの利用者にはナビゲーションがプリキャッシュから返るので、
 *   そちらは /api/maintenance を見るアプリ側のフラグ（src/data/maintenance.ts）で閉じる。
 */

import {
  MAINTENANCE_PASS_THROUGH,
  isMaintenanceOn,
  maintenanceInfo,
} from "../shared/maintenance";
import { maintenancePage } from "../shared/maintenancePage";

interface Env {
  MAINTENANCE_MODE?: string;
  MAINTENANCE_MESSAGE?: string;
}

/** 中身は shared/maintenance.ts。ページ側が読む物と必ず一致させるため向こうに置いてある。 */
const PASS_THROUGH = new Set(MAINTENANCE_PASS_THROUGH);

export const onRequest: PagesFunction<Env> = (ctx) => {
  if (!isMaintenanceOn(ctx.env.MAINTENANCE_MODE)) return ctx.next();

  const { pathname } = new URL(ctx.request.url);
  if (PASS_THROUGH.has(pathname)) return ctx.next();

  const info = maintenanceInfo(ctx.env.MAINTENANCE_MESSAGE);

  return new Response(maintenancePage(info), {
    // 一時的に閉じているだけなので 503。クローラに消されないようにする
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "3600",
    },
  });
};
