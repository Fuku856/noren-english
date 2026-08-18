/**
 * 時間帯ピッカー。初回設定と設定画面で同じものを使う。
 *
 * 60〜360分の制約と、04:00 JST をまたげない制約を、選べる選択肢の側で表現する。
 * 選んでから怒られるのではなく、選べないようにする。
 */

import { formatMinute } from "@shared/dateKey";
import { validateWindow, windowLength, type TimeWindow } from "@shared/window";
import { qs, setText, toggle } from "./dom";

const LENGTHS = [60, 90, 120, 180, 240, 300, 360];
const START_STEP = 30;

const REASONS: Record<string, string> = {
  too_short: "60分より短くはできません",
  too_long: "6時間より長くはできません",
  crosses_day_start: "午前4時をまたぐ時間帯は選べません",
  out_of_range: "時刻が正しくありません",
};

export interface WindowPicker {
  value(): TimeWindow;
  set(w: TimeWindow): void;
  onChange(fn: (w: TimeWindow, valid: boolean) => void): void;
  destroy(): void;
}

export function createWindowPicker(root: ParentNode, initial: TimeWindow): WindowPicker {
  const startSel = qs<HTMLSelectElement>(root, "[data-start]");
  const lenSel = qs<HTMLSelectElement>(root, "[data-length]");
  const hint = qs(root, "[data-hint]");

  for (let m = 0; m < 1440; m += START_STEP) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = formatMinute(m);
    startSel.append(opt);
  }

  for (const len of LENGTHS) {
    const opt = document.createElement("option");
    opt.value = String(len);
    opt.textContent = len < 60 ? `${len}分` : `${len / 60}時間`;
    lenSel.append(opt);
  }

  let listener: ((w: TimeWindow, valid: boolean) => void) | null = null;

  const read = (): TimeWindow => {
    const start = Number(startSel.value);
    const len = Number(lenSel.value);
    return { start, end: (start + len) % 1440 };
  };

  const refresh = () => {
    const w = read();
    const check = validateWindow(w);
    const ok = check.ok;

    setText(
      hint,
      ok
        ? `${formatMinute(w.start)} 〜 ${formatMinute(w.end)} のどこかで開きます`
        : (REASONS[check.reason] ?? "この時間帯は選べません"),
    );
    toggle(hint, "field__hint--bad", !ok);
    listener?.(w, ok);
  };

  const onInput = () => refresh();
  startSel.addEventListener("change", onInput);
  lenSel.addEventListener("change", onInput);

  const setValue = (w: TimeWindow) => {
    startSel.value = String(Math.round(w.start / START_STEP) * START_STEP);
    const len = windowLength(w);
    const nearest = LENGTHS.reduce((a, b) =>
      Math.abs(b - len) < Math.abs(a - len) ? b : a,
    );
    lenSel.value = String(nearest);
    refresh();
  };

  setValue(initial);

  return {
    value: read,
    set: setValue,
    onChange(fn) {
      listener = fn;
      refresh();
    },
    destroy() {
      startSel.removeEventListener("change", onInput);
      lenSel.removeEventListener("change", onInput);
      listener = null;
    },
  };
}
