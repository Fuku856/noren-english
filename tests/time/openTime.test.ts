import { describe, expect, it } from "vitest";
import { dateKeyOf } from "@shared/dateKey";
import { openInstantMs, openMinute } from "@shared/openTime";
import { validateWindow, windowLength, type TimeWindow } from "@shared/window";
import fixtures from "@shared/fixtures/openTime.vectors.json";

const SALT = "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f";
const WIN: TimeWindow = { start: 21 * 60, end: 23 * 60 };

describe("凍結ベクタとの一致（Worker とのパリティ保証）", () => {
  for (const v of fixtures.vectors) {
    it(`${v.salt.slice(0, 8)}… / ${v.dateKey} / ${v.window.start}-${v.window.end}`, async () => {
      expect(await openMinute({ salt: v.salt, dateKey: v.dateKey, window: v.window })).toBe(
        v.expectedMinute,
      );
      expect(
        await openInstantMs({ salt: v.salt, dateKey: v.dateKey, window: v.window }),
      ).toBe(v.expectedInstantMs);
    });
  }
});

describe("openMinute", () => {
  it("同じ入力なら常に同じ値（リロードで開店時刻が変わらない）", async () => {
    const first = await openMinute({ salt: SALT, dateKey: "2026-08-18", window: WIN });
    for (let i = 0; i < 50; i++) {
      expect(await openMinute({ salt: SALT, dateKey: "2026-08-18", window: WIN })).toBe(
        first,
      );
    }
  });

  it("窓の中に収まる", async () => {
    for (let d = 0; d < 60; d++) {
      const dateKey = `2026-08-${String((d % 28) + 1).padStart(2, "0")}`;
      const m = await openMinute({ salt: SALT, dateKey, window: WIN });
      expect(m).toBeGreaterThanOrEqual(WIN.start);
      expect(m).toBeLessThan(WIN.end);
    }
  });

  it("深夜またぎの窓でも収まる", async () => {
    const win: TimeWindow = { start: 23 * 60, end: 1 * 60 };
    const len = windowLength(win);
    for (let d = 1; d <= 28; d++) {
      const dateKey = `2026-08-${String(d).padStart(2, "0")}`;
      const m = await openMinute({ salt: SALT, dateKey, window: win });
      const rel = (m - win.start + 1440) % 1440;
      expect(rel).toBeLessThan(len);
    }
  });

  it("salt が違えば別の時刻になる（全員が同時に開かない）", async () => {
    const a = await openMinute({ salt: "salt-a", dateKey: "2026-08-18", window: WIN });
    const b = await openMinute({ salt: "salt-b", dateKey: "2026-08-18", window: WIN });
    const c = await openMinute({ salt: "salt-c", dateKey: "2026-08-18", window: WIN });
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("窓の全域にそれなりに散る", async () => {
    const win: TimeWindow = { start: 21 * 60, end: 23 * 60 };
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      seen.add(await openMinute({ salt: `s${i}`, dateKey: "2026-08-18", window: win }));
    }
    // 120通りのうち少なくとも100は出てほしい
    expect(seen.size).toBeGreaterThan(100);
  });

  it("不正な窓は例外", async () => {
    await expect(
      openMinute({ salt: SALT, dateKey: "2026-08-18", window: { start: 120, end: 360 } }),
    ).rejects.toThrow();
  });
});

describe("openInstantMs", () => {
  it("その瞬間は必ずその日の のれん日 に属する", async () => {
    const win: TimeWindow = { start: 23 * 60, end: 1 * 60 };
    for (let d = 1; d <= 28; d++) {
      const dateKey = `2026-08-${String(d).padStart(2, "0")}`;
      const ms = await openInstantMs({ salt: SALT, dateKey, window: win });
      expect(dateKeyOf(ms)).toBe(dateKey);
    }
  });

  it("妥当な窓ならどの窓でも のれん日 の内側に収まる", async () => {
    const windows: TimeWindow[] = [
      { start: 6 * 60, end: 10 * 60 },
      { start: 12 * 60, end: 15 * 60 },
      { start: 21 * 60, end: 23 * 60 },
      { start: 22 * 60, end: 3 * 60 },
    ];
    for (const win of windows) {
      expect(validateWindow(win).ok).toBe(true);
      const ms = await openInstantMs({ salt: SALT, dateKey: "2026-08-18", window: win });
      expect(dateKeyOf(ms)).toBe("2026-08-18");
    }
  });
});
