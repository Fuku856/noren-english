/**
 * 開店中。
 *
 * 暖簾のカウントダウンは render() を通さない。
 * 数字だけを毎秒 textContent で書き換え、暖簾自体は CSS transition が持つ。
 *
 * モードは2つあるが、盤面（並べ替え）はモードに関わらず用意されている。
 * 音読が途中で使えなくなっても、その場で並べ替えに切り替えて解き終えられる。
 */

import { isComplete, toAnswer, type Chip } from "@/domain/arrange";
import type { AppState, Session } from "@/app/machine";
import { canRecognizeSpeech } from "@/speech/capabilities";
import {
  createRecognizer,
  isStructuralFailure,
  type Recognizer,
  type SttFailure,
} from "@/speech/stt";
import { speakEnglish, stopSpeaking } from "@/speech/tts";
import { fakeStt, nearMiss } from "@/dev/fakeStt";
import type { ScreenModule } from "../render";
import { disposer, el, listen, qs, setText, show, tmpl } from "../dom";

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 一時的な失敗。同じ画面でもう一度どうぞ。 */
const RETRY_TEXT: Record<SttFailure, string> = {
  denied: "",
  unavailable: "",
  "no-speech": "聞き取れませんでした。もう一度どうぞ。",
  failed: "うまく聞き取れませんでした。もう一度どうぞ。",
};

/**
 * 構造的な失敗。**その場で並べ替えに切り替える**。
 *
 * マイクが塞がれている端末で音読の画面に留めると、開いた5分がそのまま消える。
 * 音読が動かなくてもアプリが成立することがこの設計の前提なので、
 * 利用者に切り替えを探させない。
 */
const FALLBACK_TEXT: Record<SttFailure, string> = {
  denied: "マイクが使えなかったので、並べ替えに切り替えました。",
  unavailable: "マイクが見つからなかったので、並べ替えに切り替えました。",
  "no-speech": "",
  failed: "",
};

export const openScreen: ScreenModule = (root, state, dispatch) => {
  const frag = tmpl("tpl-open");
  const bag = disposer();

  const countdown = qs(frag, "[data-countdown]");
  const sentenceEl = qs(frag, "[data-sentence]");

  const arrangePane = qs<HTMLElement>(frag, "[data-arrange]");
  const placedEl = qs(frag, "[data-placed]");
  const poolEl = qs(frag, "[data-pool]");
  const undoBtn = qs<HTMLButtonElement>(frag, "[data-undo]");
  const submitBtn = qs<HTMLButtonElement>(frag, "[data-submit]");

  const noticeEl = qs<HTMLElement>(frag, "[data-notice]");
  const speakPane = qs<HTMLElement>(frag, "[data-speak]");
  const heardEl = qs(frag, "[data-heard]");
  const micBtn = qs<HTMLButtonElement>(frag, "[data-mic]");
  const replayBtn = qs<HTMLButtonElement>(frag, "[data-replay]");
  const toArrangeBtn = qs<HTMLButtonElement>(frag, "[data-to-arrange]");

  let currentSession: Session | null = null;
  let openedFor = "";
  let chipSignature = "";
  let listening = false;
  /** 音読から落ちてきた理由。並べ替えの画面に出す。 */
  let fallbackNotice = "";

  // ---------------------------------------------------------------- 並べ替え

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
      dispatch({ type: "ANSWER", answer: toAnswer(currentSession.arrange) });
    }),
  );

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

  // ---------------------------------------------------------------- 音読

  const setListening = (on: boolean) => {
    listening = on;
    setText(micBtn, on ? "聞いています" : "話す");
    micBtn.classList.toggle("btn--listening", on);
  };

  const onFailure = (reason: SttFailure) => {
    if (isStructuralFailure(reason)) {
      // 切り替えは待たせない。理由は切り替えた先で伝える。
      // 設定は書き換えない（今日の逃げ道であって、普段の希望ではない）
      fallbackNotice = FALLBACK_TEXT[reason];
      dispatch({ type: "SESSION_MODE_SET", mode: "arrange" });
      return;
    }
    setText(heardEl, RETRY_TEXT[reason]);
  };

  const recognizer: Recognizer | null = canRecognizeSpeech()
    ? createRecognizer({
        onResult(text) {
          setText(heardEl, text);
          dispatch({ type: "ANSWER", answer: text });
        },
        onFailure,
        onEnd() {
          setListening(false);
        },
      })
    : null;

  bag.add(
    listen(micBtn, "click", () => {
      // dev のみ：マイクを模擬する。実機の無い環境でも音読の経路を通せる
      if (import.meta.env.DEV && currentSession) {
        const fake = fakeStt();
        if (fake === "deny") {
          onFailure("denied");
          return;
        }
        if (fake === "exact" || fake === "near") {
          const heard =
            fake === "exact"
              ? currentSession.sentence.en
              : nearMiss(currentSession.sentence.en);
          setText(heardEl, heard);
          dispatch({ type: "ANSWER", answer: heard });
          return;
        }
      }

      if (!recognizer) {
        // 音読が使えない端末に音読モードで来てしまった。詰まらせない
        fallbackNotice = FALLBACK_TEXT.unavailable;
        dispatch({ type: "SESSION_MODE_SET", mode: "arrange" });
        return;
      }
      if (listening) {
        recognizer.stop();
        return;
      }
      // 読み上げが鳴っている最中に聞き取ると自分の声を拾う
      stopSpeaking();
      setText(heardEl, "");
      setListening(true);
      recognizer.start();
    }),
  );

  bag.add(
    listen(replayBtn, "click", () => {
      if (!currentSession) return;
      if (listening) recognizer?.stop();
      speakEnglish(currentSession.sentence.en);
    }),
  );

  bag.add(
    listen(toArrangeBtn, "click", () => {
      recognizer?.stop();
      stopSpeaking();
      // 今回だけ。設定の希望は設定画面でしか変えない
      dispatch({ type: "SESSION_MODE_SET", mode: "arrange" });
    }),
  );

  // ---------------------------------------------------------------- 更新

  const update = (s: AppState) => {
    const session = s.session;
    currentSession = session;
    if (!session) return;

    const speak = session.mode === "speak";
    const key = `${session.startedAtMs}|${session.mode}`;
    if (key !== openedFor) {
      openedFor = key;
      // 音読は英文が問題そのもの。並べ替えでは英文が答えなので和訳を手がかりにする
      setText(sentenceEl, speak ? session.sentence.en : session.sentence.ja);
      sentenceEl.classList.toggle("prompt--ja", !speak);
      sentenceEl.classList.toggle("prompt--en", speak);
      show(arrangePane, !speak);
      show(speakPane, speak);
      if (speak) {
        setText(heardEl, "聞こえたとおりに読んでください");
        fallbackNotice = "";
        show(noticeEl, false);
      } else {
        if (listening) recognizer?.stop();
        setText(noticeEl, fallbackNotice);
        show(noticeEl, fallbackNotice.length > 0);
      }
    }

    // 数字は毎秒ここだけが書き換わる。暖簾そのものは main.ts が持つ
    const remaining = session.endsAtMs - s.nowMs;
    setText(countdown, mmss(remaining));
    countdown.classList.toggle("countdown--last", remaining <= 60_000);

    if (speak) return;

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

  return {
    update,
    destroy: () => {
      recognizer?.dispose();
      stopSpeaking();
      bag.dispose();
    },
  };
};
