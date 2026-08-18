/**
 * 決定論的な乱数。
 *
 * 暗号強度は要らない。要るのは「同じ入力なら常に同じ結果」であることと、
 * **同期であること**。「開いた瞬間に問題が出る」ためには開店画面が await できない。
 * crypto.subtle（非同期）は Worker とのパリティが必要な openMinute だけに使う。
 */

/** 文字列 → 32bit の種。 */
export function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** 種 → [0,1) を返す関数。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomFrom(seed: string): () => number {
  return mulberry32(hash32(seed));
}

/** 0..n-1 の Fisher–Yates 順列。seed が同じなら常に同じ並び。 */
export function permutation(n: number, seed: string): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  const rand = randomFrom(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** 配列を seed 付きでシャッフルする（元の配列は変えない）。 */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const perm = permutation(items.length, seed);
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) out.push(items[perm[i]!]!);
  return out;
}
