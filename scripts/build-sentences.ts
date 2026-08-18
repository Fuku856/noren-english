/**
 * Tatoeba のダンプから public/data/sentences.v1.json を作る。
 *
 *   node scripts/fetch-tatoeba.ts     # 先に取得（約30MB）
 *   node scripts/build-sentences.ts
 *
 * 出力はコミットする。Cloudflare Pages のビルドがダンプに依存してはいけない。
 *
 * 同じ入力に対して出力がバイト単位で同一になるよう、抽出は seed 付き PRNG で行う。
 * 実時刻に依存する値は generatedAt だけ。
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CACHE = fileURLToPath(new URL("./.cache/", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

/** 難易度。学習指導要領の区切りに寄せている。 */
export const TIER_JUNIOR = 1; // 中学
export const TIER_SENIOR_12 = 2; // 高1・高2
export const TIER_SENIOR_3 = 3; // 高3
export type Tier = 1 | 2 | 3;

export const TIER_LABEL: Record<Tier, string> = {
  1: "中学",
  2: "高1・高2",
  3: "高3",
};

/** 難易度別の目標件数。合計1000で3年分。全体として易しめに寄せる。 */
const TIER_QUOTA: Record<Tier, number> = { 1: 400, 2: 350, 3: 250 };

const MIN_WORDS = 5;
const MAX_WORDS = 14;
/** これより稀な語を含む文は「難しい」ではなく「古い・特殊」なので使わない。 */
const MAX_RARE_RANK = 15_000;

const MIN_JA_CHARS = 4;
const MAX_JA_CHARS = 40;

/** 出力の並びを固定するための seed。変えると例文の並びが全部変わる。 */
const SAMPLE_SEED = "noren.sentences.v1";

// ---------------------------------------------------------------- 入出力

