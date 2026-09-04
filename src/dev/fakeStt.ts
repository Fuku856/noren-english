/**
 * 聞き取りの模擬。**dev ビルドでのみ効く。**
 *
 * マイクの無い端末・許可を出せない環境・SpeechRecognition 非対応のブラウザでも
 * 音読モードの経路を最後まで通せるようにする。
 * 1日1回しか開かないアプリで、実マイク頼みの検証を毎日待つのは現実的でない。
 *
 * 「拒否」を選べば、マイクを塞がれたときの並べ替えへの切り替えも確かめられる。
 */

const KEY = "noren:debug:stt";

export type FakeStt =
  /** 実機の SpeechRecognition を使う。 */
  | "real"
  /** 原文どおり聞き取れた（100%）。 */
  | "exact"
  /** 1語だけ違って聞き取れた。色分けの確認用。 */
  | "near"
  /** マイクが拒否された。並べ替えへ落ちるかの確認用。 */
  | "deny";

const ORDER: readonly FakeStt[] = ["real", "exact", "near", "deny"];

export const FAKE_STT_LABEL: Record<FakeStt, string> = {
  real: "実機",
  exact: "そのまま",
  near: "1語違い",
  deny: "拒否",
};

export function fakeStt(): FakeStt {
  if (!import.meta.env.DEV) return "real";
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.find((o) => o === v) ?? "real";
  } catch {
    return "real";
  }
}

export function cycleFakeStt(): FakeStt {
  const next = ORDER[(ORDER.indexOf(fakeStt()) + 1) % ORDER.length]!;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 保存できなくてもこのセッション中は効かないだけ
  }
  return next;
}

/** 「1語違い」で返す文。最後の語を別の語に置き換える。 */
export function nearMiss(sentence: string): string {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return sentence;
  words[words.length - 1] = "something.";
  return words.join(" ");
}
