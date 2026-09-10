/**
 * メンテナンス状態の取得と保持。
 *
 * Service Worker が index.html をプリキャッシュするので、
 * サーバ側（functions/_middleware.ts）だけではインストール済みの利用者に届かない。
 * 起動時にここを通してアプリ側でも閉じる。
 *
 * ## 三値であること
 *
 * 「メンテナンス中」と「取れなかった」を混ぜてはいけない。
 * 混ぜると、旗を解いてよいのかどうかが判断できなくなる。
 * 解いてよいのは **サーバが maintenance:false と答えたときだけ**。
 *
 * ## 旗を残すこと
 *
 * 判定は非同期で、返るまでに最大 TIMEOUT_MS かかる。何も保存しないと
 * リロードのたびにその窓が開き直り、閉じている最中にアプリが操作できてしまう。
 * だから一度「メンテナンス中」と分かったら端末に書き、次の起動では
 * ネットワークより先に閉じる。
 *
 * **この旗は時間では失効しない。** 圏外のまま明けた場合、その端末は
 * 通信が戻るまで閉じたままになる。承知のうえでそう決めてある。
 */

import type { MaintenanceInfo } from "@shared/maintenance";
import { maintenanceInfo } from "@shared/maintenance";
import { KEYS, readJson, removeRaw, writeJson } from "./storage";

const ENDPOINT = "/api/maintenance";

/** 起動を待たせない。ここで粘っても利用者には何の得もない */
const TIMEOUT_MS = 3000;

interface RawResponse {
  maintenance?: unknown;
  message?: unknown;
}

/**
 * 問い合わせの結果。
 *
 * - `on`      … 閉じる。旗を書く
 * - `off`     … 開ける。旗を解く
 * - `unknown` … 何も分からなかった。**旗に触らない**
 */
export type MaintenanceProbe =
  | { state: "on"; info: MaintenanceInfo }
  | { state: "off" }
  | { state: "unknown" };

/** サーバに今の状態を訊く。 */
export async function fetchMaintenance(
  url = ENDPOINT,
): Promise<MaintenanceProbe> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { state: "unknown" };

    const raw = (await res.json()) as RawResponse;

    // 見出しと本文はレスポンスを信用せず定数から組む。
    // 環境変数で差し替えられるのは追記の1つだけ
    if (raw.maintenance === true) {
      return {
        state: "on",
        info: maintenanceInfo(
          typeof raw.message === "string" ? raw.message : undefined,
        ),
      };
    }

    // 明示的な false のときだけ開ける。形が違うなら判断しない
    if (raw.maintenance === false) return { state: "off" };
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

/** 保存されているのは追記だけ。見出しと本文は定数から組み直す。 */
function parseStored(u: unknown): MaintenanceInfo | null {
  if (typeof u !== "object" || u === null) return null;
  const message = (u as { message?: unknown }).message;
  return maintenanceInfo(typeof message === "string" ? message : undefined);
}

/** 前回の起動までに分かっていたメンテナンス状態。無ければ null。 */
export function loadMaintenance(): MaintenanceInfo | null {
  return readJson(KEYS.maintenance, parseStored);
}

export function saveMaintenance(info: MaintenanceInfo): void {
  writeJson(KEYS.maintenance, { message: info.message });
}

export function clearMaintenance(): void {
  removeRaw(KEYS.maintenance);
}
