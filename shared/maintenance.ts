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
