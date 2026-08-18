/**
 * 結果。3秒後に自動で閉店中へ戻り、暖簾が上がる。「もう一度」は無い。
 */

import type { AppState } from "@/app/machine";
import type { ScreenModule } from "../render";
import { qs, setText, show, tmpl } from "../dom";

const AUTO_DISMISS_MS = 3000;

export const resultScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-result");
  const sentence = qs(frag, "[data-sentence]");
  const score = qs(frag, "[data-score]");
  const ja = qs(frag, "[data-ja]");
  const honest = qs<HTMLElement>(frag, "[data-honest]");

  const apply = (s: AppState) => {
    const o = s.outcome;
    if (!o) return;
    setText(sentence, o.sentence.en);
    setText(ja, o.sentence.ja);
    setText(
      score,
      o.timedOut ? "時間切れ" : `${Math.round(o.accuracy * 100)}%`,
    );
    // 音読で解いたときだけ。並べ替えの判定は認識器と関係ない
    show(honest, !o.timedOut && o.mode === "speak");
  };

  root.append(frag);
  apply(state);

  const timer = setTimeout(() => dispatch({ type: "RESULT_DISMISSED" }), AUTO_DISMISS_MS);

  return {
    update: apply,
    destroy: () => clearTimeout(timer),
  };
};
