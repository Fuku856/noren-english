/**
 * 閉店中（待っている画面）。
 *
 * ボタンはほぼ無い。設定とチケットだけ。
 * 次に開く時刻と今週の記録だけを置き、それ以外は出さない。
 *
 * ⚠ 連続日数は数字にしない。今週の丸は「やった日に置かれる」だけで、
 *   途切れたことを責める見せ方にしない（欠けた日は空のまま描く）。
 */

import { addDays, weekKeyOf } from "@shared/dateKey";
import { canUseTicket, isMissed, isSolvedToday, openTimeLabel } from "@/app/machine";
import { findRecord } from "@/data/records";
import type { AppState } from "@/app/machine";
import type { ScreenModule } from "../render";
import { disposer, el, listen, qs, setAttr, setText, tmpl } from "../dom";

/** 週の始まりは月曜（weekKeyOf に合わせる）。 */
const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

function note(s: AppState): string {
  if (!s.ready) return "";
  if (isSolvedToday(s)) return "今日は終わりました";
  if (isMissed(s)) return "今日は閉まりました";
  // 通知はまだ無い。自分で見に来てもらう前提を正直に書く
  return "その時刻にアプリを開くと、5分だけ問題が出ます";
}

export const closedScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-closed");
  const bag = disposer();

  const time = qs(frag, "[data-time]");
  const noteEl = qs(frag, "[data-note]");
  const week = qs(frag, "[data-week]");
  const ticket = qs<HTMLButtonElement>(frag, "[data-ticket]");
  const ticketCount = qs(frag, "[data-ticket-count]");

  bag.add(
    listen(qs<HTMLButtonElement>(frag, "[data-settings]"), "click", () =>
      dispatch({ type: "NAVIGATE", screen: "settings" }),
    ),
  );
  bag.add(listen(ticket, "click", () => dispatch({ type: "USE_TICKET" })));

  // 今週。曜日を添えると「昨日は何だったか」が読めるようになる
  const cells: Array<{ cell: HTMLElement; mark: HTMLElement }> = [];
  for (let i = 0; i < 7; i++) {
    const cell = el("span", "week__cell");
    cell.append(el("span", "week__day", DAY_LABELS[i]));
    const mark = el("span", "week__mark");
    cell.append(mark);
    week.append(cell);
    cells.push({ cell, mark });
  }

  const update = (s: AppState) => {
    setText(time, openTimeLabel(s) ?? "--:--");
    setText(noteEl, note(s));

    const weekStart = weekKeyOf(s.todayKey);
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStart, i);
      const rec = findRecord(s.records, key);
      const { cell, mark } = cells[i]!;
      mark.classList.toggle("week__mark--solved", rec?.solved === true);
      mark.classList.toggle(
        "week__mark--missed",
        key < s.todayKey && rec?.solved !== true,
      );
      cell.classList.toggle("week__cell--today", key === s.todayKey);
    }

    setText(ticketCount, String(s.tickets.count));
    const usable = canUseTicket(s);
    setAttr(ticket, "data-usable", String(usable));
    ticket.disabled = !usable;
    setAttr(
      ticket,
      "aria-label",
      usable
        ? `チケットを使って3分開く（残り${s.tickets.count}枚）`
        : `チケット残り${s.tickets.count}枚`,
    );
  };

  root.append(frag);
  update(state);

  return { update, destroy: () => bag.dispose() };
};
