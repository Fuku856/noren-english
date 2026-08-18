/**
 * 状態機械。**純粋関数**。
 *
 *   reduce(state, event) → { state, effects }
 *
 * 副作用を Effect の配列に追い出しているのは、
 * 「21:47 に何が起きるか」をブラウザなしで検証できるようにするため。
 * 1日1回しか開かないアプリで、これを持たずに開発するのは無理がある。
 *
 * ここでは時刻を読まない・保存しない・DOM に触らない。全部 Event と Effect で受け渡す。
 */

import { addDays, dateKeyOf, formatMinute, jstMinuteToEpoch } from "@shared/dateKey";
import { SESSION_MS, TICKET_SESSION_MS } from "@shared/openTime";
import type { TimeWindow } from "@shared/window";
import type { ArrangeState } from "@/domain/arrange";
import { createArrange, place, toAnswer, unplace } from "@/domain/arrange";
import type { Sentence, SentenceDb } from "@/domain/sentences";
import { pickSentence } from "@/domain/sentences";
import type {
  DayRecord,
  Milestones,
  Mode,
  SessionSource,
  Settings,
  Tickets,
} from "@/data/schema";
import { openedRecord, solvedRecord, upsertRecord } from "@/data/records";
import { canSpend, spend } from "@/data/tickets";

// ---------------------------------------------------------------- 型

export type Screen =
  | "boot"
  | "onboarding"
  | "install"
  | "closed"
  | "open"
  | "result"
  | "settings";

export interface Session {
  source: SessionSource;
  mode: Mode;
  sentence: Sentence;
  startedAtMs: number;
  endsAtMs: number;
  arrange: ArrangeState;
}

export interface Outcome {
  sentence: Sentence;
  answer: string;
  accuracy: number;
  /** 時間切れで終わったか。黙って握りつぶさず、正直に見せる。 */
  timedOut: boolean;
}

export interface AppState {
  screen: Screen;
  ready: boolean;
  nowMs: number;
  todayKey: string;

  salt: string;
  settings: Settings;
  records: DayRecord[];
  tickets: Tickets;
  milestones: Milestones;

  db: SentenceDb | null;

  /** 今日の開店時刻（JST の分）。窓か salt が変われば計算し直す。 */
  openMinute: number | null;
  openAtMs: number | null;

  session: Session | null;
  outcome: Outcome | null;

  /** 記録が端末に残らない環境か。 */
  ephemeral: boolean;
}

export type Event =
  | { type: "HYDRATED"; patch: Partial<AppState> }
  | { type: "OPEN_TIME_RESOLVED"; dateKey: string; minute: number }
  | { type: "TICK"; nowMs: number }
  | { type: "USE_TICKET" }
  | { type: "MODE_SET"; mode: Mode }
  | { type: "CHIP_PLACE"; chipId: number }
  | { type: "CHIP_UNPLACE"; chipId: number }
  | { type: "ANSWER"; answer: string; accuracy: number }
  | { type: "SESSION_EXPIRED" }
  | { type: "RESULT_DISMISSED" }
  | { type: "WINDOW_REQUESTED"; window: TimeWindow }
  | { type: "INSTALL_ACKNOWLEDGED" }
  | { type: "NAVIGATE"; screen: Screen };

export type Effect =
  | { k: "persist"; what: "settings" | "records" | "tickets" | "milestones" }
  | { k: "resolveOpenTime"; dateKey: string }
  | { k: "norenOpen"; endsAtMs: number; totalMs: number }
  | { k: "norenClose" }
  | { k: "speak"; text: string }
  | { k: "armTimer"; atMs: number };

export interface Step {
  state: AppState;
  effects: Effect[];
}

const noop = (state: AppState): Step => ({ state, effects: [] });

// ---------------------------------------------------------------- 導出

export function todayRecord(s: AppState): DayRecord | null {
  return s.records.find((r) => r.date === s.todayKey) ?? null;
}

/** 今日はもう解いたか。 */
export function isSolvedToday(s: AppState): boolean {
  return todayRecord(s)?.solved === true;
}

/** 定刻の開店枠を過ぎたか。 */
export function isMissed(s: AppState): boolean {
  if (s.openAtMs === null) return false;
  return s.nowMs >= s.openAtMs + SESSION_MS;
}

/** チケットが使える状況か。閉店後・未解答・残数ありの3つが揃ったときだけ。 */
export function canUseTicket(s: AppState): boolean {
  return (
    s.ready &&
    s.session === null &&
    !isSolvedToday(s) &&
    isMissed(s) &&
    canSpend(s.tickets)
  );
}

/** 閉店画面に出す「本日 HH:MM」。 */
export function openTimeLabel(s: AppState): string | null {
  return s.openMinute === null ? null : formatMinute(s.openMinute);
}

// ---------------------------------------------------------------- 遷移

function startSession(
  s: AppState,
  source: SessionSource,
  nowMs: number,
): Step {
  if (!s.db) return noop(s);
  const sentence = pickSentence(s.db, s.todayKey);
  if (!sentence) return noop(s);

  const totalMs = source === "ticket" ? TICKET_SESSION_MS : SESSION_MS;
  const endsAtMs = nowMs + totalMs;

  const session: Session = {
    source,
    mode: s.settings.mode,
    sentence,
    startedAtMs: nowMs,
    endsAtMs,
    arrange: createArrange(sentence.en, `${s.todayKey}|${sentence.id}`),
  };

  const record = openedRecord({
    date: s.todayKey,
    sentenceId: sentence.id,
    mode: session.mode,
    source,
  });

  return {
    state: {
      ...s,
      screen: "open",
      session,
      outcome: null,
      records: upsertRecord(s.records, record),
    },
    effects: [
      { k: "norenOpen", endsAtMs, totalMs },
      { k: "armTimer", atMs: endsAtMs },
      { k: "persist", what: "records" },
    ],
  };
}

