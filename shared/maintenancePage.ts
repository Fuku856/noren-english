/**
 * メンテナンス中にサーバが返す1枚。
 *
 * 完全に自己完結させる（CSS はインライン、外部アセット参照なし）。
 * メンテナンス中は全パスが 503 なので、CSS や画像を取りに行かせてはいけない。
 *
 * ⚠ 見た目は src/styles/screens.css の .maint と対になっている。
 *   片方だけ変えないこと（アプリ側の画面とサーバ側の1枚が食い違う）。
 *
 * フロントと Pages Functions の両方から読まれる場所なので、
 * window / document / localStorage / process には触らない。
 */

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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
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
    <h1 class="maint__title">${escapeHtml(title)}</h1>
    <p class="maint__lines">${lines.map(escapeHtml).join("\n")}</p>${extra}
  </main>
</body>
</html>
`;
}
