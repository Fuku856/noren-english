import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  dayMinute,
  validateWindow,
  windowLength,
  type TimeWindow,
} from "@shared/window";

const hm = (h: number, m = 0): number => h * 60 + m;
const w = (sh: number, eh: number): TimeWindow => ({ start: hm(sh), end: hm(eh) });

describe("windowLength — 深夜またぎを許す", () => {
  it("21:00-23:00 は120分", () => {
    expect(windowLength(w(21, 23))).toBe(120);
  });
  it("23:00-01:00 は120分", () => {
    expect(windowLength(w(23, 1))).toBe(120);
  });
});

describe("dayMinute — 04:00 JST を 0 とする", () => {
  it("04:00 は 0", () => expect(dayMinute(hm(4))).toBe(0));
  it("03:59 は 1439", () => expect(dayMinute(hm(3, 59))).toBe(1439));
  it("21:00 は 1020", () => expect(dayMinute(hm(21))).toBe(1020));
});

describe("validateWindow", () => {
  const cases: Array<[string, TimeWindow, true | string]> = [
    ["21:00-23:00 は可", w(21, 23), true],
    ["19:00-23:00 は可（4時間）", w(19, 23), true],
    ["23:00-01:00 は可（0時はまたぐが4時はまたがない）", w(23, 1), true],
    ["22:00-03:00 は可（03:00 は のれん日の内側）", w(22, 3), true],
    ["06:00-12:00 は可", w(6, 12), true],
    ["21:00-21:30 は短すぎる", { start: hm(21), end: hm(21, 30) }, "too_short"],
    ["21:00-21:00 は短すぎる（長さ0）", w(21, 21), "too_short"],
    ["10:00-18:00 は長すぎる（480分）", w(10, 18), "too_long"],
    ["02:00-06:00 は 04:00 をまたぐので不可", w(2, 6), "crosses_day_start"],
    ["23:00-05:00 は 04:00 をまたぐので不可", w(23, 5), "crosses_day_start"],
    ["範囲外の値は不可", { start: -1, end: hm(23) }, "out_of_range"],
    ["整数でない値は不可", { start: 12.5, end: hm(23) }, "out_of_range"],
  ];

  for (const [name, win, expected] of cases) {
    it(name, () => {
      const r = validateWindow(win);
      if (expected === true) {
        expect(r.ok).toBe(true);
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe(expected);
      }
    });
  }

  it("既定の窓は妥当", () => {
    expect(validateWindow(DEFAULT_WINDOW).ok).toBe(true);
  });
});
