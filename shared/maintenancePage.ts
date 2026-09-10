/**
 * メンテナンス中にサーバが返す1枚。
 *
 * CSS はインライン。メンテナンス中は全パスが 503 なので、
 * 取りに行かせてよいのは **middleware の PASS_THROUGH に入れた1本だけ**。
 * 今そこにあるのは /maintenance.webp（飾りの1枚）で、
 * 取れなくても alt="" の飾りなので文面は最後まで読める。
 * 増やすときは functions/_middleware.ts の PASS_THROUGH も必ず足すこと。
 *
 * ⚠ 見た目は src/styles/screens.css の .maint と対になっている。
 *   片方だけ変えないこと（アプリ側の画面とサーバ側の1枚が食い違う）。
 *
 * フロントと Pages Functions の両方から読まれる場所なので、
 * window / document / localStorage / process には触らない。
 */

import { MAINTENANCE_ART_SRC } from "./maintenance";
import type { MaintenanceInfo } from "./maintenance";

/** 環境変数には任意のテキストが入る。素で差し込まない。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function maintenancePage(info: MaintenanceInfo): string {
  const { title, lines, message } = info;
  const extra =
    message === null
      ? ""
      : `\n      <p class="maint__message">${escapeHtml(message)}</p>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
  /*
   * 地の色は html に置く。body を 100svh に留める（下記）ので、
   * バーが引っ込んで広がったぶんはこちらが塗る。
   */
  :root { color-scheme: light; background: #e6f0f8; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    /*
     * **svh。dvh にしてはいけない。** dvh はブラウザのバーの出入りで
     * 変わり、中央揃えなのでその半分だけ札が跳ぶ。テキストを選ぼうとして
     * バーが出た瞬間に札ごと上へずれるのがこれ。
     * （src/styles/screens.css の .maint と対）
     */
    min-height: 100svh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: #e6f0f8;
    font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP",
      "Yu Gothic", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .maint__card {
    width: 100%;
    max-width: 26rem;
    padding: 2.5rem 2rem;
    border: 1px solid #e3e5e9;
    border-radius: 16px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(16, 18, 24, 0.04), 0 8px 24px rgba(16, 18, 24, 0.06);
    text-align: center;
  }
  .maint__art {
    display: block;
    width: 100%;
    max-width: 16rem;
    height: auto;
    margin: 0 auto 1.75rem;
  }
  .maint__title {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.4;
    color: #1b1f27;
  }
  .maint__lines {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.85;
    color: #1b1f27;
    white-space: pre-line;
    /* 中央揃えの日本語が語の途中で折り返すと読みにくい */
    word-break: auto-phrase;
  }
  .maint__message {
    margin: 1.5rem 0 0;
    padding-top: 1.25rem;
    border-top: 1px solid #eceef2;
    font-size: 0.9rem;
    line-height: 1.8;
    color: #5b6273;
    white-space: pre-line;
    word-break: auto-phrase;
  }
</style>
</head>
<body>
  <main class="maint__card">
    <img class="maint__art" src="${MAINTENANCE_ART_SRC}" alt="" width="640" height="520" />
    <h1 class="maint__title">${escapeHtml(title)}</h1>
    <p class="maint__lines">${lines.map(escapeHtml).join("\n")}</p>${extra}
  </main>
</body>
</html>
`;
}
