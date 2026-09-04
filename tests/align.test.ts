import { describe, expect, it } from "vitest";
import { grade, lcsPairs, normalizeWord, tokenize } from "@shared/align";

const kinds = (ref: string, hyp: string) => grade(ref, hyp).tokens.map((t) => t.kind);

describe("normalizeWord", () => {
  it("小文字化し句読点を落とす", () => {
    expect(normalizeWord("Hour.")).toBe("hour");
    expect(normalizeWord("“waiting,”")).toBe("waiting");
  });

  it("アポストロフィの揺れを吸収する", () => {
    expect(normalizeWord("Don't")).toBe(normalizeWord("dont"));
    expect(normalizeWord("it’s")).toBe(normalizeWord("its"));
  });

  it("記号だけの語は空になる", () => {
    expect(normalizeWord("—")).toBe("");
  });
});

describe("tokenize", () => {
  it("表示用の綴りを保つ", () => {
    expect(tokenize("She has been.").map((t) => t.raw)).toEqual(["She", "has", "been."]);
  });

  it("記号だけの塊は落とす", () => {
    expect(tokenize("a — b").map((t) => t.norm)).toEqual(["a", "b"]);
  });
});

describe("lcsPairs", () => {
  it("空を渡しても落ちない", () => {
    expect(lcsPairs([], ["a"])).toEqual([]);
    expect(lcsPairs(["a"], [])).toEqual([]);
  });

  it("共通部分列を昇順で返す", () => {
    expect(lcsPairs(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });

  it("最長を選ぶ", () => {
    expect(lcsPairs(["a", "b", "c", "d"], ["b", "c"])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});

describe("grade", () => {
  it("完全一致は 100%", () => {
    const g = grade("She has been waiting for an hour.", "she has been waiting for an hour");
    expect(g.accuracy).toBe(1);
    expect(g.tokens.every((t) => t.kind === "match")).toBe(true);
  });

  it("一致率は原文の語数が分母", () => {
    const g = grade("a b c d", "a b");
    expect(g.matched).toBe(2);
    expect(g.total).toBe(4);
    expect(g.accuracy).toBe(0.5);
  });

  it("言い間違いは誤り、言い落としは欠落", () => {
    // for → four の言い間違い
    expect(kinds("waiting for an hour", "waiting four an hour")).toEqual([
      "match",
      "wrong",
      "match",
      "match",
    ]);
    // for を言い落とした
    expect(kinds("waiting for an hour", "waiting an hour")).toEqual([
      "match",
      "miss",
      "match",
      "match",
    ]);
  });

  it("答えが空なら全部欠落で 0%", () => {
    const g = grade("a b c", "");
    expect(g.accuracy).toBe(0);
    expect(kinds("a b c", "")).toEqual(["miss", "miss", "miss"]);
  });

  it("原文が空でも 0 で返る（0除算しない）", () => {
    expect(grade("", "anything").accuracy).toBe(0);
  });

  it("表示用の綴りは原文のまま返る", () => {
    expect(grade("She has been.", "she has").tokens.map((t) => t.word)).toEqual([
      "She",
      "has",
      "been.",
    ]);
  });

  it("並べ替えの語順違いを部分点にする", () => {
    // 3語のうち順番どおりに繋がるのは2語まで
    const g = grade("a b c", "a c b");
    expect(g.matched).toBe(2);
  });

  it("余分に喋っても原文の語が揃っていれば減点しない", () => {
    expect(grade("a b", "a and b").accuracy).toBe(1);
  });
});
