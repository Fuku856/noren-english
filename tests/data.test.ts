import { beforeEach, describe, expect, it } from "vitest";
import { addDays, weekKeyOf } from "@shared/dateKey";
import { DEFAULT_WINDOW } from "@shared/window";
import {
  defaultSettings,
  parseRecords,
  parseSettings,
  parseTickets,
  WEEKLY_TICKETS,
  type DayRecord,
} from "@/data/schema";
import {
  clearAll,
  initStorage,
  isPersistent,
  KEYS,
  readJson,
  setBackendForTest,
  writeJson,
  type Backend,
} from "@/data/storage";
import {
  effectiveWindow,
  promotePending,
  requestWindow,
} from "@/data/settings";
import { canSpend, refillIfNeeded, spend } from "@/data/tickets";
import {
  accuracySeries,
  findRecord,
  openedRecord,
  participationDays,
  solvedRecord,
  upsertRecord,
} from "@/data/records";

/** テスト用の素朴なバックエンド。 */
function memBackend(): Backend {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

describe("storage — 書けない環境でも起動する", () => {
  beforeEach(() => setBackendForTest(null));

  it("localStorage が無い環境では非永続にフォールバックする", () => {
    // node 環境なので localStorage は存在しない
    expect(initStorage()).toBe(false);
    expect(isPersistent()).toBe(false);
  });

  it("フォールバック中でも読み書きはできる（そのセッションは動く）", () => {
    initStorage();
    writeJson(KEYS.settings, { mode: "arrange" });
    expect(readJson(KEYS.settings, parseSettings).mode).toBe("arrange");
  });

  it("壊れた JSON でも既定値が返り、例外が出ない", () => {
    const b = memBackend();
    b.set(KEYS.settings, "{ これは JSON ではない");
    setBackendForTest(b);
    expect(() => readJson(KEYS.settings, parseSettings)).not.toThrow();
    expect(readJson(KEYS.settings, parseSettings)).toEqual(defaultSettings());
  });

  it("clearAll は noren: 以外を消さない", () => {
    const b = memBackend();
    b.set(KEYS.settings, "{}");
    b.set("other:thing", "keep");
    setBackendForTest(b);
    clearAll();
    expect(b.get(KEYS.settings)).toBeNull();
    expect(b.get("other:thing")).toBe("keep");
  });
});

describe("schema — 壊れた値で起動不能にしない", () => {
  it("設定が丸ごと壊れていても既定値になる", () => {
    for (const bad of [undefined, null, 42, "x", [], { window: "no" }]) {
      expect(parseSettings(bad).window).toEqual(DEFAULT_WINDOW);
    }
  });

  it("不正な窓（4時をまたぐ）は既定値に落ちる", () => {
    expect(parseSettings({ window: { start: 120, end: 360 } }).window).toEqual(
      DEFAULT_WINDOW,
    );
  });

  it("記録の配列は壊れた行だけ捨てて残りを活かす", () => {
    const rows = [
      { date: "2026-08-18", solved: true, accuracy: 0.9, sentenceId: 3 },
      { date: "こわれた" },
      null,
      { date: "2026-08-17", solved: false, sentenceId: 1 },
    ];
    const out = parseRecords(rows);
    expect(out.map((r) => r.date)).toEqual(["2026-08-17", "2026-08-18"]);
  });

  it("範囲外の一致率は null に落ちる", () => {
    expect(parseRecords([{ date: "2026-08-18", accuracy: 5 }])[0]!.accuracy).toBeNull();
    expect(parseRecords([{ date: "2026-08-18", accuracy: -1 }])[0]!.accuracy).toBeNull();
    expect(parseRecords([{ date: "2026-08-18", accuracy: 0.5 }])[0]!.accuracy).toBe(0.5);
  });

  it("チケットの残数は 0〜2 に丸められる", () => {
    expect(parseTickets({ count: 99 }).count).toBe(WEEKLY_TICKETS);
    expect(parseTickets({ count: -5 }).count).toBe(0);
  });
});

describe("時間帯の変更は翌日から", () => {
  const today = "2026-08-18";
  const next = { start: 20 * 60, end: 21 * 60 + 5 };

  it("変更を予約しても当日の窓は変わらない", () => {
    const s = requestWindow(defaultSettings(), next, today);
    expect(effectiveWindow(s, today)).toEqual(DEFAULT_WINDOW);
  });

  it("翌日からは新しい窓が効く", () => {
    const s = requestWindow(defaultSettings(), next, today);
    expect(effectiveWindow(s, addDays(today, 1))).toEqual(next);
  });

  it("不正な窓は予約されない", () => {
    const s = requestWindow(defaultSettings(), { start: 120, end: 360 }, today);
    expect(s.pending).toBeNull();
  });

  it("翌日に起動すると pending が本採用に昇格する", () => {
    const s = promotePending(
      requestWindow(defaultSettings(), next, today),
      addDays(today, 1),
    );
    expect(s.window).toEqual(next);
    expect(s.pending).toBeNull();
  });

  it("当日中は昇格しない", () => {
    const s = promotePending(requestWindow(defaultSettings(), next, today), today);
    expect(s.window).toEqual(DEFAULT_WINDOW);
    expect(s.pending).not.toBeNull();
  });
});

describe("チケット — JST月曜4時に補充、繰り越しなし", () => {
  const MON = "2026-08-17";
  const TUE = "2026-08-18";
  const NEXT_MON = "2026-08-24";

  it("初回は補充される", () => {
    const t = refillIfNeeded({ count: 0, refilledWeek: "" }, TUE);
    expect(t.count).toBe(WEEKLY_TICKETS);
    expect(t.refilledWeek).toBe(MON);
  });

  it("同じ週の中では補充されない", () => {
    const start = refillIfNeeded({ count: 0, refilledWeek: "" }, MON);
    const used = spend(start);
    expect(refillIfNeeded(used, TUE).count).toBe(WEEKLY_TICKETS - 1);
  });

  it("週が変わると2枚に戻る（繰り越さない）", () => {
    const start = refillIfNeeded({ count: 0, refilledWeek: "" }, MON);
    expect(refillIfNeeded(start, NEXT_MON).count).toBe(WEEKLY_TICKETS);
  });

  it("使い切っても週が変われば戻る", () => {
    let t = refillIfNeeded({ count: 0, refilledWeek: "" }, MON);
    t = spend(spend(t));
    expect(canSpend(t)).toBe(false);
    expect(refillIfNeeded(t, NEXT_MON).count).toBe(WEEKLY_TICKETS);
  });

  it("残数0からは減らない", () => {
    expect(spend({ count: 0, refilledWeek: MON }).count).toBe(0);
  });

  it("週キーは月曜起点", () => {
    expect(weekKeyOf(TUE)).toBe(MON);
    expect(weekKeyOf(MON)).toBe(MON);
    expect(weekKeyOf("2026-08-23")).toBe(MON); // 日曜
  });
});

describe("記録の集計", () => {
  const mk = (date: string, solved: boolean, accuracy: number | null): DayRecord => ({
    ...openedRecord({ date, sentenceId: 1, mode: "arrange", source: "daily" }),
    solved,
    accuracy,
  });

  const records = [
    mk("2026-08-15", true, 0.8),
    mk("2026-08-16", false, null),
    mk("2026-08-17", true, 0.9),
    mk("2026-08-18", true, 1.0),
  ];

  it("参加日数は解いた日だけを数える（連続日数ではない）", () => {
    expect(participationDays(records)).toBe(3);
  });

  it("同じ日の記録は1件に保たれる", () => {
    const out = upsertRecord(records, mk("2026-08-17", true, 0.5));
    expect(out.filter((r) => r.date === "2026-08-17").length).toBe(1);
    expect(findRecord(out, "2026-08-17")!.accuracy).toBe(0.5);
  });

  it("upsert は日付順を保つ", () => {
    const out = upsertRecord(records, mk("2026-08-10", true, 0.7));
    expect(out.map((r) => r.date)).toEqual([...out.map((r) => r.date)].sort());
  });

  it("一致率の推移は解いた日だけを含む", () => {
    const series = accuracySeries(records, "2026-08-18", 7);
    expect(series.map((p) => p.accuracy)).toEqual([0.8, 0.9, 1.0]);
  });

  it("solvedRecord は開いた記録を上書きする", () => {
    const base = openedRecord({
      date: "2026-08-18",
      sentenceId: 7,
      mode: "arrange",
      source: "ticket",
    });
    const done = solvedRecord(base, 0.75, "speak");
    expect(done).toMatchObject({
      solved: true,
      accuracy: 0.75,
      mode: "speak",
      source: "ticket",
      sentenceId: 7,
    });
  });
});
