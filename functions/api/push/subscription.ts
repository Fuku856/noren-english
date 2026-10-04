/**
 * 通知の購読の受け口。PUT で登録・更新、DELETE で解除。
 *
 * 中身は shared/pushServer.ts。ここは Request / Response との詰め替えだけ。
 * 端末側は src/push/client.ts からしか呼ばない。**通知を有効にしていない端末は一度も来ない。**
 *
 * D1 のバインディング `DB` は Pages のダッシュボードで設定する（Preview / Production を別の DB に）。
 * リポジトリ直下に Pages 用の wrangler.toml を置くとそれが設定の正になり、
 * ダッシュボードで MAINTENANCE_MODE を切り替える運用が崩れるので置かない。
 *
 * メンテナンス中は _middleware.ts がここも 503 にする。端末側は次の起動でやり直す。
 */

import {
  d1Store,
  DEFAULT_MAX_SUBSCRIPTIONS,
  handleSubscribe,
  handleUnsubscribe,
  parseBody,
  type ApiResult,
} from "../../../shared/pushServer";

interface Env {
  DB?: D1Database;
  /** 行数の上限。未設定なら DEFAULT_MAX_SUBSCRIPTIONS。 */
  PUSH_MAX_SUBSCRIPTIONS?: string;
}

function respond(r: ApiResult): Response {
  return new Response(r.body === null ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** 通知を設定していない環境（DB 未接続）では 503。アプリは通知なしで動き続ける。 */
const unavailable = () => respond({ status: 503, body: { error: "unavailable" } });

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.DB) return unavailable();
  const max = Number(ctx.env.PUSH_MAX_SUBSCRIPTIONS) || DEFAULT_MAX_SUBSCRIPTIONS;
  const body = parseBody(await ctx.request.text());
  // 時刻はここで1度だけ取り、純粋な関数に渡す
  return respond(await handleSubscribe(d1Store(ctx.env.DB), body, Date.now(), max));
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.DB) return unavailable();
  const body = parseBody(await ctx.request.text());
  return respond(await handleUnsubscribe(d1Store(ctx.env.DB), body));
};
