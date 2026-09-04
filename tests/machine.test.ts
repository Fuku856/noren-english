/**
 * 1日ぶんをイベント列として通す。**製品を実際に守るのはこのテスト。**
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { dateKeyOf, jstMinuteToEpoch } from "@shared/dateKey";
import { SESSION_MS, TICKET_SESSION_MS } from "@shared/openTime";
import { normalizeDb, pickSentence, type SentenceDb } from "@/domain/sentences";
import { toAnswer } from "@/domain/arrange";
import {
  canUseTicket,
  isMissed,
  isSolvedToday,
  openTimeLabel,
  reduce,
  todayRecord,
  type AppState,
  type Effect,
  type Event,
} from "@/app/machine";
import { initialState } from "@/app/store";

const db: SentenceDb = normalizeDb(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../public/data/sentences.v1.json", import.meta.url)),
      "utf8",
    ),
  ),
);

const jst = (s: string) => Date.parse(`${s}+09:00`);
const DAY = "2026-08-18";
const OPEN_MINUTE = 21 * 60 + 47; // 21:47
const OPEN_AT = jstMinuteToEpoch(DAY, OPEN_MINUTE);

/** イベントを順に流して、最後の状態と出た Effect を返す。 */
function run(state: AppState, events: Event[]): { state: AppState; effects: Effect[] } {
  let s = state;
  const effects: Effect[] = [];
  for (const e of events) {
    const step = reduce(s, e);
    s = step.state;
    effects.push(...step.effects);
  }
  return { state: s, effects };
}

function boot(atMs: number): AppState {
  const base = initialState(atMs, dateKeyOf(atMs));
  return run(base, [
    { type: "HYDRATED", patch: { db, salt: "test-salt", ephemeral: false } },
    { type: "OPEN_TIME_RESOLVED", dateKey: DAY, minute: OPEN_MINUTE },
  ]).state;
}

describe("起動", () => {
  it("開店時刻が解決すると閉店中の画面になる", () => {
    const s = boot(jst("2026-08-18T20:00:00"));
    expect(s.screen).toBe("closed");
    expect(s.ready).toBe(true);
    expect(openTimeLabel(s)).toBe("21:47");
    expect(s.openAtMs).toBe(OPEN_AT);
  });

  it("解決前は boot のまま（開店時刻が分からないうちは何も出さない）", () => {
    const s = initialState(jst("2026-08-18T20:00:00"), DAY);
    expect(s.screen).toBe("boot");
    expect(s.ready).toBe(false);
  });

  it("日付が変わった後に届いた解決結果は捨てる", () => {
    const s = boot(jst("2026-08-18T20:00:00"));
    const after = reduce(s, {
      type: "OPEN_TIME_RESOLVED",
      dateKey: "2026-08-17",
      minute: 600,
    }).state;
    expect(after.openMinute).toBe(OPEN_MINUTE);
  });
});

describe("定刻の開店 → 解答 → 閉店", () => {
  let s: AppState;
  beforeEach(() => {
    s = boot(jst("2026-08-18T21:00:00"));
  });

  it("開店時刻より前は閉店中のまま", () => {
    const after = run(s, [{ type: "TICK", nowMs: OPEN_AT - 1000 }]).state;
    expect(after.screen).toBe("closed");
    expect(after.session).toBeNull();
  });

  it("開店時刻ちょうどで開く", () => {
    const { state, effects } = run(s, [{ type: "TICK", nowMs: OPEN_AT }]);
    expect(state.screen).toBe("open");
    expect(state.session).not.toBeNull();
    expect(state.session!.source).toBe("daily");
    expect(state.session!.endsAtMs).toBe(OPEN_AT + SESSION_MS);
    expect(effects.some((e) => e.k === "timerStart")).toBe(true);
    expect(effects.some((e) => e.k === "armTimer")).toBe(true);
  });

  it("出題は全世界で同じ1文", () => {
    const after = run(s, [{ type: "TICK", nowMs: OPEN_AT }]).state;
    expect(after.session!.sentence.id).toBe(pickSentence(db, DAY)!.id);
  });

  it("開いた時点で「開いた」記録が残る（解いていなくても）", () => {
    const after = run(s, [{ type: "TICK", nowMs: OPEN_AT }]).state;
    const r = todayRecord(after)!;
    expect(r.opened).toBe(true);
    expect(r.solved).toBe(false);
    expect(r.source).toBe("daily");
  });

  it("解答すると結果画面に移り、記録が solved になる", () => {
    const { state, effects } = run(s, [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer: pickSentence(db, DAY)!.en },
    ]);
    expect(state.screen).toBe("result");
    expect(state.session).toBeNull();
    expect(state.outcome!.accuracy).toBe(1);
    expect(state.outcome!.timedOut).toBe(false);
    expect(todayRecord(state)!.solved).toBe(true);
    expect(todayRecord(state)!.accuracy).toBe(1);
    expect(effects.some((e) => e.k === "timerStop")).toBe(true);
  });

  it("結果を閉じると閉店中に戻る（「もう一度」は無い）", () => {
    const after = run(s, [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer: "x" },
      { type: "RESULT_DISMISSED" },
    ]).state;
    expect(after.screen).toBe("closed");
    expect(after.outcome).toBeNull();
  });

  it("解いた後は開店枠の中でも再び開かない", () => {
    const after = run(s, [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer: "x" },
      { type: "RESULT_DISMISSED" },
      { type: "TICK", nowMs: OPEN_AT + 60_000 },
    ]).state;
    expect(after.screen).toBe("closed");
    expect(isSolvedToday(after)).toBe(true);
  });
});

