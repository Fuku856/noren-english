/**
 * メンテナンスの状態。アプリ側（src/data/maintenance.ts）がこれを見る。
 *
 * このパスは dist/ に出力されないので Service Worker のプリキャッシュに入らず、
 * インストール済みの端末でも必ずネットワークまで出る。
 * そのぶん取得に失敗しうるので、アプリ側は失敗を「通常営業」として扱う。
 */

import { isMaintenanceOn, maintenanceInfo } from "../../shared/maintenance";

interface Env {
  MAINTENANCE_MODE?: string;
  MAINTENANCE_MESSAGE?: string;
}

export const onRequestGet: PagesFunction<Env> = (ctx) => {
  const on = isMaintenanceOn(ctx.env.MAINTENANCE_MODE);
  const body = on
    ? { maintenance: true, ...maintenanceInfo(ctx.env.MAINTENANCE_MESSAGE) }
    : { maintenance: false };

  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