function finishSession(
  s: AppState,
  answer: string,
  accuracy: number,
  timedOut: boolean,
): Step {
  const session = s.session;
  if (!session) return noop(s);

  const base =
    todayRecord(s) ??
    openedRecord({
      date: s.todayKey,
      sentenceId: session.sentence.id,
      mode: session.mode,
      source: session.source,
    });

  const record = timedOut
    ? { ...base, solved: false, accuracy: accuracy > 0 ? accuracy : null }
    : solvedRecord(base, accuracy, session.mode);

  return {
    state: {
      ...s,
      screen: "result",
      session: null,
      outcome: { sentence: session.sentence, answer, accuracy, timedOut },
      records: upsertRecord(s.records, record),
    },
    effects: [{ k: "norenClose" }, { k: "persist", what: "records" }],
  };
}

/**
 * 時刻が進んだときの判定。
 *
 * 端末がスリープしていた間はタイマーが止まるので、復帰した瞬間に
 * 「実はもう時間切れだった」を検出できないと5分が伸びる。だから毎ティック見る。
 */
function onTick(s: AppState, nowMs: number): Step {
  const todayKey = dateKeyOf(nowMs);
  let state: AppState = { ...s, nowMs };

  // 日付が変わった。開店時刻を計算し直し、画面を閉店中に戻す
  if (todayKey !== s.todayKey) {
    state = {
      ...state,
      todayKey,
      openMinute: null,
      openAtMs: null,
      session: null,
      outcome: null,
      screen: state.screen === "settings" ? "settings" : "closed",
    };
    return {
      state,
      effects: [{ k: "resolveOpenTime", dateKey: todayKey }, { k: "norenClose" }],
    };
  }

  if (!state.ready) return noop(state);

  // 開店中の枠を過ぎた
  if (state.session && nowMs >= state.session.endsAtMs) {
    return finishSession(state, toAnswer(state.session.arrange), 0, true);
  }

  // 定刻の開店。画面が閉店中のときだけ自動で開ける
  if (
    state.screen === "closed" &&
    state.session === null &&
    state.openAtMs !== null &&
    nowMs >= state.openAtMs &&
    nowMs < state.openAtMs + SESSION_MS &&
    !isSolvedToday(state)
  ) {
    return startSession(state, "daily", nowMs);
  }

  return noop(state);
}

export function reduce(s: AppState, e: Event): Step {
  switch (e.type) {
    case "HYDRATED": {
      const state = { ...s, ...e.patch };
      return { state, effects: [] };
    }

    case "OPEN_TIME_RESOLVED": {
      // 解決している間に日付が変わっていたら捨てる
      if (e.dateKey !== s.todayKey) return noop(s);
      return {
        state: {
          ...s,
          ready: true,
          openMinute: e.minute,
          openAtMs: jstMinuteToEpoch(e.dateKey, e.minute),
          screen: s.screen === "boot" ? "closed" : s.screen,
        },
        effects: [],
      };
    }

    case "TICK":
      return onTick(s, e.nowMs);

    case "USE_TICKET": {
      if (!canUseTicket(s)) return noop(s);
      const withSpend: AppState = { ...s, tickets: spend(s.tickets) };
      const step = startSession(withSpend, "ticket", s.nowMs);
      return {
        state: step.state,
        effects: [...step.effects, { k: "persist", what: "tickets" }],
      };
    }

    case "MODE_SET": {
      const settings = { ...s.settings, mode: e.mode };
      const session = s.session ? { ...s.session, mode: e.mode } : null;
      return {
        state: { ...s, settings, session },
        effects: [{ k: "persist", what: "settings" }],
      };
    }

    case "CHIP_PLACE": {
      if (!s.session) return noop(s);
      const arrange = place(s.session.arrange, e.chipId);
      return noop({ ...s, session: { ...s.session, arrange } });
    }

    case "CHIP_UNPLACE": {
      if (!s.session) return noop(s);
      const arrange = unplace(s.session.arrange, e.chipId);
      return noop({ ...s, session: { ...s.session, arrange } });
    }

    case "ANSWER":
      return finishSession(s, e.answer, e.accuracy, false);

    case "SESSION_EXPIRED": {
      if (!s.session) return noop(s);
      return finishSession(s, toAnswer(s.session.arrange), 0, true);
    }

    case "RESULT_DISMISSED":
      // 「もう一度」は無い。結果を見たら閉店中に戻るだけ
      return noop({ ...s, screen: "closed", outcome: null });

    case "WINDOW_REQUESTED": {
      // 変更は翌日から。窓を今すぐ狭めて即開店することを防ぐ
      const settings: Settings = {
        ...s.settings,
        pending: { window: e.window, effectiveFrom: addDays(s.todayKey, 1) },
      };
      return {
        state: { ...s, settings },
        effects: [{ k: "persist", what: "settings" }],
      };
    }

    case "INSTALL_ACKNOWLEDGED": {
      const settings = { ...s.settings, installedPrompted: true };
      return {
        state: { ...s, settings, screen: "closed" },
        effects: [{ k: "persist", what: "settings" }],
      };
    }

    case "NAVIGATE":
      return noop({ ...s, screen: e.screen });
  }
}