describe("5分の枠を逃す", () => {
  it("枠を過ぎてから起動しても開かない", () => {
    const s = boot(OPEN_AT + SESSION_MS + 60_000);
    const after = run(s, [{ type: "TICK", nowMs: OPEN_AT + SESSION_MS + 60_000 }]).state;
    expect(after.screen).toBe("closed");
    expect(isMissed(after)).toBe(true);
    expect(todayRecord(after)).toBeNull();
  });

  it("開店中に端末がスリープし、枠を過ぎて復帰したら時間切れになる", () => {
    const s = boot(jst("2026-08-18T21:00:00"));
    const { state } = run(s, [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "CHIP_PLACE", chipId: 0 },
      // 10分後に画面が戻ってくる（setTimeout は止まっていた）
      { type: "TICK", nowMs: OPEN_AT + 10 * 60_000 },
    ]);
    expect(state.screen).toBe("result");
    expect(state.outcome!.timedOut).toBe(true);
    // 黙って握りつぶさず、開いたが解けなかったと記録する
    expect(todayRecord(state)!.opened).toBe(true);
    expect(todayRecord(state)!.solved).toBe(false);
  });

  it("時間切れでも、その時点の並びは答えとして残る", () => {
    const s = boot(jst("2026-08-18T21:00:00"));
    const opened = run(s, [{ type: "TICK", nowMs: OPEN_AT }]).state;
    const firstChip = opened.session!.arrange.pool[0]!;
    const after = run(opened, [
      { type: "CHIP_PLACE", chipId: firstChip.id },
      { type: "SESSION_EXPIRED" },
    ]).state;
    expect(after.outcome!.answer).toBe(firstChip.word);
  });
});

describe("チケット", () => {
  const afterMiss = () => boot(OPEN_AT + SESSION_MS + 60_000);

  it("枠を逃した後なら使える", () => {
    const s = afterMiss();
    expect(canUseTicket(s)).toBe(true);
  });

  it("開店時刻より前は使えない（近道にしない）", () => {
    const s = boot(jst("2026-08-18T20:00:00"));
    expect(canUseTicket(s)).toBe(false);
  });

  it("今日もう解いていれば使えない", () => {
    const s = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer: "x" },
      { type: "RESULT_DISMISSED" },
      { type: "TICK", nowMs: OPEN_AT + SESSION_MS + 1000 },
    ]).state;
    expect(canUseTicket(s)).toBe(false);
  });

  it("残数が0なら使えない", () => {
    const s = { ...afterMiss(), tickets: { count: 0, refilledWeek: "2026-08-17" } };
    expect(canUseTicket(s)).toBe(false);
  });

  it("使うと3分だけ開き、残数が1枚減る", () => {
    const s = afterMiss();
    const before = s.tickets.count;
    const { state, effects } = run(s, [{ type: "USE_TICKET" }]);
    expect(state.screen).toBe("open");
    expect(state.session!.source).toBe("ticket");
    expect(state.session!.endsAtMs - s.nowMs).toBe(TICKET_SESSION_MS);
    expect(state.tickets.count).toBe(before - 1);
    expect(effects.some((e) => e.k === "persist" && e.what === "tickets")).toBe(true);
  });

  it("通常開店は5分、チケットは3分", () => {
    expect(SESSION_MS).toBe(5 * 60_000);
    expect(TICKET_SESSION_MS).toBe(3 * 60_000);
  });
});

