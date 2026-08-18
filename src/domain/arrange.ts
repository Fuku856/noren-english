/**
 * モードB：並べ替え。
 *
 * 声が出せないときの選択肢であると同時に、SpeechRecognition 非対応端末での
 * フォールバックでもある。**モードBが常に動けば、どの端末でもアプリは成立する。**
 * だから Phase 1 ではこちらだけを作る。
 */

import { shuffled } from "./random";

export interface Chip {
  /** 元の語順での位置。採点では使わないが、DOM のキーとして要る。 */
  id: number;
  word: string;
}

export interface ArrangeState {
  /** まだ置いていない語。 */
  pool: Chip[];
  /** 置いた語（左から順）。 */
  placed: Chip[];
}

/** 英文を語に割る。句読点は語にくっつけたまま出す（読みやすさのため）。 */
export function splitWords(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean);
}

/**
 * 並べ替えの初期状態。
 * シャッフルは日付から決まるので、リロードしても並びが変わらない。
 * 偶然そのまま正解の並びになった場合は種を変えて引き直す。
 */
export function createArrange(sentence: string, seed: string): ArrangeState {
  const words = splitWords(sentence);
  const chips: Chip[] = words.map((word, id) => ({ id, word }));

  let pool = shuffled(chips, seed);
  for (let attempt = 1; attempt < 5 && isOrdered(pool); attempt++) {
    pool = shuffled(chips, `${seed}#${attempt}`);
  }

  return { pool, placed: [] };
}

function isOrdered(chips: readonly Chip[]): boolean {
  return chips.length > 1 && chips.every((c, i) => c.id === i);
}

/** プールから1枚置く。 */
export function place(state: ArrangeState, chipId: number): ArrangeState {
  const chip = state.pool.find((c) => c.id === chipId);
  if (!chip) return state;
  return {
    pool: state.pool.filter((c) => c.id !== chipId),
    placed: [...state.placed, chip],
  };
}

/** 置いた語を戻す。プールでの位置は元の並びを保つ。 */
export function unplace(state: ArrangeState, chipId: number): ArrangeState {
  const chip = state.placed.find((c) => c.id === chipId);
  if (!chip) return state;
  return {
    pool: [...state.pool, chip],
    placed: state.placed.filter((c) => c.id !== chipId),
  };
}

/** 最後の1枚を戻す。 */
export function undo(state: ArrangeState): ArrangeState {
  const last = state.placed[state.placed.length - 1];
  return last ? unplace(state, last.id) : state;
}

export function isComplete(state: ArrangeState): boolean {
  return state.pool.length === 0;
}

/**
 * 採点に渡す文字列。
 * 音読モードと同じ grade() を通すので、実装は1つで済む。
 * 時間切れで途中でも、その時点の並びをそのまま出す。
 */
export function toAnswer(state: ArrangeState): string {
  return state.placed.map((c) => c.word).join(" ");
}
