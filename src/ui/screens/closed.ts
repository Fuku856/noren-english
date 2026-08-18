/**
 * 閉店中。
 *
 * ボタンはほぼ無い。設定とチケットだけ。
 * 横木だけを残しておくのが肝で、**何も無い店先**であって空白ではない。
 * ここに掛かるものがある、と分かることが翌日の開店を待たせる。
 *
 * ⚠ この画面に錆朱を一切出さないこと（tokens.css が構造的に保証しているが、
 *   インラインで色を書けば破れる。書かないこと）。
 */

import { addDays, weekKeyOf } from "@shared/dateKey";
import { canUseTicket, isMissed, isSolvedToday, openTimeLabel } from "@/app/machine";
import { findRecord } from "@/data/records";
import type { AppState } from "@/app/machine";
import type { ScreenModule } from "../render";
import { disposer, el, listen, qs, setAttr, setText, tmpl } from "../dom";

function note(s: AppState): string {
  if (!s.ready) return "";
  if (isSolvedToday(s)) return "今日は終わりました";
  if (isMissed(s)) return "今日は閉まりました";
  return "";
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

  // 今週の点。連続日数は数字として出さない
  const dots: HTMLElement[] = [];
  for (let i = 0; i < 7; i++) {
    const dot = el("span", "week__dot");
    dots.push(dot);
    week.append(dot);
  }

  const update = (s: AppState) => {
    setText(time, openTimeLabel(s) ?? "--:--");
    setText(noteEl, note(s));

    const weekStart = weekKeyOf(s.todayKey);
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStart, i);
      const rec = findRecord(s.records, key);
      const dot = dots[i]!;
      dot.classList.toggle("week__dot--solved", rec?.solved === true);
      dot.classList.toggle(
        "week__dot--missed",
        key < s.todayKey && rec?.solved !== true,
      );
      dot.classList.toggle("week__dot--today", key === s.todayKey);
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