describe("並べ替えの操作", () => {
  const opened = () =>
    run(boot(jst("2026-08-18T21:00:00")), [{ type: "TICK", nowMs: OPEN_AT }]).state;

  it("置くとプールから消えて並びに入る", () => {
    const s = opened();
    const chip = s.session!.arrange.pool[2]!;
    const after = reduce(s, { type: "CHIP_PLACE", chipId: chip.id }).state;
    expect(after.session!.arrange.placed).toEqual([chip]);
    expect(after.session!.arrange.pool.some((c) => c.id === chip.id)).toBe(false);
  });

  it("戻すとプールに帰る", () => {
    const s = opened();
    const chip = s.session!.arrange.pool[0]!;
    const after = run(s, [
      { type: "CHIP_PLACE", chipId: chip.id },
      { type: "CHIP_UNPLACE", chipId: chip.id },
    ]).state;
    expect(after.session!.arrange.placed).toEqual([]);
    expect(after.session!.arrange.pool.some((c) => c.id === chip.id)).toBe(true);
  });

  it("正しい順に全部置けば元の英文になる", () => {
    const s = opened();
    const words = s.session!.sentence.en.split(/\s+/);
    let cur = s;
    for (let i = 0; i < words.length; i++) {
      cur = reduce(cur, { type: "CHIP_PLACE", chipId: i }).state;
    }
    expect(toAnswer(cur.session!.arrange)).toBe(s.session!.sentence.en);
  });

  it("シャッフルは日付から決まるので、開き直しても並びが同じ", () => {
    const a = opened();
    const b = opened();
    expect(a.session!.arrange.pool.map((c) => c.id)).toEqual(
      b.session!.arrange.pool.map((c) => c.id),
    );
  });
});

describe("時間帯の変更は翌日から", () => {
  it("変更しても当日の窓は変わらず、pending に積まれる", () => {
    const s = boot(jst("2026-08-18T20:00:00"));
    const after = reduce(s, {
      type: "WINDOW_REQUESTED",
      window: { start: 20 * 60, end: 21 * 60 + 5 },
    }).state;

    expect(after.settings.window).toEqual(s.settings.window);
    expect(after.settings.pending).toEqual({
      window: { start: 1200, end: 1265 },
      effectiveFrom: "2026-08-19",
    });
    // 今日の開店時刻も動かない
    expect(after.openAtMs).toBe(OPEN_AT);
  });
});

describe("日付の境界", () => {
  it("JST午前4時をまたぐと閉店中に戻り、開店時刻を計算し直す", () => {
    const s = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer: "x" },
    ]).state;
    expect(s.screen).toBe("result");

    const { state, effects } = run(s, [
      { type: "TICK", nowMs: jst("2026-08-19T04:00:00") },
    ]);
    expect(state.todayKey).toBe("2026-08-19");
    expect(state.screen).toBe("closed");
    expect(state.openMinute).toBeNull();
    expect(state.outcome).toBeNull();
    expect(effects.some((e) => e.k === "resolveOpenTime")).toBe(true);
    // 前日の記録は残る
    expect(state.records.some((r) => r.date === DAY && r.solved)).toBe(true);
  });

  it("深夜3時はまだ前日なので日付は変わらない", () => {
    const s = boot(jst("2026-08-18T23:00:00"));
    const after = run(s, [{ type: "TICK", nowMs: jst("2026-08-19T03:00:00") }]).state;
    expect(after.todayKey).toBe(DAY);
  });
});

