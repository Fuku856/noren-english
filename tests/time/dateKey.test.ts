import { describe, expect, it } from "vitest";
import {
  addDays,
  dateKeyOf,
  dayNumber,
  dayStartMs,
  daysBetween,
  formatMinute,
  isMondayJst,
  jstMinuteOfDay,
  jstMinuteToEpoch,
  weekKeyOf,
} from "@shared/dateKey";

/** JST の壁時計から epoch ms を作るテスト用ヘルパ。 */
const jst = (s: string) => Date.parse(`${s}+09:00`);

describe("dateKeyOf — JST 午前4時境界", () => {
  it("04:00 ちょうどで新しい日が始まる", () => {
    expect(dateKeyOf(jst("2026-08-18T04:00:00"))).toBe("2026-08-18");
  });

  it("03:59:59.999 はまだ前日", () => {
    expect(dateKeyOf(jst("2026-08-18T03:59:59.999"))).toBe("2026-08-17");
  });

  it("深夜1時は前日のまま（日をまたいだせいで2日消費しない）", () => {
    expect(dateKeyOf(jst("2026-08-18T01:30:00"))).toBe("2026-08-17");
  });

  it("正午は当日", () => {
    expect(dateKeyOf(jst("2026-08-18T12:00:00"))).toBe("2026-08-18");
  });

  it("23:59 も当日", () => {
    expect(dateKeyOf(jst("2026-08-18T23:59:59"))).toBe("2026-08-18");
  });

  it("月をまたぐ", () => {
    expect(dateKeyOf(jst("2026-09-01T03:00:00"))).toBe("2026-08-31");
    expect(dateKeyOf(jst("2026-09-01T05:00:00"))).toBe("2026-09-01");
  });

  it("年をまたぐ", () => {
    expect(dateKeyOf(jst("2027-01-01T02:00:00"))).toBe("2026-12-31");
    expect(dateKeyOf(jst("2027-01-01T04:00:00"))).toBe("2027-01-01");
  });

  it("閏日を扱える", () => {
    expect(dateKeyOf(jst("2028-02-29T10:00:00"))).toBe("2028-02-29");
    expect(dateKeyOf(jst("2028-03-01T02:00:00"))).toBe("2028-02-29");
  });
});

describe("dayStartMs", () => {
  it("そののれん日の 04:00 JST を返す", () => {
    expect(dayStartMs("2026-08-18")).toBe(jst("2026-08-18T04:00:00"));
  });

  it("dateKeyOf の逆になっている", () => {
    for (const k of ["2026-01-01", "2026-08-18", "2028-02-29", "2026-12-31"]) {
      expect(dateKeyOf(dayStartMs(k))).toBe(k);
      expect(dateKeyOf(dayStartMs(k) + 86_400_000 - 1)).toBe(k);
    }
  });
});

describe("jstMinuteToEpoch — 分 0〜239 は翌カレンダー日に落ちる", () => {
  it("04:00（分240）は同じカレンダー日", () => {
    expect(jstMinuteToEpoch("2026-08-18", 240)).toBe(jst("2026-08-18T04:00:00"));
  });

  it("21:47（分1307）は同じカレンダー日", () => {
    expect(jstMinuteToEpoch("2026-08-18", 21 * 60 + 47)).toBe(
      jst("2026-08-18T21:47:00"),
    );
  });

  it("01:30（分90）は翌カレンダー日", () => {
    expect(jstMinuteToEpoch("2026-08-18", 90)).toBe(jst("2026-08-19T01:30:00"));
  });

  it("03:59（分239）は翌カレンダー日で、まだそののれん日の内側", () => {
    const ms = jstMinuteToEpoch("2026-08-18", 239);
    expect(ms).toBe(jst("2026-08-19T03:59:00"));
    expect(dateKeyOf(ms)).toBe("2026-08-18");
  });

  it("どの分でも dateKeyOf で元の日に戻る", () => {
    for (let m = 0; m < 1440; m++) {
      expect(dateKeyOf(jstMinuteToEpoch("2026-08-18", m))).toBe("2026-08-18");
    }
  });
});

describe("jstMinuteOfDay", () => {
  it("JST の壁時計を分で返す", () => {
    expect(jstMinuteOfDay(jst("2026-08-18T21:47:00"))).toBe(21 * 60 + 47);
    expect(jstMinuteOfDay(jst("2026-08-18T00:00:00"))).toBe(0);
    expect(jstMinuteOfDay(jst("2026-08-18T23:59:00"))).toBe(23 * 60 + 59);
  });
});

describe("addDays / dayNumber / daysBetween", () => {
  it("日をまたいで加算できる", () => {
    expect(addDays("2026-08-18", 1)).toBe("2026-08-19");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("dayNumber は基準日から数える", () => {
    expect(dayNumber("2026-01-01")).toBe(0);
    expect(dayNumber("2026-01-02")).toBe(1);
    expect(dayNumber("2026-12-31")).toBe(364);
  });

  it("daysBetween", () => {
    expect(daysBetween("2026-08-18", "2026-08-11")).toBe(7);
    expect(daysBetween("2026-08-11", "2026-08-18")).toBe(-7);
  });

  it("1000日ぶん addDays と dayNumber が一致する", () => {
    let k = "2026-01-01";
    for (let i = 0; i < 1000; i++) {
      expect(dayNumber(k)).toBe(i);
      k = addDays(k, 1);
    }
  });
});

describe("weekKeyOf / isMondayJst", () => {
  it("2026-08-17 は月曜", () => {
    expect(isMondayJst("2026-08-17")).toBe(true);
    expect(isMondayJst("2026-08-18")).toBe(false);
  });

  it("同じ週の日は同じ週キーになる", () => {
    for (let i = 0; i < 7; i++) {
      expect(weekKeyOf(addDays("2026-08-17", i))).toBe("2026-08-17");
    }
    expect(weekKeyOf("2026-08-24")).toBe("2026-08-24");
  });
});

describe("formatMinute", () => {
  it("HH:MM に整形する", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(21 * 60 + 47)).toBe("21:47");
    expect(formatMinute(1439)).toBe("23:59");
  });
});
