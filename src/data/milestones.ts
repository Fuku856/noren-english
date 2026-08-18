/**
 * マイルストーン。
 *
 * 連続日数は**どこにも表示しない**。代わりに未見の報酬を離脱点の直前に置く。
 * 7日目は iOS の localStorage 7日削除に合わせてある（Phase 2 で中身を作る）。
 */

import { parseMilestones, type Milestones } from "./schema";
import { KEYS, readJson, writeJson } from "./storage";

export type MilestoneId = 7 | 14 | 21 | 30;
export const MILESTONES: readonly MilestoneId[] = [7, 14, 21, 30];

const SEEN_KEY: Record<MilestoneId, keyof Milestones> = {
  7: "seen7",
  14: "seen14",
  21: "seen21",
  30: "seen30",
};

export function loadMilestonesSafe(): Milestones {
  return readJson(KEYS.milestones, parseMilestones);
}

export function saveMilestones(m: Milestones): void {
  writeJson(KEYS.milestones, m);
}

export function hasSeen(m: Milestones, id: MilestoneId): boolean {
  return m[SEEN_KEY[id]];
}

export function markSeen(m: Milestones, id: MilestoneId): Milestones {
  return { ...m, [SEEN_KEY[id]]: true };
}

/** 参加日数に対して、まだ見ていない最大のマイルストーン。 */
export function pendingMilestone(m: Milestones, days: number): MilestoneId | null {
  let found: MilestoneId | null = null;
  for (const id of MILESTONES) {
    if (days >= id && !hasSeen(m, id)) found = id;
  }
  return found;
}
