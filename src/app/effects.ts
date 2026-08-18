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
import type { AppState, Effect } from "./machine";
import type { Dispatch } from "./store";

export interface NorenHandle {
  open(endsAtMs: number, totalMs: number, nowMs: number): void;
  close(): void;
}

export interface EffectDeps {
  dispatch: Dispatch;
  now: () => number;
  noren: NorenHandle | null;
  speak?: (text: string) => void;
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

      case "norenOpen": {
        deps.noren?.open(effect.endsAtMs, effect.totalMs, deps.now());
        return;
      }

      case "norenClose": {
        clearExpiry();
        deps.noren?.close();
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
    }
  };
}
