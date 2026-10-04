import { describe, expect, it } from "vitest";
import { addDays, dateKeyOf, dayStartMs, jstMinuteToEpoch } from "@shared/dateKey";
import { openInstantMs } from "@shared/openTime";
import { effectiveWindow, nextOpenInstant, type Schedule } from "@shared/schedule";
import type { TimeWindow } from "@shared/window";
import fixtures from "@shared/fixtures/openTime.vectors.json";

const SALT = "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f";
const WIN: TimeWindow = { start: 21 * 60, end: 23 * 60 };
const sched = (window: TimeWindow, pending: Schedule["pending"] = null): Schedule => ({
  salt: SALT,
  window,
  pending,
});

describe("effectiveWindow", () => {
  const next: TimeWindow = { start: 7 * 60, end: 9 * 60 };
  const plan = { window: WIN, pending: { window: next, effectiveFrom: "2026-08-19" } };

  it("予約の前日までは今の窓", () => {
    expect(effectiveWindow(plan, "2026-08-18")).toEqual(WIN);
  });

  it("予約の日から新しい窓", () => {
    expect(effectiveWindow(plan, "2026-08-19")).toEqual(next);
    expect(effectiveWindow(plan, "2026-09-01")).toEqual(next);
  });
});

describe("nextOpenInstant（凍結ベクタとのパリティ）", () => {
  for (const v of fixtures.vectors) {
    it(`${v.salt.slice(0, 8)}… / ${v.dateKey} / ${v.window.start}-${v.window.end}`, async () => {
      const s: Schedule = { salt: v.salt, window: v.window, pending: null };
      // その のれん日 が始まった瞬間から見れば、その日の開店が次に来る
      expect(await nextOpenInstant(s, dayStartMs(v.dateKey))).toBe(v.expectedInstantMs);
      // 開店の1ms前でも同じ
      expect(await nextOpenInstant(s, v.expectedInstantMs - 1)).toBe(v.expectedInstantMs);
    });
  }
});

describe("nextOpenInstant", () => {
  it("開店のちょうどその瞬間を渡すと翌日になる（送った直後に次へ進める形）", async () => {
    const today = await openInstantMs({ salt: SALT, dateKey: "2026-08-18", window: WIN });
    const tomorrow = await openInstantMs({
      salt: SALT,
      dateKey: "2026-08-19",
      window: WIN,
    });
    expect(await nextOpenInstant(sched(WIN), today)).toBe(tomorrow);
  });

  it("開店後・閉店前でも翌日になる", async () => {
    const today = await openInstantMs({ salt: SALT, dateKey: "2026-08-18", window: WIN });
    const got = await nextOpenInstant(sched(WIN), today + 60_000);
    expect(dateKeyOf(got)).toBe("2026-08-19");
  });

  it("03:59 JST（のれん日の末尾）から見ると、翌のれん日の開店", async () => {
    const lateNight = jstMinuteToEpoch("2026-08-18", 3 * 60 + 59);
    const got = await nextOpenInstant(sched(WIN), lateNight);
    expect(dateKeyOf(got)).toBe("2026-08-19");
    expect(got).toBe(
      await openInstantMs({ salt: SALT, dateKey: "2026-08-19", window: WIN }),
    );
  });

  it("予約した窓は effectiveFrom の日から使われる", async () => {
    const next: TimeWindow = { start: 7 * 60, end: 9 * 60 };
    const s = sched(WIN, { window: next, effectiveFrom: "2026-08-19" });

    // 18日の朝は、まだ今の窓（21-23時）で18日の開店
    const morning = jstMinuteToEpoch("2026-08-18", 8 * 60);
    expect(await nextOpenInstant(s, morning)).toBe(
      await openInstantMs({ salt: SALT, dateKey: "2026-08-18", window: WIN }),
    );

    // 18日の深夜（開店後）は、19日の新しい窓（7-9時）
    const night = jstMinuteToEpoch("2026-08-18", 23 * 60 + 30);
    expect(await nextOpenInstant(s, night)).toBe(
      await openInstantMs({ salt: SALT, dateKey: "2026-08-19", window: next }),
    );
  });

  it("深夜またぎの窓（23:00-01:00）で 0時台の開店は前の のれん日 に属する", async () => {
    const win: TimeWindow = { start: 23 * 60, end: 1 * 60 };
    for (let d = 1; d <= 28; d++) {
      const dateKey = `2026-08-${String(d).padStart(2, "0")}`;
      const expected = await openInstantMs({ salt: SALT, dateKey, window: win });
      const got = await nextOpenInstant(sched(win), dayStartMs(dateKey));
      expect(got).toBe(expected);
      expect(dateKeyOf(got)).toBe(dateKey);
    }
  });

  it("30日続けて進めると、毎日1回ずつ・日付の順に開店する", async () => {
    let t = dayStartMs("2026-08-01");
    for (let i = 0; i < 30; i++) {
      t = await nextOpenInstant(sched(WIN), t);
      expect(dateKeyOf(t)).toBe(addDays("2026-08-01", i));
    }
  });
});
