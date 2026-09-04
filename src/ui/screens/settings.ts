/**
 * 設定。時間帯・出題のしかた・記録の控え・ライセンス表示。
 *
 * ライセンス表示は Tatoeba の CC-BY 2.0 FR の要件なので必ず置く。
 *
 * 「読み込む」は記録を上書きする唯一の操作なので、
 * 何で上書きするのかを見せてから確認を取る。
 */

import { formatMinute } from "@shared/dateKey";
import { validateWindow } from "@shared/window";
import { effectiveWindow } from "@/data/settings";
import { applyBackup, backupFilename, backupSummary, buildBackup, parseBackup } from "@/data/transfer";
import { canUseSpeakMode } from "@/speech/capabilities";
import type { AppState } from "@/app/machine";
import type { Mode } from "@/data/schema";
import type { ScreenModule } from "../render";
import { disposer, listen, qs, setAttr, setText, show, tmpl } from "../dom";
import { downloadJson, readJsonFile } from "../download";
import { createWindowPicker } from "../windowPicker";

export const settingsScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-settings");
  const bag = disposer();

  const apply = qs<HTMLButtonElement>(frag, "[data-apply]");
  const pending = qs<HTMLElement>(frag, "[data-pending]");
  const license = qs<HTMLAnchorElement>(frag, "[data-license]");

  const modeSelect = qs<HTMLSelectElement>(frag, "[data-mode]");
  const modeHint = qs(frag, "[data-mode-hint]");
  const speakOption = qs<HTMLOptionElement>(frag, '[data-mode] option[value="speak"]');

  const exportBtn = qs<HTMLButtonElement>(frag, "[data-export]");
  const importBtn = qs<HTMLButtonElement>(frag, "[data-import]");
  const importFile = qs<HTMLInputElement>(frag, "[data-import-file]");
  const transferHint = qs(frag, "[data-transfer-hint]");

  let current = state;

  const picker = createWindowPicker(frag, effectiveWindow(state.settings, state.todayKey));
  picker.onChange((_w, valid) => {
    apply.disabled = !valid;
  });

  bag.add(
    listen(qs<HTMLButtonElement>(frag, "[data-back]"), "click", () =>
      dispatch({ type: "NAVIGATE", screen: "closed" }),
    ),
  );

  bag.add(
    listen(qs<HTMLButtonElement>(frag, "[data-install-guide]"), "click", () =>
      dispatch({ type: "NAVIGATE", screen: "install" }),
    ),
  );

  bag.add(
    listen(apply, "click", () => {
      const w = picker.value();
      if (!validateWindow(w).ok) return;
      dispatch({ type: "WINDOW_REQUESTED", window: w });
    }),
  );

  // ---------------------------------------------------------------- 出題のしかた

  // 聞き取れない端末で音読を選ばせない。選べてしまうと開店した5分が丸ごと無駄になる
  const speakAvailable = canUseSpeakMode();
  speakOption.disabled = !speakAvailable;
  setText(
    modeHint,
    speakAvailable
      ? "音読は、聞き取れた語だけを見ています。発音の良し悪しは判定していません。"
      : "この端末は音声認識に対応していないため、並べ替えのみになります。",
  );

  bag.add(
    listen(modeSelect, "change", () => {
      const mode: Mode = modeSelect.value === "speak" ? "speak" : "arrange";
      dispatch({ type: "MODE_SET", mode });
    }),
  );

  // ---------------------------------------------------------------- 記録の控え

  bag.add(
    listen(exportBtn, "click", () => {
      const backup = buildBackup({
        nowMs: current.nowMs,
        salt: current.salt,
        settings: current.settings,
        records: current.records,
        tickets: current.tickets,
        milestones: current.milestones,
      });
      downloadJson(backupFilename(current.todayKey), backup);
      setText(transferHint, "書き出しました。このファイルが記録の控えになります。");
    }),
  );

  bag.add(listen(importBtn, "click", () => importFile.click()));

  bag.add(
    listen(importFile, "change", () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (!file) return;

      void readJsonFile(file)
        .then((raw) => {
          const backup = parseBackup(raw);
          if (!backup) {
            setText(transferHint, "このファイルは のれん の控えではないようです。");
            return;
          }
          const ok = window.confirm(
            `${backupSummary(backup)}で、いまの記録を上書きします。\n` +
              "この操作は取り消せません。続けますか？",
          );
          if (!ok) {
            setText(transferHint, "読み込みをやめました。記録はそのままです。");
            return;
          }
          applyBackup(backup);
          // 状態を全部差し替えるので、途中から繋ぎ直すより読み込み直す方が確実
          window.location.reload();
        })
        .catch(() => {
          setText(transferHint, "ファイルを読めませんでした。");
        });
    }),
  );

  // ---------------------------------------------------------------- 更新

  const update = (s: AppState) => {
    current = s;

    const p = s.settings.pending;
    show(pending, p !== null);
    if (p) {
      setText(
        pending,
        `${formatMinute(p.window.start)}〜${formatMinute(p.window.end)} に変更します。` +
          `反映は ${p.effectiveFrom} から（当日の変更で開店時刻をずらせないようにしています）`,
      );
    }

    const mode: Mode = s.settings.mode === "speak" && speakAvailable ? "speak" : "arrange";
    if (modeSelect.value !== mode) modeSelect.value = mode;

    if (s.db) setAttr(license, "href", s.db.licenseUrl);
  };

  root.append(frag);
  update(state);

  return {
    update,
    destroy() {
      bag.dispose();
      picker.destroy();
    },
  };
};