/** bzip2 に投げて1行ずつ読む。Node に bzip2 が無いので外部コマンドを使う。 */
async function* readBz2Lines(path: string): AsyncGenerator<string> {
  const proc = spawn("bzip2", ["-dc", path], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  proc.on("error", () => {
    throw new Error(
      "bzip2 コマンドが見つかりません。\n" +
        "  Windows: Git Bash に同梱されています（PATH を通してください）\n" +
        "  macOS:   標準で入っています\n" +
        "  Linux:   apt install bzip2",
    );
  });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  for await (const line of rl) yield line;

  const code: number = await new Promise((r) => proc.on("close", r));
  if (code !== 0) throw new Error(`bzip2 が異常終了しました (${code}): ${stderr}`);
}

// ---------------------------------------------------------------- 語の正規化

const WORD_RE = /[A-Za-z']+/g;

/** 頻度表の引き当て用。粗い lemmatise。厳密さより一貫性を優先する。 */
export function lemma(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "");
  if (w.length <= 3) return w;
  for (const [suffix, cut] of [
    ["ies", 3],
    ["ied", 3],
    ["ing", 3],
    ["ed", 2],
    ["es", 2],
    ["ly", 2],
    ["s", 1],
  ] as const) {
    if (w.endsWith(suffix) && w.length - cut >= 3) {
      const stem = w.slice(0, w.length - cut);
      // running → runn → run のように重子音を戻す
      if (/([bdgklmnprt])\1$/.test(stem)) return stem.slice(0, -1);
      if (suffix === "ies" || suffix === "ied") return `${stem}y`;
      return stem;
    }
  }
  return w;
}

/** 頻度の「稀さ」を測るときに無視する機能語。 */
const STOPWORDS = new Set(
  `a an the this that these those i you he she it we they me him her us them
   my your his its our their mine yours hers ours theirs myself yourself himself
   herself itself ourselves themselves who whom whose which what when where why how
   be am is are was were been being do does did done have has had having
   will would shall should can could may might must ought need dare
   go goes went gone going come comes came get gets got make makes made take takes took
   of in on at to for with by from up down out off over under about into through
   and or but so if because as than then there here now very too also just only
   not no nor yes all any both each few more most other some such own same
   one two three four five six seven eight nine ten first next last
   good great little big new old long time day year thing way man people`
    .split(/\s+/)
    .filter(Boolean),
);

// ---------------------------------------------------------------- 文法シグナル

/** 高1・高2 以上に引き上げる構文。 */
const SENIOR_12_PATTERNS: Array<[string, RegExp]> = [
  ["現在完了進行形", /\b(have|has)\s+been\s+\w+ing\b/],
  ["過去完了", /\bhad\s+(been|already|just|never)\b|\bhad\s+\w+(ed|en)\b/],
  ["関係代名詞 whose/whom", /\b(whose|whom)\b/],
  ["仮定法（基本）", /\bif\s+\w+\s+were\b|\bi\s+wish\b|\bas\s+if\b/],
  ["分詞構文", /^\w+ing\b[^,]*,\s/],
  ["使役・知覚", /\b(make|made|let|have|had|see|saw|hear|heard)\s+\w+\s+\w+\b.*\b(do|go|come)\b/],
  ["so that / such that", /\bso\s+\w+\s+that\b|\bsuch\s+a\s+\w+\s+that\b/],
];

/** 高3 に引き上げる構文。 */
const SENIOR_3_PATTERNS: Array<[string, RegExp]> = [
  ["仮定法過去完了", /\bhad\s+\w+.*\b(would|could|might|should)\s+have\b/],
  ["would have + 過去分詞", /\b(would|could|might)\s+have\s+\w+(ed|en)\b/],
  ["倒置", /^(never|rarely|seldom|hardly|scarcely|little|not\s+only|no\s+sooner)\b/],
  ["強調構文", /\bit\s+(is|was)\s+\w+.*\bthat\b/],
  ["独立分詞構文・付帯状況", /\bwith\s+\w+\s+\w+ing\b|\bhaving\s+\w+(ed|en)\b/],
  ["譲歩の副詞節", /\bno\s+matter\s+(how|what|where|when)\b|\bhowever\s+\w+\s+(he|she|it|they)\b/],
];

export function grammarTier(lower: string): { tier: Tier; signal: string | null } {
  for (const [name, re] of SENIOR_3_PATTERNS) {
    if (re.test(lower)) return { tier: TIER_SENIOR_3, signal: name };
  }
  for (const [name, re] of SENIOR_12_PATTERNS) {
    if (re.test(lower)) return { tier: TIER_SENIOR_12, signal: name };
  }
  return { tier: TIER_JUNIOR, signal: null };
}

// ---------------------------------------------------------------- フィルタ

/** 英文として許す文字。 */
const ALLOWED_EN = /^[A-Za-z0-9 .,!?'"-]+$/;

export interface EnCheck {
  ok: boolean;
  reason?: string;
  words?: string[];
}

/**
 * 固有名詞かどうかはコーパス自身に決めさせる。
 *
 * 文頭以外で大文字始まりに出る回数が、小文字で出る回数を大きく上回る語は固有名詞。
 * 手書きの人名リストを保守しなくて済み、Tatoeba の日英サブセットを飽和させている
 * Tom / Mary が確実に落ちる。**文頭の Tom も落とすのが肝**で、
 * ここを i > 0 に限ると「Tom stirred the soup.」のような文が全部すり抜ける。
 */
export function buildProperNouns(
  capMid: Map<string, number>,
  lowerAny: Map<string, number>,
): Set<string> {
  const out = new Set<string>();
  for (const [w, cap] of capMid) {
    if (w === "i") continue; // I は代名詞
    if (cap < 3) continue; // 出現が少なすぎる語は判断しない
    if (cap > (lowerAny.get(w) ?? 0) * 2) out.add(w);
  }
  return out;
}

export function checkEnglish(
  text: string,
  blocked: Set<string>,
  properNouns: Set<string>,
): EnCheck {
  if (!ALLOWED_EN.test(text)) return { ok: false, reason: "charset" };
  if (!/[.!?]$/.test(text)) return { ok: false, reason: "no_terminator" };
  if (/\d{3,}/.test(text)) return { ok: false, reason: "long_number" };

  const words = text.match(WORD_RE) ?? [];
  if (words.length < MIN_WORDS) return { ok: false, reason: "too_short" };
  if (words.length > MAX_WORDS) return { ok: false, reason: "too_long" };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    // 全大文字（I を除く）は略語や叫びなので外す
    if (w.length > 1 && w === w.toUpperCase()) return { ok: false, reason: "all_caps" };
    const lower = w.toLowerCase();
    // 文頭も含めて固有名詞を落とす
    if (/^[A-Z]/.test(w) && properNouns.has(lower)) {
      return { ok: false, reason: "proper_noun" };
    }
    // 文頭以外の未知の大文字始まりも固有名詞とみなす
    if (i > 0 && /^[A-Z]/.test(w) && lower !== "i") {
      return { ok: false, reason: "proper_noun" };
    }
  }

  for (const w of words) {
    if (blocked.has(w.toLowerCase()) || blocked.has(lemma(w))) {
      return { ok: false, reason: "blocklist" };
    }
  }

  return { ok: true, words };
}

const KANA = /[぀-ゟ゠-ヿ]/;

export function checkJapanese(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < MIN_JA_CHARS) return { ok: false, reason: "too_short" };
  if (t.length > MAX_JA_CHARS) return { ok: false, reason: "too_long" };
  if (!KANA.test(t)) return { ok: false, reason: "no_kana" };
  if (/[A-Za-z]{3,}/.test(t)) return { ok: false, reason: "latin" };
  return { ok: true };
}

