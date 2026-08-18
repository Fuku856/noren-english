/**
 * 設計上の約束を機械的に守るためのテスト。
 * CLAUDE.md の「破ってはいけない設計上の約束」3・4に対応する。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "fixtures") continue;
      walk(p, out);
    } else if (name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const BLOCK_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");
const LINE_COMMENT = new RegExp(String.raw`//[^\n]*`, "g");
const DQ_STRING = new RegExp(String.raw`"(?:[^"\\\n]|\\.)*"`, "g");
const SQ_STRING = new RegExp(String.raw`'(?:[^'\\\n]|\\.)*'`, "g");
const TEMPLATE = new RegExp(String.raw`\x60(?:[^\x60\\]|\\.)*\x60`, "g");

/** コメントと文字列リテラルを潰して、実コードだけを見る。 */
function stripNonCode(src: string): string {
  return src
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(DQ_STRING, '""')
    .replace(SQ_STRING, "''")
    .replace(TEMPLATE, "``");
}

/**
 * プロパティアクセス（`i.window`）とプロパティキー（`window: TimeWindow`）を消す。
 * `window` は「時間帯」というこのアプリの語彙でもあるので、
 * 禁じたいのはグローバル参照だけ。名前が被っているだけのものを落とさない。
 */
function stripMemberNames(src: string): string {
  return src
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, ".")
    .replace(/([A-Za-z_$][\w$]*)\s*(\??:)/g, "$2");
}

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

describe("時刻は src/app/clock.ts だけが触る", () => {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "shared"))].filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(join("app", "clock.ts")),
  );

  it("対象ファイルを走査できている", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("clock.ts 以外に Date.now() が無い", () => {
    const offenders = files
      .filter((f) => /\bDate\.now\s*\(/.test(stripNonCode(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("clock.ts 以外に引数なしの new Date() が無い", () => {
    const offenders = files
      .filter((f) => /\bnew\s+Date\s*\(\s*\)/.test(stripNonCode(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("shared/ はどのランタイムでも動く", () => {
  const files = walk(join(ROOT, "shared")).filter((f) => !f.endsWith(".test.ts"));

  it("ファイルが存在する", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("DOM / storage / Node API のグローバルに触らない", () => {
    const banned =
      /\b(window|document|localStorage|sessionStorage|navigator|process|require)\b/;
    const offenders = files
      .filter((f) =>
        banned.test(stripMemberNames(stripNonCode(readFileSync(f, "utf8")))),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("src/ に依存しない（依存方向は src → shared の一方向）", () => {
    const offenders = files
      .filter((f) => /from\s+["'](@\/|.*\/src\/)/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("stripNonCode 自体の健全性", () => {
  it("コメント内の Date.now() は見逃す", () => {
    expect(stripNonCode("// Date.now()\nconst a = 1;")).not.toMatch(/Date\.now/);
    expect(stripNonCode("/* Date.now() */")).not.toMatch(/Date\.now/);
  });

  it("実コードの Date.now() は残す", () => {
    expect(stripNonCode("const t = Date.now();")).toMatch(/Date\.now/);
  });

  it("文字列リテラルの中身は潰す", () => {
    expect(stripNonCode('const s = "localStorage";')).not.toMatch(/localStorage/);
  });
});

describe("stripMemberNames 自体の健全性", () => {
  it("プロパティアクセスと型のプロパティキーは見逃す", () => {
    expect(stripMemberNames("i.window.start")).not.toMatch(/\bwindow\b/);
    expect(stripMemberNames("interface A { window: TimeWindow }")).not.toMatch(
      /\bwindow\b/,
    );
    expect(stripMemberNames("interface A { window?: TimeWindow }")).not.toMatch(
      /\bwindow\b/,
    );
  });

  it("グローバル参照は残す", () => {
    expect(stripMemberNames("window.addEventListener(x)")).toMatch(/\bwindow\b/);
    expect(stripMemberNames("const a = localStorage;")).toMatch(/\blocalStorage\b/);
    expect(stripMemberNames("if (typeof document !== 'x') {}")).toMatch(/\bdocument\b/);
  });
});
