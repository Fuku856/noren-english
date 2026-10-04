/**
 * 通知の送信 Worker。Cron Trigger で毎分起動する。
 *
 * Pages Functions には Cron が無いので、アプリ本体（Pages）とは別にデプロイする。
 * D1 は Pages の /api/push/subscription と同じ DB をバインドする。
 *
 * ここは環境との詰め替えだけ。中身は run.ts。
 * 時刻を取るのはこのファイルだけ（guard.test.ts は worker/src のうちここだけを見逃す）。
 */

import { PUSH_TOPIC } from "../../shared/push";
import { d1Store } from "../../shared/pushServer";
import { runOnce } from "./run";
import { createVapidSigner, isValidSubject } from "./webpush";

interface Env {
  DB: D1Database;
  /** 非圧縮 P-256 公開鍵の base64url。Pages の VITE_VAPID_PUBLIC_KEY と同じ値。 */
  VAPID_PUBLIC_KEY: string;
  /** 秘密鍵の JWK。**Worker Secret にだけ置く。** */
  VAPID_PRIVATE_KEY: string;
  /** mailto: か https:。 */
  VAPID_SUBJECT: string;
  /** アプリのオリジン。メンテナンス判定（/api/maintenance）を引くのに使う。 */
  APP_ORIGIN: string;
}

const MAINTENANCE_TIMEOUT_MS = 3000;

/**
 * メンテナンス中か。判定の出どころを Pages の環境変数1つに保つため、毎回アプリに訊く。
 * 取れなければ false（送る）。開いていないのに「開きました」と送るよりは、
 * メンテナンスに気づかず送る方がまだ害が小さい（開けば閉店中の画面が出るだけ）。
 */
async function isMaintenance(origin: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/api/maintenance", origin), {
      signal: AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { maintenance?: unknown };
    return body.maintenance === true;
  } catch {
    return false;
  }
}

function configError(env: Env): string | null {
  if (!env.DB) return "DB が未設定";
  if (!env.VAPID_PUBLIC_KEY) return "VAPID_PUBLIC_KEY が未設定";
  if (!env.VAPID_PRIVATE_KEY) return "VAPID_PRIVATE_KEY が未設定";
  if (!isValidSubject(env.VAPID_SUBJECT ?? "")) return "VAPID_SUBJECT は mailto: か https:";
  if (!/^https:\/\//.test(env.APP_ORIGIN ?? "")) return "APP_ORIGIN が未設定";
  return null;
}

export default {
  async scheduled(controller, env) {
    const problem = configError(env);
    if (problem) {
      // 設定が揃うまでは何も進めない（次の送信時刻も動かさない）
      console.error(`[push] 設定が足りません: ${problem}`);
      return;
    }

    // Cron が遅れて起動した場合に備え、予定時刻と実時刻の遅い方を「今」にする
    const nowMs = Math.max(controller.scheduledTime, Date.now());
    const signer = createVapidSigner(
      {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateJwk: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      },
      Math.floor(nowMs / 1000),
    );

    const report = await runOnce({
      store: d1Store(env.DB),
      nowMs,
      isMaintenance: () => isMaintenance(env.APP_ORIGIN),
      async send(endpoint, ttlSec) {
        const req = await signer.request(endpoint, {
          ttlSec,
          topic: PUSH_TOPIC,
          urgency: "high",
        });
        return (await fetch(req)).status;
      },
    });

    // 件数だけ。endpoint や salt は出さない
    if (report.due > 0) console.log(`[push] ${JSON.stringify(report)}`);
  },
} satisfies ExportedHandler<Env>;