// ---------------------------------------------------------------- PRNG

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed から決まる順序でシャッフルする。同じ入力なら常に同じ結果。 */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const rand = mulberry32(xmur3(seed)());
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- 本体

interface Candidate {
  enId: number;
  jaId: number;
  en: string;
  ja: string;
  words: string[];
}

interface Emitted {
  t: Tier;
  e: string;
  j: string;
  a: string;
}

async function loadBlocklist(): Promise<Set<string>> {
  const raw = await readFile(new URL("./blocklist.txt", import.meta.url), "utf8");
  const out = new Set<string>();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    for (const w of t.split(/\s+/)) {
      out.add(w.toLowerCase());
      out.add(lemma(w));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const blocked = await loadBlocklist();
  console.log(`ブロックリスト: ${blocked.size} 語`);

  // --- 和文を読む
  const jaById = new Map<number, string>();
  for await (const line of readBz2Lines(`${CACHE}jpn_sentences.tsv.bz2`)) {
    const tab1 = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab1 + 1);
    if (tab2 < 0) continue;
    jaById.set(Number(line.slice(0, tab1)), line.slice(tab2 + 1));
  }
  console.log(`和文: ${jaById.size.toLocaleString()} 件`);

  // --- 日英リンクを読む（1つの英文に複数の和訳がありうる）
  const linksByEn = new Map<number, number[]>();
  for await (const line of readBz2Lines(`${CACHE}eng-jpn_links.tsv.bz2`)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const enId = Number(line.slice(0, tab));
    const jaId = Number(line.slice(tab + 1));
    const list = linksByEn.get(enId);
    if (list) list.push(jaId);
    else linksByEn.set(enId, [jaId]);
  }
  console.log(`日英リンク: ${linksByEn.size.toLocaleString()} 件の英文`);

  // --- 英文を1度流し、頻度表・大文字統計・和訳つきの生候補を同時に集める
  const freq = new Map<string, number>();
  const capMid = new Map<string, number>();
  const lowerAny = new Map<string, number>();
  const rejected = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  const raw: Array<{ enId: number; en: string }> = [];
  let enTotal = 0;

  for await (const line of readBz2Lines(`${CACHE}eng_sentences.tsv.bz2`)) {
    const tab1 = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab1 + 1);
    if (tab2 < 0) continue;
    const enId = Number(line.slice(0, tab1));
    const en = line.slice(tab2 + 1);
    enTotal++;

    const words = en.match(WORD_RE) ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const lower = w.toLowerCase();
      // 頻度表はコーパス全体から数える。追加ダウンロードもライセンスも増えない
      bump(freq, lemma(w));
      if (/^[A-Z]/.test(w)) {
        if (i > 0) bump(capMid, lower);
      } else {
        bump(lowerAny, lower);
      }
    }

    if (linksByEn.has(enId)) raw.push({ enId, en });
  }

  const properNouns = buildProperNouns(capMid, lowerAny);
  console.log(`英文: ${enTotal.toLocaleString()} 件を走査`);
  console.log(`語彙: ${freq.size.toLocaleString()} 語の頻度表`);
  console.log(`固有名詞と判定: ${properNouns.size.toLocaleString()} 語`);
  console.log(
    `  例: ${[...properNouns].slice(0, 12).join(", ")}` +
      `${properNouns.has("tom") ? "  ← tom を検出" : "  ⚠ tom を検出できていない"}`,
  );

  // --- フィルタして候補にする
  const candidates: Candidate[] = [];
  for (const { enId, en } of raw) {
    const check = checkEnglish(en, blocked, properNouns);
    if (!check.ok) {
      bump(rejected, `en:${check.reason}`);
      continue;
    }

    // 同じ英文に複数の和訳があるときは最短を採る
    let best: { id: number; text: string } | null = null;
    for (const jaId of linksByEn.get(enId)!) {
      const ja = jaById.get(jaId);
      if (!ja) continue;
      if (!checkJapanese(ja).ok) continue;
      if (!best || ja.length < best.text.length) best = { id: jaId, text: ja };
    }
    if (!best) {
      bump(rejected, "ja:none_valid");
      continue;
    }

    candidates.push({ enId, jaId: best.id, en, ja: best.text, words: check.words! });
  }

  console.log(`候補: ${candidates.length.toLocaleString()} 件`);
  console.log("\n棄却の内訳:");
  for (const [k, v] of [...rejected].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`);
  }

  // --- 頻度ランク
  const rank = new Map<string, number>();
  const sorted = [...freq].sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < sorted.length; i++) rank.set(sorted[i]![0], i + 1);

  const rarestRank = (words: string[]): number => {
    let worst = 0;
    for (const w of words) {
      const l = lemma(w);
      if (STOPWORDS.has(l) || STOPWORDS.has(w.toLowerCase())) continue;
      worst = Math.max(worst, rank.get(l) ?? 99_999);
    }
    return worst;
  };

  // --- 重複排除（正規化英文で）
  const seen = new Map<string, Candidate>();
  for (const c of candidates.sort((a, b) => a.enId - b.enId)) {
    const key = c.en.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, c);
  }
  const unique = [...seen.values()];
  console.log(`\n重複排除後: ${unique.length.toLocaleString()} 件`);

  // --- 難易度の割り当て（語彙ランクと文法シグナルの高い方）
  const byTier: Record<Tier, Candidate[]> = { 1: [], 2: [], 3: [] };
  let tooObscure = 0;
  for (const c of unique) {
    const r = rarestRank(c.words);
    // 高3 より上は「難しい」ではなく「古い・特殊」になる。学習用に向かないので落とす
    if (r > MAX_RARE_RANK) {
      tooObscure++;
      continue;
    }
    const vocabTier: Tier = r <= 2000 ? 1 : r <= 5000 ? 2 : 3;
    const g = grammarTier(c.en.toLowerCase());
    // 中学は音読1回が短く収まる長さに限る
    const lengthTier: Tier = c.words.length <= 10 ? 1 : 2;
    const tier = Math.max(vocabTier, g.tier, lengthTier) as Tier;
    byTier[tier].push(c);
  }
  console.log(`  （語彙が稀すぎて除外: ${tooObscure.toLocaleString()} 件）`);

  console.log("\n難易度別の母数:");
  for (const t of [1, 2, 3] as Tier[]) {
    console.log(`  ${TIER_LABEL[t].padEnd(10)} ${byTier[t].length.toLocaleString()}`);
  }

  // --- 抽出（決定論的）
  const picked: Array<Candidate & { tier: Tier }> = [];
  for (const t of [1, 2, 3] as Tier[]) {
    const pool = byTier[t].sort((a, b) => a.enId - b.enId);
    const want = TIER_QUOTA[t];
    if (pool.length < want) {
      console.warn(`  ⚠ ${TIER_LABEL[t]} は ${pool.length} 件しかありません（目標 ${want}）`);
    }
    for (const c of seededShuffle(pool, `${SAMPLE_SEED}:${t}`).slice(0, want)) {
      picked.push({ ...c, tier: t });
    }
  }

  // 出力の並びも決定論的に。難易度が固まらないよう全体をシャッフルしてから
  // 出力するが、tier は実行時に別デッキで引くので順序は表示上の意味しか持たない
  const finalList = seededShuffle(picked, `${SAMPLE_SEED}:final`);

  const emitted: Emitted[] = finalList.map((c) => ({
    t: c.tier,
    e: c.en,
    j: c.ja,
    a: `${c.enId}/${c.jaId}`,
  }));

  const sources = JSON.parse(await readFile(`${CACHE}SOURCES.json`, "utf8")) as Array<{
    name: string;
    sha256: string;
  }>;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    `${OUT_DIR}sentences.v1.json`,
    `${JSON.stringify(
      {
        version: 1,
        source: "tatoeba",
        license: "CC-BY 2.0 FR",
        licenseUrl: "https://creativecommons.org/licenses/by/2.0/fr/",
        sourceHashes: Object.fromEntries(sources.map((s) => [s.name, s.sha256.slice(0, 16)])),
        generatedAt: new Date().toISOString().slice(0, 10),
        tiers: TIER_LABEL,
        count: emitted.length,
        s: emitted,
      },
      null,
      0,
    )}\n`,
  );

  await writeFile(
    `${OUT_DIR}ATTRIBUTION.txt`,
    [
      "例文は Tatoeba Project (https://tatoeba.org) より。",
      "ライセンス: CC-BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/)",
      "",
      "各行は 英文ID/和文ID の対応です。",
      "",
      ...finalList.map((c) => `#${c.enId} & #${c.jaId}`),
      "",
    ].join("\n"),
  );

  // --- 目視用の統計
  const lens = emitted.map((e) => (e.e.match(WORD_RE) ?? []).length);
  const hist = new Map<number, number>();
  for (const l of lens) hist.set(l, (hist.get(l) ?? 0) + 1);

  console.log(`\n出力: ${emitted.length} 件 → public/data/sentences.v1.json`);
  console.log("\n語数の分布:");
  for (const l of [...hist.keys()].sort((a, b) => a - b)) {
    console.log(`  ${String(l).padStart(2)} 語  ${"#".repeat(Math.ceil(hist.get(l)! / 5))} ${hist.get(l)}`);
  }

  console.log("\n無作為に10文（毎回必ず目で見ること）:");
  for (const c of seededShuffle(finalList, "sample-preview").slice(0, 10)) {
    console.log(`  [${TIER_LABEL[c.tier]}] ${c.en}`);
    console.log(`             ${c.ja}`);
  }
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
