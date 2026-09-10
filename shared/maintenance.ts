/**
 * メンテナンス表示の文言と判定。
 *
 * Cloudflare Pages の環境変数で切り替える。フロント（src/）と
 * Pages Functions（functions/）の両方から読まれるので、
 * window / document / localStorage / process には触らない。
 */

/** 大きめ太字で出す見出し。 */
export const MAINTENANCE_TITLE = "メンテナンス中";

/** 環境変数の有無に関わらず必ず出す本文。 */
export const MAINTENANCE_LINES = [
  "現在、システムメンテナンスを実施しております。",
  "ご不便をおかけしますが、しばらくお待ちください。",
] as const;

/**
 * あの1枚に載せる飾り。**ここに書いた1本だけ**が 503 を素通しできる。
 * index.html の tpl-maintenance も同じパスを指している。
 */
export const MAINTENANCE_ART_SRC = "/maintenance.webp";

/**
 * メンテナンス中でも 503 にせず通すパス。functions/_middleware.ts が使う。
 *
 * 増やすなら、取れなかったときにページが読めなくなる物でないことを確かめてから。
 * /api/maintenance を塞ぐと、インストール済みの端末を閉じる経路が消える。
 */
export const MAINTENANCE_PASS_THROUGH: readonly string[] = [
  "/api/maintenance",
  MAINTENANCE_ART_SRC,
];

export interface MaintenanceInfo {
  title: string;
  lines: readonly string[];
  /** MAINTENANCE_MESSAGE で与えられた追記。無ければ null。 */
  message: string | null;
}

/**
 * MAINTENANCE_MODE の判定。
 *
 * `"true"` のときだけ ON。未設定・空・`"TRUE"`・`"1"` はすべて OFF にする。
 * 曖昧に真と見なすと、打ち間違いでサイト全体が閉じる。
 */
export function isMaintenanceOn(mode: string | undefined): boolean {
  return mode === "true";
}

/** MAINTENANCE_MESSAGE から表示内容を組む。空白だけなら未設定と同じ扱い。 */
export function maintenanceInfo(message: string | undefined): MaintenanceInfo {
  const trimmed = message?.trim();
  return {
    title: MAINTENANCE_TITLE,
    lines: MAINTENANCE_LINES,
    message: trimmed ? trimmed : null,
  };
}
