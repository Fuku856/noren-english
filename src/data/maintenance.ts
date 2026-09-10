/**
 * メンテナンス状態の取得。
 *
 * Service Worker が index.html をプリキャッシュするので、
 * サーバ側（functions/_middleware.ts）だけではインストール済みの利用者に届かない。
 * 起動時にここを通してアプリ側でも閉じる。
 *
 * **取れなかったら通常営業にする。** 圏外や機内モードで「メンテナンス中」を
 * 出してしまうと、オフラインでも開けるという前提そのものが壊れる。
 */

import type { MaintenanceInfo } from "@shared/maintenance";
import { maintenanceInfo } from "@shared/maintenance";

const ENDPOINT = "/api/maintenance";

/** 起動を待たせない。ここで粘っても利用者には何の得もない */
const TIMEOUT_MS = 3000;

interface RawResponse {
  maintenance?: unknown;
  message?: unknown;
}

/** メンテナンス中なら表示内容、そうでなければ null。 */
export async function fetchMaintenance(
  url = ENDPOINT,
): Promise<MaintenanceInfo | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const raw = (await res.json()) as RawResponse;
    if (raw.maintenance !== true) return null;

    // 見出しと本文はレスポンスを信用せず定数から組む。
    // 環境変数で差し替えられるのは追記の1つだけ
    return maintenanceInfo(typeof raw.message === "string" ? raw.message : undefined);
  } catch {
    return null;
  }
}
