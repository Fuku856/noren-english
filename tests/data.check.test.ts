/**
 * コミット済みの例文JSONそのものを検証する。
 *
 * 生成スクリプトのテストではなく、**実際に配信される成果物** のテスト。
 * これがあることで「理論上は再現できる」が「実際に壊れていない」になる。
 *
 *   npm run data:check
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface SentenceRow {
  t: 1 | 2 | 3;
  e: string;
  j: string;
  a: string;
}

interface SentenceDb {
  version: number;
  source: string;
  license: string;
  licenseUrl: string;
  generatedAt: string;
  tiers: Record<string, string>;
  count: number;
  s: SentenceRow[];
}

const db: SentenceDb = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../public/data/sentences.v1.json", import.meta.url)),
    "utf8",
  ),
);

const WORD_RE = /[A-Za-z']+/g;
const KANA = /[぀-ゟ゠-ヿ]/;
const words = (s: string) => s.match(WORD_RE) ?? [];

describe("メタデータ", () => {
  it("count が実際の件数と一致する", () => {
    expect(db.count).toBe(db.s.length);
  });

  it("1000文ある（3年分）", () => {
    expect(db.s.length).toBe(1000);
  });

  it("ライセンス表示がある（設定画面に出す義務がある）", () => {
    expect(db.license).toBe("CC-BY 2.0 FR");
    expect(db.licenseUrl).toMatch(/^https:\/\//);
    expect(db.source).toBe("tatoeba");
  });

  it("難易度のラベルが 中学 / 高1・高2 / 高3 である", () => {
    expect(db.tiers).toEqual({ "1": "中学", "2": "高1・高2", "3": "高3" });
  });
});

describe("英文", () => {
  it("すべて 5〜14語（音読1回が20秒以内）", () => {
    const bad = db.s.filter((r) => {
      const n = words(r.e).length;
      return n < 5 || n > 14;
    });
    expect(bad.map((r) => r.e)).toEqual([]);
  });

  it("重複がない", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const r of db.s) {
      const k = r.e.toLowerCase();
      if (seen.has(k)) dups.push(r.e);
      seen.add(k);
    }
    expect(dups).toEqual([]);
  });

  it("終端記号で終わる", () => {
    expect(db.s.filter((r) => !/[.!?]$/.test(r.e)).map((r) => r.e)).toEqual([]);
  });

  it("許可した文字だけを使う", () => {
    const bad = db.s.filter((r) => !/^[A-Za-z0-9 .,!?'"-]+$/.test(r.e));
    expect(bad.map((r) => r.e)).toEqual([]);
  });

  it("Tatoeba を飽和させている人名が混ざっていない", () => {
    const names = [
      "Tom", "Mary", "John", "Ken", "Bob", "Jim", "Nancy", "Betty",
      "Alice", "Sam", "Mike", "Jack", "Bill", "Tony", "Ann",
    ];
    const re = new RegExp(`\\b(${names.join("|")})\\b`);
    expect(db.s.filter((r) => re.test(r.e)).map((r) => r.e)).toEqual([]);
  });

  it("文頭以外に大文字始まりの語がない（I を除く）", () => {
    const bad = db.s.filter((r) =>
      words(r.e)
        .slice(1)
        .some((w) => /^[A-Z]/.test(w) && w !== "I" && !w.startsWith("I'")),
    );
    expect(bad.map((r) => r.e)).toEqual([]);
  });
});

describe("和訳", () => {
  it("すべて 4〜40字", () => {
    const bad = db.s.filter((r) => r.j.length < 4 || r.j.length > 40);
    expect(bad.map((r) => r.j)).toEqual([]);
  });

  it("すべてかなを含む", () => {
    expect(db.s.filter((r) => !KANA.test(r.j)).map((r) => r.j)).toEqual([]);
  });
});

describe("難易度", () => {
  it("3段階すべてに十分な数がある", () => {
    for (const t of [1, 2, 3] as const) {
      expect(db.s.filter((r) => r.t === t).length).toBeGreaterThan(100);
    }
  });

  it("tier は 1 / 2 / 3 のいずれか", () => {
    expect(db.s.filter((r) => ![1, 2, 3].includes(r.t))).toEqual([]);
  });
});

describe("出典表示", () => {
  it("すべての文に英文ID/和文IDが付いている（CC-BY の要件）", () => {
    expect(db.s.filter((r) => !/^\d+\/\d+$/.test(r.a)).map((r) => r.e)).toEqual([]);
  });
});

describe("配信サイズ", () => {
  it("数百KBに収まる", () => {
    const bytes = readFileSync(
      fileURLToPath(new URL("../public/data/sentences.v1.json", import.meta.url)),
    ).byteLength;
    expect(bytes).toBeLessThan(400_000);
  });
});
