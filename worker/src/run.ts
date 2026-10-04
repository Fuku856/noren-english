/**
 * 毎分1回の送信。Cron Trigger から呼ばれる。
 *
 * 時刻・保存・送信・メンテナンス判定はすべて引数で受け取る。
 * D1 もネットワークも無しにテストできるようにするため（tests/push/run.test.ts）。
 *
 * 順番が肝:
 *   1. 期限の来た行を古い順に読む
 *   2. **先に next_open_at を翌日へ進める**（進められた行だけが自分の担当）
 *   3. 担当の行にだけ送る
 *
 * 2 を 3 より先にするのは、同じ分に2回起動しても2通目を出さないため。
 * 二重に届く・閉店後に届く通知の方が、1通落ちるより害が大きい（at-most-once）。
 */

import { SESSION_MS } from "../../shared/openTime";
import { nextOpenInstant } from "../../shared/schedule";
import {
  scheduleOfRow,
  type Advance,
  type PushStore,
  type SubscriptionRow,
} from "../../shared/pushServer";

/**
 * 1回の起動で送る上限。Free プランのサブリクエストは 50/起動。
 * メンテナンス判定の fetch と余裕を残して 40。溢れた行は次の分に回る（5分以内なら送る）。
 */
export const SEND_LIMIT = 40;

export interface RunDeps {
  store: PushStore;
  nowMs: number;
  /** 中身なしの push を1通送り、HTTP ステータスを返す。投げたら失敗扱い。 */
  send(endpoint: string, ttlSec: number): Promise<number>;
  /** メンテナンス中か。分からなければ false（送る）。 */
  isMaintenance(): Promise<boolean>;
  limit?: number;
}

export interface RunReport {
  /** 期限が来ていた行。 */
  due: number;
  sent: number;
  /** 別の起動か PUT が先に触っていた行。 */
  lostRace: number;
  /** 閉店後になっていたので送らずに進めた行。 */
  late: number;
  /** メンテナンス中なので送らずに進めた行。 */
  maintenance: number;
  /** 404 / 410。購読が無効になっていたので消した行。 */
  gone: number;
  /** それ以外の失敗（429 / 5xx / 通信失敗）。行は残し、翌日また送る。 */
  failed: number;
}

const emptyReport = (): RunReport => ({
  due: 0,
  sent: 0,
  lostRace: 0,
  late: 0,
  maintenance: 0,
  gone: 0,
  failed: 0,
});

/** 閉店までの残り秒。これを TTL にすると、圏外で遅れた通知は閉店後に届かない。 */
export function ttlSecFor(openAtMs: number, nowMs: number): number {
  return Math.floor((openAtMs + SESSION_MS - nowMs) / 1000);
}

export async function runOnce(d: RunDeps): Promise<RunReport> {
  const report = emptyReport();
  const now = d.nowMs;

  const due = await d.store.due(now, d.limit ?? SEND_LIMIT);
  report.due = due.length;
  // ほとんどの分はここで終わる（D1 を1回引いただけ）
  if (due.length === 0) return report;

  // 次の予定を計算する。壊れた行（窓が不正など）は直しようがないので消す
  const advances: Advance[] = [];
  const broken: string[] = [];
  for (const row of due) {
    try {
      advances.push({
        endpoint: row.endpoint,
        from: row.next_open_at,
        to: await nextOpenInstant(scheduleOfRow(row), now),
      });
    } catch {
      broken.push(row.endpoint);
    }
  }

  const mine = await d.store.advance(advances, now);
  const maintenance = await d.isMaintenance().catch(() => false);

  const targets: SubscriptionRow[] = [];
  for (const row of due) {
    if (!mine.has(row.endpoint)) {
      if (!broken.includes(row.endpoint)) report.lostRace++;
      continue;
    }
    if (maintenance) {
      report.maintenance++;
      continue;
    }
    if (ttlSecFor(row.next_open_at, now) <= 0) {
      report.late++;
      continue;
    }
    targets.push(row);
  }

  const gone = [...broken];
  await Promise.all(
    targets.map(async (row) => {
      let status = 0;
      try {
        status = await d.send(row.endpoint, ttlSecFor(row.next_open_at, now));
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) report.sent++;
      else if (status === 404 || status === 410) gone.push(row.endpoint);
      else report.failed++;
    }),
  );

  report.gone = gone.length;
  await d.store.removeGone(gone);
  return report;
}
