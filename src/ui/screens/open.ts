/**
 * 開店中。
 *
 * 暖簾のカウントダウンは render() を通さない。
 * 数字だけを毎秒 textContent で書き換え、暖簾自体は CSS transition が持つ。
 */

import { isComplete, toAnswer, type Chip } from "@/domain/arrange";
import type { AppState, Session } from "@/app/machine";
import type { ScreenModule } from "../render";
import { disposer, el, listen, qs, setText, tmpl } from "../dom";

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const openScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-open");
  const bag = disposer();

  const countdown = qs(frag, "[data-countdown]");
  const sentenceEl = qs(frag, "[data-sentence]");
  const placedEl = qs(frag, "[data-placed]");
  const poolEl = qs(frag, "[data-pool]");
  const undoBtn = qs<HTMLButtonElement>(frag, "[data-undo]");
  const submitBtn = qs<HTMLButtonElement>(frag, "[data-submit]");

  bag.add(
    listen(undoBtn, "click", () => {
      const placed = currentSession?.arrange.placed ?? [];
      const last = placed[placed.length - 1];
      if (last) dispatch({ type: "CHIP_UNPLACE", chipId: last.id });
    }),
  );

  bag.add(
    listen(submitBtn, "click", () => {
      if (!currentSession) return;
      // Phase 1 は並べ替えのみ。採点（LCS）は Phase 2 で入る
      dispatch({
        type: "ANSWER",
        answer: toAnswer(currentSession.arrange),
        accuracy: roughAccuracy(currentSession),
      });
    }),
  );

  let currentSession: Session | null = null;
  let openedFor = "";

  /** Phase 1 の暫定採点。語順が原文と一致した割合。Phase 2 で grade() に置き換える。 */
  function roughAccuracy(session: Session): number {
    const placed = session.arrange.placed;
    const total = placed.length + session.arrange.pool.length;
    if (total === 0) return 0;
    let hit = 0;
    for (let i = 0; i < placed.length; i++) if (placed[i]!.id === i) hit++;
    return hit / total;
  }

  const renderChips = (
    host: HTMLElement,
    chips: readonly Chip[],
    onClick: (id: number) => void,
  ) => {
    host.replaceChildren();
    for (const chip of chips) {
      const btn = el("button", "chip", chip.word);
      btn.type = "button";
      btn.addEventListener("click", () => onClick(chip.id));
      host.append(btn);
    }
  };

  let chipSignature = "";

  const update = (s: AppState) => {
    const session = s.session;
    currentSession = session;
    if (!session) return;

    const key = `${session.startedAtMs}`;
    if (key !== openedFor) {
      openedFor = key;
      // 並べ替えでは英文が答えそのものなので出さない。和訳を手がかりにする
      setText(sentenceEl, session.sentence.ja);
      sentenceEl.classList.toggle("open__prompt--ja", session.mode === "arrange");
    }

    // 数字は毎秒ここだけが書き換わる。暖簾そのものは main.ts が持つ
    setText(countdown, mmss(session.endsAtMs - s.nowMs));

    // 並びが変わったときだけ組み直す（毎秒のティックで作り直さない）
    const sig = `${session.arrange.placed.map((c) => c.id).join(",")}|${session.arrange.pool
      .map((c) => c.id)
      .join(",")}`;
    if (sig !== chipSignature) {
      chipSignature = sig;
      renderChips(placedEl, session.arrange.placed, (id) =>
        dispatch({ type: "CHIP_UNPLACE", chipId: id }),
      );
      renderChips(poolEl, session.arrange.pool, (id) =>
        dispatch({ type: "CHIP_PLACE", chipId: id }),
      );
      undoBtn.disabled = session.arrange.placed.length === 0;
      submitBtn.disabled = !isComplete(session.arrange);
    }
  };

  root.append(frag);
  update(state);

  return { update, destroy: () => bag.dispose() };
};
