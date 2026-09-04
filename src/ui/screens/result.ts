/**
 * 結果。3秒後に自動で閉店中へ戻る。「もう一度」は無い。
 *
 * 出すのは原文・一致率・和訳だけ。間違えた語は原文の上に色で重ねる。
 * 「間違えた問題の一覧」は作らない（達成感が反省に上書きされる）。
 */

import type { GradedToken } from "@shared/align";
import type { AppState, Outcome } from "@/app/machine";
import type { ScreenModule } from "../render";
import { el, qs, setText, show, tmpl } from "../dom";

const AUTO_DISMISS_MS = 3000;

/** 色だけに頼らない。下線の種類でも区別する（screens.css の .tok--*）。 */
const CLASS: Record<GradedToken["kind"], string> = {
  match: "tok tok--match",
  wrong: "tok tok--wrong",
  miss: "tok tok--miss",
};

const LABEL: Record<GradedToken["kind"], string> = {
  match: "",
  wrong: "（別の語）",
  miss: "（言えなかった語）",
};

/**
 * 帯の見た目と一言。
 *
 * 大げさに褒めない。合っていた語の割合を言い換えているだけで、
 * それ以上の意味を持たせない（誇張は翌日の期待を壊す）。
 */
function verdictOf(o: Outcome): { text: string; modifier: string } {
  if (o.timedOut) return { text: "時間切れ", modifier: "" };
  if (o.accuracy >= 1) return { text: "そのまま言えました", modifier: "band--correct" };
  if (o.accuracy >= 0.8) return { text: "ほとんど合っています", modifier: "band--correct" };
  if (o.accuracy >= 0.5) return { text: "半分は届きました", modifier: "band--partial" };
  return { text: "また明日", modifier: "" };
}

function renderTokens(host: Element, tokens: readonly GradedToken[]): void {
  host.replaceChildren();
  tokens.forEach((t, i) => {
    if (i > 0) host.append(document.createTextNode(" "));
    const span = el("span", CLASS[t.kind], t.word);
    // 読み上げソフトには色が見えない
    if (LABEL[t.kind]) {
      const note = el("span", "visually-hidden", LABEL[t.kind]);
      span.append(note);
    }
    host.append(span);
  });
}

export const resultScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-result");
  const sentence = qs(frag, "[data-sentence]");
  const answer = qs<HTMLElement>(frag, "[data-answer]");
  const answerLabel = qs(frag, "[data-answer-label]");
  const answerText = qs(frag, "[data-answer-text]");
  const band = qs<HTMLElement>(frag, "[data-band]");
  const verdict = qs(frag, "[data-verdict]");
  const score = qs(frag, "[data-score]");
  const ja = qs(frag, "[data-ja]");
  const honest = qs<HTMLElement>(frag, "[data-honest]");

  let renderedFor = "";

  const apply = (s: AppState) => {
    const o = s.outcome;
    if (!o) return;

    const key = `${o.sentence.id}|${o.answer}`;
    if (key !== renderedFor) {
      renderedFor = key;
      renderTokens(sentence, o.graded.tokens);
    }

    // 自分が何と答えたか。原文と見比べられないと答え合わせにならない。
    // 音読は「言ったこと」ではなく「認識器が聞き取ったこと」なので、そう書く
    const said = o.answer.trim();
    show(answer, said.length > 0);
    if (said.length > 0) {
      setText(answerLabel, o.mode === "speak" ? "聞き取れた文" : "あなたの答え");
      setText(answerText, said);
    }

    const v = verdictOf(o);
    band.className = v.modifier ? `band ${v.modifier}` : "band";
    setText(verdict, v.text);
    setText(score, o.timedOut ? "—" : `${Math.round(o.accuracy * 100)}%`);
    setText(ja, o.sentence.ja);
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
