/**
 * Effect の実行者。machine.ts が「何をすべきか」を返し、ここが実際にやる。
 *
 * 保存・時刻の解決・暖簾の操作はすべてここを通る。
 * machine 側に副作用が漏れないようにするための境界。
 */

import { openMinute } from "@shared/openTime";
import { saveRecords } from "@/data/records";
import { effectiveWindow, saveSettings } from "@/data/settings";
import { saveTickets } from "@/data/tickets";
import { KEYS, writeJson } from "@/data/storage";
import type { PushClient } from "@/push/client";
import type { AppState, Effect } from "./machine";
import type { Dispatch } from "./store";

export interface TimerHandle {
  open(endsAtMs: number, totalMs: number, nowMs: number): void;
  close(): void;
}

export interface EffectDeps {
  dispatch: Dispatch;
  now: () => number;
  timer: TimerHandle | null;
  speak?: (text: string) => void;
  push?: PushClient;
}

/** 通知のサーバーに預けるのはこの3つだけ（salt と、いまの窓・予約中の窓）。 */
function scheduleOf(state: AppState) {
  return {
    salt: state.salt,
    window: state.settings.window,
    pending: state.settings.pending,
  };
}

export function createEffectRunner(deps: EffectDeps) {
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearExpiry = () => {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };

  return (effect: Effect, state: AppState): void => {
    switch (effect.k) {
      case "persist": {
        switch (effect.what) {
          case "settings":
            saveSettings(state.settings);
            break;
          case "records":
            saveRecords(state.records);
            break;
          case "tickets":
            saveTickets(state.tickets);
            break;
          case "milestones":
            writeJson(KEYS.milestones, state.milestones);
            break;
        }
        return;
      }

      case "resolveOpenTime": {
        const dateKey = effect.dateKey;
        const win = effectiveWindow(state.settings, dateKey);
        void openMinute({ salt: state.salt, dateKey, window: win })
          .then((minute) => {
            deps.dispatch({ type: "OPEN_TIME_RESOLVED", dateKey, minute });
          })
          .catch(() => {
            // 窓が壊れている。設定画面に誘導するしかない
            deps.dispatch({ type: "NAVIGATE", screen: "onboarding" });
          });
        return;
      }

      case "timerStart": {
        deps.timer?.open(effect.endsAtMs, effect.totalMs, deps.now());
        return;
      }

      case "timerStop": {
        clearExpiry();
        deps.timer?.close();
        return;
      }

      case "armTimer": {
        // タイマーは補助。端末がスリープすると止まるので、
        // 真実は endsAtMs で、毎ティックの再チェックが本命（machine.ts の onTick）
        clearExpiry();
        const delay = Math.max(0, effect.atMs - deps.now());
        expiryTimer = setTimeout(() => {
          expiryTimer = null;
          deps.dispatch({ type: "SESSION_EXPIRED" });
        }, delay);
        return;
      }

      case "speak": {
        deps.speak?.(effect.text);
        return;
      }

      /*
       * 通知。どれも失敗してもアプリ本体には何も起きない。
       *
       * pushEnable は dispatch の中で同期に走る（store.ts）。client.enable は
       * 最初に許可ダイアログを同期で呼ぶので、クリックの文脈が保たれる。
       */
      case "pushEnable": {
        if (!deps.push) return;
        void deps.push
          .enable(scheduleOf(state))
          .then((status) => deps.dispatch({ type: "PUSH_STATUS", status }));
        return;
      }

      case "pushDisable": {
        if (!deps.push) return;
        void deps.push
          .disable()
          .then((status) => deps.dispatch({ type: "PUSH_STATUS", status }));
        return;
      }

      case "pushSync": {
        if (!deps.push) return;
        void deps.push
          .sync(scheduleOf(state))
          .then((status) => deps.dispatch({ type: "PUSH_STATUS", status }));
        return;
      }

      case "clearNotifications": {
        deps.push?.clearNotifications();
        return;
      }
    }
  };
}
