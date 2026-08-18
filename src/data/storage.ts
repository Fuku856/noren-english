/**
 * localStorage への薄い層。
 *
 * 学習記録・時間帯設定・チケット残数はすべてここに入る。サーバーには送らない。
 *
 * Safari のプライベートモードなど localStorage が書けない環境がある。
 * そこで起動時に書き込みプローブを1度だけ実行し、失敗したらメモリ上の Map に退避する。
 * その場合そのセッションだけは全機能が動き、記録が残らないことを画面で正直に伝える。
 */

export const KEYS = {
  salt: "noren:salt",
  settings: "noren:settings",
  records: "noren:records",
  tickets: "noren:tickets",
  milestones: "noren:milestones",
  log: "noren:log",
  lastSeen: "noren:lastSeenMs",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

export interface Backend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

const memory = new Map<string, string>();

const memoryBackend: Backend = {
  get: (k) => memory.get(k) ?? null,
  set: (k, v) => void memory.set(k, v),
  remove: (k) => void memory.delete(k),
  keys: () => [...memory.keys()],
};

function localBackend(): Backend {
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) out.push(k);
      }
      return out;
    },
  };
}

let backend: Backend = memoryBackend;
let persistent = false;

/** 記録が端末に残るか。false ならバナーで正直に伝える。 */
export function isPersistent(): boolean {
  return persistent;
}

/** 起動時に1度だけ呼ぶ。書き込みプローブで localStorage が使えるか確かめる。 */
export function initStorage(): boolean {
  const probe = "noren:probe";
  try {
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    backend = localBackend();
    persistent = true;
  } catch {
    backend = memoryBackend;
    persistent = false;
  }
  return persistent;
}

/** テスト用。バックエンドを差し替える。 */
export function setBackendForTest(b: Backend | null): void {
  backend = b ?? memoryBackend;
  persistent = b !== null;
  if (!b) memory.clear();
}

export function readRaw(key: StorageKey): string | null {
  try {
    return backend.get(key);
  } catch {
    return null;
  }
}

export function writeRaw(key: StorageKey, value: string): boolean {
  try {
    backend.set(key, value);
    return true;
  } catch {
    // 容量超過など。書けなくてもアプリは動き続ける
    return false;
  }
}

export function removeRaw(key: StorageKey): void {
  try {
    backend.remove(key);
  } catch {
    // no-op
  }
}

/**
 * JSON を読んで検証器に通す。
 * 壊れていても必ず値が返る（検証器が既定値を返す責任を持つ）。
 */
export function readJson<T>(key: StorageKey, parse: (u: unknown) => T): T {
  const raw = readRaw(key);
  if (raw === null) return parse(undefined);
  try {
    return parse(JSON.parse(raw));
  } catch {
    return parse(undefined);
  }
}

export function writeJson(key: StorageKey, value: unknown): boolean {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** noren: で始まるキーを全部消す。読み込み前や「最初からやり直す」で使う。 */
export function clearAll(): void {
  try {
    for (const k of backend.keys()) {
      if (k.startsWith("noren:")) backend.remove(k);
    }
  } catch {
    // no-op
  }
}
