/** 初回設定。時間帯を選ぶ。 */
import { validateWindow } from "@shared/window";
import type { ScreenModule } from "../render";
import { disposer, listen, qs, tmpl } from "../dom";
import { createWindowPicker } from "../windowPicker";

export const onboardingScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-onboarding");
  const next = qs<HTMLButtonElement>(frag, "[data-next]");
  const picker = createWindowPicker(frag, state.settings.window);
  const bag = disposer();

  picker.onChange((_w, valid) => {
    next.disabled = !valid;
  });

  bag.add(
    listen(next, "click", () => {
      const w = picker.value();
      if (!validateWindow(w).ok) return;
      dispatch({ type: "ONBOARDING_DONE", window: w });
    }),
  );

  root.append(frag);

  return {
    update() {},
    destroy() {
      bag.dispose();
      picker.destroy();
    },
  };
};