describe("採点", () => {
  const answerWith = (answer: string) =>
    run(boot(jst("2026-08-18T21:00:00")), [
      { type: "TICK", nowMs: OPEN_AT },
      { type: "ANSWER", answer },
    ]).state;

  it("原文どおりなら 100%", () => {
    const s = answerWith(pickSentence(db, DAY)!.en);
    expect(s.outcome!.accuracy).toBe(1);
    expect(s.outcome!.graded.tokens.every((t) => t.kind === "match")).toBe(true);
  });

  it("語が足りなければ部分点になる", () => {
    const en = pickSentence(db, DAY)!.en;
    const words = en.split(" ");
    const half = words.slice(0, Math.floor(words.length / 2)).join(" ");
    const s = answerWith(half);
    expect(s.outcome!.accuracy).toBeGreaterThan(0);
    expect(s.outcome!.accuracy).toBeLessThan(1);
    // 記録にも同じ値が入る（音読と並べ替えで採点を分けない）
    expect(todayRecord(s)!.accuracy).toBe(s.outcome!.accuracy);
  });

  it("時間切れの音読は 0% で、記録の accuracy は空のまま", () => {
    const s = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "MODE_SET", mode: "speak" },
      { type: "TICK", nowMs: OPEN_AT },
      { type: "SESSION_EXPIRED" },
    ]).state;
    expect(s.outcome!.timedOut).toBe(true);
    expect(s.outcome!.accuracy).toBe(0);
    expect(todayRecord(s)!.solved).toBe(false);
    expect(todayRecord(s)!.accuracy).toBeNull();
  });
});

describe("音読モード", () => {
  it("音読で開くと読み上げの Effect が出る", () => {
    const { effects } = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "MODE_SET", mode: "speak" },
      { type: "TICK", nowMs: OPEN_AT },
    ]);
    const spoken = effects.find((e) => e.k === "speak");
    expect(spoken).toBeDefined();
    expect(spoken).toMatchObject({ text: pickSentence(db, DAY)!.en });
  });

  it("並べ替えで開いた場合は読み上げない", () => {
    const { effects } = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "TICK", nowMs: OPEN_AT },
    ]);
    expect(effects.some((e) => e.k === "speak")).toBe(false);
  });

  it("開店中に音読へ切り替えると、その場で読み上げる", () => {
    const opened = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "TICK", nowMs: OPEN_AT },
    ]).state;
    const { state, effects } = run(opened, [{ type: "MODE_SET", mode: "speak" }]);
    expect(state.session!.mode).toBe("speak");
    expect(effects.some((e) => e.k === "speak")).toBe(true);
  });

  it("音読から並べ替えへ戻せる（非対応端末でも詰まらない）", () => {
    const opened = run(boot(jst("2026-08-18T21:00:00")), [
      { type: "MODE_SET", mode: "speak" },
      { type: "TICK", nowMs: OPEN_AT },
    ]).state;
    const after = run(opened, [{ type: "MODE_SET", mode: "arrange" }]).state;
    expect(after.session!.mode).toBe("arrange");
    // 並べ替えの盤面はモードに関わらず用意されている
    expect(after.session!.arrange.pool.length).toBeGreaterThan(0);
  });
});

describe("開店中のモード切り替え", () => {
  const opened = () =>
    run(boot(jst("2026-08-18T21:00:00")), [
      { type: "MODE_SET", mode: "speak" },
      { type: "TICK", nowMs: OPEN_AT },
    ]).state;

  it("その場の切り替えは設定を書き換えない", () => {
    const after = run(opened(), [{ type: "SESSION_MODE_SET", mode: "arrange" }]).state;
    expect(after.session!.mode).toBe("arrange");
    // マイクが塞がれた日の逃げ道であって、普段の希望ではない
    expect(after.settings.mode).toBe("speak");
  });

  it("その場の切り替えは保存の Effect を出さない", () => {
    const { effects } = run(opened(), [{ type: "SESSION_MODE_SET", mode: "arrange" }]);
    expect(effects.some((e) => e.k === "persist")).toBe(false);
  });

  it("音読に戻したらその場で読み上げる", () => {
    const arranged = run(opened(), [{ type: "SESSION_MODE_SET", mode: "arrange" }]).state;
    const { state, effects } = run(arranged, [
      { type: "SESSION_MODE_SET", mode: "speak" },
    ]);
    expect(state.session!.mode).toBe("speak");
    expect(effects.some((e) => e.k === "speak")).toBe(true);
  });

  it("開店していなければ何も起きない", () => {
    const closed = boot(jst("2026-08-18T20:00:00"));
    const after = run(closed, [{ type: "SESSION_MODE_SET", mode: "speak" }]).state;
    expect(after).toBe(closed);
    expect(after.settings.mode).toBe("arrange");
  });
});
