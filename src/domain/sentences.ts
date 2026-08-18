/**
 * 例文の読み込みと、その日の1文の決定。
 *
 * ⚠ 選択に salt を混ぜないこと。
 *   全世界で同じ1文が出ることが Wordle 型の要で、ここにユーザ固有値が入ると崩れる。
 *   混ぜてよいのは開店「時刻」だけ（shared/openTime.ts）。
 */

import { dayNumber } from "@shared/dateKey";
import { permutation } from "./random";

export type Tier = 1 | 2 | 3;

export interface Sentence {
  /** 配列の添字がそのまま id。JSON には持たせていない。 */
  id: number;
  tier: Tier;
  en: string;
  ja: string;
  /** "英文ID/和文ID"。CC-BY の出典表示。 */
  attribution: string;
}

export interface SentenceDb {
  version: number;
  license: string;
  licenseUrl: string;
  generatedAt: string;
  tierLabels: Record<Tier, string>;
  sentences: Sentence[];
  /** tier ごとの id 配列（安定順）。 */
  byTier: Record<Tier, number[]>;
}

/** 選択の種。変えると全世界の出題順が変わる。 */
const DECK_SEED = "noren.v1";

/**
 * 難易度の巡回。全員が同じ文を受け取ったまま、全体としては易しめに寄せる。
 * 6日周期で 中学3回 / 高1・高2 2回 / 高3 1回。
 */
export const TIER_PATTERN: readonly Tier[] = [1, 1, 2, 1, 2, 3];

interface RawDb {
  version: number;
  license: string;
  licenseUrl: string;
  generatedAt: string;
  tiers: Record<string, string>;
  count: number;
  s: Array<{ t: number; e: string; j: string; a: string }>;
}

export function normalizeDb(raw: RawDb): SentenceDb {
  const sentences: Sentence[] = raw.s.map((row, id) => ({
    id,
    tier: (row.t === 2 ? 2 : row.t === 3 ? 3 : 1) as Tier,
    en: row.e,
    ja: row.j,
    attribution: row.a,
  }));

  const byTier: Record<Tier, number[]> = { 1: [], 2: [], 3: [] };
  for (const s of sentences) byTier[s.tier].push(s.id);

  return {
    version: raw.version,
    license: raw.license,
    licenseUrl: raw.licenseUrl,
    generatedAt: raw.generatedAt,
    tierLabels: {
      1: raw.tiers["1"] ?? "中学",
      2: raw.tiers["2"] ?? "高1・高2",
      3: raw.tiers["3"] ?? "高3",
    },
    sentences,
    byTier,
  };
}

export async function loadSentences(
  url = "/data/sentences.v1.json",
): Promise<SentenceDb> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`例文の取得に失敗しました (${res.status})`);
  return normalizeDb((await res.json()) as RawDb);
}

/** その日の難易度。 */
export function tierFor(dateKey: string): Tier {
  const n = dayNumber(dateKey);
  const i = ((n % TIER_PATTERN.length) + TIER_PATTERN.length) % TIER_PATTERN.length;
  return TIER_PATTERN[i]!;
}

/**
 * その難易度が「何回目」に回ってくる日か。
 * 難易度ごとに別のデッキを引くので、そのデッキ内での通し番号が要る。
 */
export function tierOccurrence(dateKey: string): number {
  const n = dayNumber(dateKey);
  const period = TIER_PATTERN.length;
  const tier = tierFor(dateKey);
  const perCycle = TIER_PATTERN.filter((t) => t === tier).length;

  const cycles = Math.floor(n / period);
  const rem = ((n % period) + period) % period;
  let within = 0;
  for (let i = 0; i < rem; i++) if (TIER_PATTERN[i] === tier) within++;

  return cycles * perCycle + within;
}

/**
 * その日の1文。
 *
 * `hash(dateKey) % N` は誕生日衝突で数週間以内に同じ文が来てしまうので使わない。
 * 難易度ごとに Fisher–Yates の順列を作り、その中を順に消費する。
 * 1周（その難易度の文数ぶん）は絶対に重複しない。
 */
export function pickSentenceId(db: SentenceDb, dateKey: string): number {
  const tier = tierFor(dateKey);
  const ids = db.byTier[tier];
  if (ids.length === 0) {
    // 想定外だが、白画面よりは何か出す方がよい
    return db.sentences.length > 0 ? 0 : -1;
  }

  const k = tierOccurrence(dateKey);
  const n = ids.length;
  const epoch = Math.floor(k / n);
  const pos = ((k % n) + n) % n;

  const deck = permutation(n, `${DECK_SEED}|t${tier}|${epoch}`);
  return ids[deck[pos]!]!;
}

export function sentenceById(db: SentenceDb, id: number): Sentence | null {
  return db.sentences[id] ?? null;
}

export function pickSentence(db: SentenceDb, dateKey: string): Sentence | null {
  return sentenceById(db, pickSentenceId(db, dateKey));
}
