/**
 * 単語アラインメントと採点。
 *
 * 音読（認識結果 vs 原文）と並べ替え（並べた語 vs 原文）で同じ関数を通す。
 * 採点が2つあると「音読の80%」と「並べ替えの80%」が別物になり、
 * 記録に残る accuracy が後から比較できなくなる。だから1つに寄せる。
 *
 * ⚠ ここで見ているのは **語が揃っているか** だけ。
 *   発音の良し悪しは判定していない（認識器が拾えたかを見ているだけ）。
 *   画面にもそう書くこと。誇大表示は信頼を壊す。
 *
 * ⚠ フロントと Worker の両方から読まれる可能性があるので、
 *   DOM / storage / 環境時刻に触らないこと。
 */

export type TokenKind =
  /** 原文の語が答えにもあった。 */
  | "match"
  /** 別の語に置き換わっていた。 */
  | "wrong"
  /** 答えに出てこなかった。 */
  | "miss";

export interface Token {
  /** 表示に使う元の綴り（句読点つき）。 */
  raw: string;
  /** 比較に使う正規化後の綴り。 */
  norm: string;
}

export interface GradedToken {
  word: string;
  kind: TokenKind;
}

export interface Grade {
  /** 原文の語順のまま。色を重ねるのは原文の上。 */
  tokens: GradedToken[];
  matched: number;
  total: number;
  /** 一致トークン数 ÷ 原文トークン数。0〜1。 */
  accuracy: number;
}

/**
 * 比較用の正規化。
 *
 * 小文字化し、語の内側のアポストロフィだけ残して他の記号を落とす。
 * "Don't." と "dont" を別語にすると、認識器の綴りの揺れで一致率が理不尽に下がる。
 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/'/g, "");
}

/** 空白で割り、正規化後が空になる語（記号だけの塊）は落とす。 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const norm = normalizeWord(raw);
    if (norm) out.push({ raw, norm });
  }
  return out;
}

/**
 * 最長共通部分列の対応表。返すのは [原文の添字, 答えの添字] の組で、両方昇順。
 *
 * 語数は高々20程度なので素直な DP でよい。
 */
export function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  // dp[i][j] = a[i..] と b[j..] の LCS 長
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * 採点。
 *
 * 一致しなかった原文の語は、同じ位置に答えの語が居れば「誤り（赤）」、
 * 何も居なければ「欠落（灰）」。言い間違いと言い落としを混ぜない。
 */
export function grade(reference: string, hypothesis: string): Grade {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  const pairs = lcsPairs(
    ref.map((t) => t.norm),
    hyp.map((t) => t.norm),
  );

  const tokens: GradedToken[] = [];
  let prevI = -1;
  let prevJ = -1;

  const fillGap = (untilI: number, untilJ: number) => {
    // この隙間に居る答えの語の数だけ「誤り」、余りは「欠落」
    let spare = untilJ - prevJ - 1;
    for (let i = prevI + 1; i < untilI; i++) {
      tokens.push({ word: ref[i]!.raw, kind: spare > 0 ? "wrong" : "miss" });
      if (spare > 0) spare--;
    }
  };

  for (const [i, j] of pairs) {
    fillGap(i, j);
    tokens.push({ word: ref[i]!.raw, kind: "match" });
    prevI = i;
    prevJ = j;
  }
  fillGap(ref.length, hyp.length);

  const matched = pairs.length;
  const total = ref.length;
  return { tokens, matched, total, accuracy: total === 0 ? 0 : matched / total };
}
