/**
 * 設定。時間帯とライセンス表示。
 *
 * ライセンス表示は Tatoeba の CC-BY 2.0 FR の要件なので必ず置く。
 */

import { formatMinute } from "@shared/dateKey";
import { validateWindow } from "@shared/window";
import { effectiveWindow } from "@/data/settings";
import type { AppState } from "@/app/machine";
import type { ScreenModule } from "../render";
import { disposer, listen, qs, setAttr, setText, show, tmpl } from "../dom";
import { createWindowPicker } from "../windowPicker";

export const settingsScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-settings");
  const bag = disposer();

  const apply = qs<HTMLButtonElement>(frag, "[data-apply]");
  const pending = qs<HTMLElement>(frag, "[data-pending]");
  const license = qs<HTMLAnchorElement>(frag, "[data-license]");

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

  const update = (s: AppState) => {
    const p = s.settings.pending;
    show(pending, p !== null);
    if (p) {
      setText(
        pending,
        `${formatMinute(p.window.start)}〜${formatMinute(p.window.end)} に変更します。` +
          `反映は ${p.effectiveFrom} から（当日の変更で開店時刻をずらせないようにしています）`,
      );
    }
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
