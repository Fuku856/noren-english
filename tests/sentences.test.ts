import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addDays } from "@shared/dateKey";
import {
  normalizeDb,
  pickSentenceId,
  TIER_PATTERN,
  tierFor,
  tierOccurrence,
  type SentenceDb,
} from "@/domain/sentences";
import { permutation, shuffled } from "@/domain/random";

const db: SentenceDb = normalizeDb(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../public/data/sentences.v1.json", import.meta.url)),
      "utf8",
    ),
  ),
);

const START = "2026-01-01";
const keys = (n: number, from = START) =>
  Array.from({ length: n }, (_, i) => addDays(from, i));

describe("permutation", () => {
  it("同じ seed なら常に同じ並び", () => {
    expect([...permutation(50, "a")]).toEqual([...permutation(50, "a")]);
  });

  it("seed が違えば並びが変わる", () => {
    expect([...permutation(50, "a")]).not.toEqual([...permutation(50, "b")]);
  });

  it("0..n-1 をちょうど1回ずつ含む", () => {
    const p = [...permutation(500, "seed")];
    expect(new Set(p).size).toBe(500);
    expect(Math.min(...p)).toBe(0);
    expect(Math.max(...p)).toBe(499);
  });

  it("shuffled は元の配列を壊さない", () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffled(src, "s");
    expect(src).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(src);
  });
});

describe("難易度の巡回", () => {
  it("6日周期で 中学3 / 高1高2 2 / 高3 1", () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const k of keys(6)) counts[tierFor(k)]++;
    expect(counts).toEqual({ 1: 3, 2: 2, 3: 1 });
  });

  it("パターン通りの順に出る", () => {
    expect(keys(12).map(tierFor)).toEqual([...TIER_PATTERN, ...TIER_PATTERN]);
  });

  it("tierOccurrence は同じ難易度の中で 0 から連番になる", () => {
    const seen: Record<number, number[]> = { 1: [], 2: [], 3: [] };
    for (const k of keys(60)) seen[tierFor(k)]!.push(tierOccurrence(k));
    for (const t of [1, 2, 3] as const) {
      expect(seen[t]).toEqual(seen[t]!.map((_, i) => i));
    }
  });
});

describe("pickSentenceId", () => {
  it("同じ日なら常に同じ文（リロードで変わらない）", () => {
    for (const k of keys(30)) {
      const first = pickSentenceId(db, k);
      expect(pickSentenceId(db, k)).toBe(first);
      expect(pickSentenceId(db, k)).toBe(first);
    }
  });

  it("必ずその日の難易度の文が出る", () => {
    for (const k of keys(120)) {
      const s = db.sentences[pickSentenceId(db, k)]!;
      expect(s.tier).toBe(tierFor(k));
    }
  });

  it("500日間 重複しない", () => {
    const ids = keys(500).map((k) => pickSentenceId(db, k));
    expect(new Set(ids).size).toBe(500);
  });

  it("最も枚数の少ない難易度でも1周ぶん重複しない", () => {
    // 高3 は250文 × 6日に1回 = 1500日
    const ids = keys(1500)
      .filter((k) => tierFor(k) === 3)
      .map((k) => pickSentenceId(db, k));
    expect(ids.length).toBe(250);
    expect(new Set(ids).size).toBe(250);
  });

  it("1周を超えると同じ集合を別の並びで巡り直す", () => {
    // 高3 は6日に1回なので、2周ぶんには 250 × 2 × 6 = 3000 日かかる
    const all = keys(3000)
      .filter((k) => tierFor(k) === 3)
      .map((k) => pickSentenceId(db, k));
    expect(all.length).toBe(500);

    const first = all.slice(0, 250);
    const second = all.slice(250);

    // 巡る集合は同じ
    expect(new Set(second)).toEqual(new Set(first));
    // 並びは違う（毎周まったく同じ順だと3年目に既視感が出る）
    expect(second).not.toEqual(first);
  });

  it("salt に依存しない（全世界で同じ1文）", () => {
    // pickSentenceId は salt を引数に取らない。型で保証されているが、
    // 将来うっかり足されないよう呼び出し形を固定しておく
    expect(pickSentenceId.length).toBe(2);
  });

  it("過去の日付でも動く", () => {
    expect(pickSentenceId(db, "2025-06-15")).toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeDb", () => {
  it("配列の添字が id になっている", () => {
    for (let i = 0; i < 20; i++) expect(db.sentences[i]!.id).toBe(i);
  });

  it("byTier の合計が全件と一致する", () => {
    const total = db.byTier[1].length + db.byTier[2].length + db.byTier[3].length;
    expect(total).toBe(db.sentences.length);
  });

  it("ライセンス情報を保っている", () => {
    expect(db.license).toBe("CC-BY 2.0 FR");
    expect(db.tierLabels[1]).toBe("中学");
  });
});
