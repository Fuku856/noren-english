/**
 * 端末が音読モードを回せるかの判定。
 *
 * ⚠ 音読は「動かない前提」で組む。Firefox は SpeechRecognition 未対応、
 *   iOS Safari はバージョンで挙動が違う。**並べ替えが常に動けばアプリは成立する**ので、
 *   ここが false を返したときに詰まる経路を作らないこと。
 */

import { fakeStt } from "@/dev/fakeStt";

interface SpeechWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/** マイクで聞き取れるか。 */
export function canRecognizeSpeech(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as SpeechWindow;
  return (
    typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === "function" &&
    // http://192.168.x.x では getUserMedia ごと落ちる。実機確認は https で
    window.isSecureContext
  );
}

/** 読み上げられるか。聞き取りより対応は広い。 */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 音読モードを選ばせてよいか。聞き取れなければ選ばせない。
 *
 * dev のみ：マイクを模擬しているあいだは、非対応のブラウザでも音読を選ばせる。
 * そうしないと Firefox や https でない環境で音読の画面を一度も開けない。
 */
export function canUseSpeakMode(): boolean {
  if (import.meta.env.DEV && fakeStt() !== "real") return true;
  return canRecognizeSpeech();
}
