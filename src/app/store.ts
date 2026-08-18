/**
 * 状態の置き場。machine.ts（純粋）と effects.ts（副作用）を繋ぐだけの薄い層。
 *
 * 購読者への通知はマイクロタスクでまとめる。連続して dispatch しても描画は1回で済む。
 */

import { defaultMilestones, defaultSettings, defaultTickets } from "@/data/schema";
import type { AppState, Effect, Event } from "./machine";
import { reduce } from "./machine";

export type Dispatch = (e: Event) => void;
export type EffectRunner = (effect: Effect, state: AppState) => void;

export function initialState(nowMs: number, todayKey: string): AppState {
  return {
    screen: "boot",
    ready: false,
    nowMs,
    todayKey,
    salt: "",
    settings: defaultSettings(),
    records: [],
    tickets: defaultTickets(),
    milestones: defaultMilestones(),
    db: null,
    openMinute: null,
    openAtMs: null,
    session: null,
    outcome: null,
    ephemeral: false,
  };
}

export interface Store {
  getState(): AppState;
  dispatch: Dispatch;
  subscribe(fn: (s: AppState) => void): () => void;
  /** Effect の実行者。boot 時に1度だけ差し込む。 */
  setEffectRunner(run: EffectRunner): void;
}

export function createStore(initial: AppState): Store {
  let state = initial;
  let runEffect: EffectRunner = () => {};
  const listeners = new Set<(s: AppState) => void>();
  let notifyQueued = false;

  const notify = () => {
    notifyQueued = false;
    const snapshot = state;
    for (const fn of listeners) fn(snapshot);
  };

  const dispatch: Dispatch = (event) => {
    const step = reduce(state, event);
    const changed = step.state !== state;
    state = step.state;

    for (const effect of step.effects) runEffect(effect, state);

    if (changed && !notifyQueued) {
      notifyQueued = true;
      queueMicrotask(notify);
    }
  };

  return {
    getState: () => state,
    dispatch,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    setEffectRunner(run) {
      runEffect = run;
    },
  };
}
