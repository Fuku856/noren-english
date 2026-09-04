/**
 * 読み上げ。開いた瞬間に一度、あとは「もう一度聞く」で鳴らす。
 *
 * 失敗しても黙って諦める。音が出ないことでセッションが止まってはいけない。
 */

import { canSpeak } from "./capabilities";

export function speakEnglish(text: string): void {
  if (!canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    // 真似られる速さに落とす。既定の 1 は音読の手本としては速い
    u.rate = 0.9;
    // 前の読み上げが残っていると重なって聞こえる
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // 読み上げは補助。出なくても問題は解ける
  }
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // no-op
  }
}
