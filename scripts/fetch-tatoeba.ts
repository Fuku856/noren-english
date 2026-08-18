/**
 * Tatoeba の週次エクスポートから、例文の生成に必要な3ファイルだけを取得する。
 *
 * 全体の links.tar.bz2 は 149MB あるが、言語ペア別のリンクなら 1.4MB で済む。
 * 合計 約30MB。
 *
 * 取得結果は scripts/.cache/ に置き（gitignore 済み）、SOURCES.json に
 * URL・サイズ・SHA-256・取得日時を記録する。Tatoeba は毎週作り直されるので、
 * ハッシュが変わったことが「元データが更新された」という信号になる。
 *
 *   node scripts/fetch-tatoeba.ts
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CACHE_DIR = fileURLToPath(new URL("./.cache/", import.meta.url));

export interface SourceFile {
  name: string;
  url: string;
}

export const SOURCES: SourceFile[] = [
  {
    name: "eng_sentences.tsv.bz2",
    url: "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
  },
  {
    name: "jpn_sentences.tsv.bz2",
    url: "https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2",
  },
  {
    name: "eng-jpn_links.tsv.bz2",
    url: "https://downloads.tatoeba.org/exports/per_language/eng/eng-jpn_links.tsv.bz2",
  },
];

export interface SourceRecord {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
  fetchedAt: string;
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(src: SourceFile, dest: string): Promise<SourceRecord> {
  process.stdout.write(`  ${src.name} … `);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.url} が ${res.status} を返しました`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(dest, bytes);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`${mb(bytes.byteLength)}`);

  return {
    name: src.name,
    url: src.url,
    bytes: bytes.byteLength,
    sha256,
    // 取得日時の記録。ここは実時刻でよい（アプリのロジックではない）
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchAll(force = false): Promise<SourceRecord[]> {
  await mkdir(CACHE_DIR, { recursive: true });

  const manifestPath = `${CACHE_DIR}SOURCES.json`;
  const previous: Record<string, SourceRecord> = {};
  if (await exists(manifestPath)) {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as SourceRecord[];
    for (const r of parsed) previous[r.name] = r;
  }

  console.log("Tatoeba から取得します（CC-BY 2.0 FR）");
  const records: SourceRecord[] = [];

  for (const src of SOURCES) {
    const dest = `${CACHE_DIR}${src.name}`;
    const cached = previous[src.name];
    if (!force && cached && (await exists(dest))) {
      const size = (await stat(dest)).size;
      if (size === cached.bytes) {
        console.log(`  ${src.name} … キャッシュ済み (${mb(size)})`);
        records.push(cached);
        continue;
      }
    }
    records.push(await download(src, dest));
  }

  await writeFile(manifestPath, `${JSON.stringify(records, null, 2)}\n`);

  const total = records.reduce((a, r) => a + r.bytes, 0);
  console.log(`\n合計 ${mb(total)} → scripts/.cache/`);
  console.log("SOURCES.json にハッシュを記録しました（再現性の確認に使う）");

  return records;
}

if (import.meta.filename === process.argv[1]) {
  await fetchAll(process.argv.includes("--force"));
}
