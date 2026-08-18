/**
 * チケット。
 *
 * 週2枚、JST月曜4時に補充、繰り越しなし。
 * 閉店後に使うと3分だけ開く（通常5分）。
 *
 * 残数を常時表示するのは、減るのが見えることに意味があるから。
 * ただし「使う」は目立たせない。救いであって近道ではない。
 */

import { weekKeyOf } from "@shared/dateKey";
import { defaultTickets, parseTickets, WEEKLY_TICKETS, type Tickets } from "./schema";
import { KEYS, readJson, writeJson } from "./storage";

export function loadTickets(): Tickets {
  return readJson(KEYS.tickets, parseTickets);
}

export function saveTickets(t: Tickets): void {
  writeJson(KEYS.tickets, t);
}

/**
 * 週が変わっていれば補充する。繰り越しはしない（前週の残りは消える）。
 * 初回（refilledWeek が空）も補充として扱う。
 */
export function refillIfNeeded(t: Tickets, todayKey: string): Tickets {
  const week = weekKeyOf(todayKey);
  if (t.refilledWeek === week) return t;
  return { count: WEEKLY_TICKETS, refilledWeek: week };
}

export function canSpend(t: Tickets): boolean {
  return t.count > 0;
}

export function spend(t: Tickets): Tickets {
  if (!canSpend(t)) return t;
  return { ...t, count: t.count - 1 };
}

export { WEEKLY_TICKETS, defaultTickets };
