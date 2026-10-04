/**
 * 端末側の通知。**押すまでサーバーに通信しない**ことを、ここで機械的に保証する。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUSH_API } from "@shared/push";
import type { Schedule } from "@shared/schedule";
import { pushFingerprint, RESYNC_MS, type PushRecord } from "@/data/push";
import {
  createPushClient,
  type PushDeps,
  type RegistrationLike,
  type SubscriptionLike,
} from "@/push/client";

const SCHED: Schedule = {
  salt: "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f",
  window: { start: 21 * 60, end: 23 * 60 },
  pending: null,
};
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const NOW = 1_787_000_000_000;

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function env(over: Partial<PushDeps> = {}, opts: { subscribed?: boolean; record?: PushRecord | null; putOk?: boolean } = {}) {
  const calls: Call[] = [];
  const log: string[] = [];
  let record: PushRecord | null = opts.record ?? null;
  let sub: SubscriptionLike | null = null;
  let clock = NOW;

  const makeSub = (): SubscriptionLike => {
    const s: SubscriptionLike = {
      endpoint: ENDPOINT,
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "BPub", auth: "authSecret" } }),
      unsubscribe: async () => {
        log.push("unsubscribe");
        sub = null;
        return true;
      },
    };
    return s;
  };
  if (opts.subscribed) sub = makeSub();

  const reg: RegistrationLike = {
    pushManager: {
      getSubscription: async () => sub,
      subscribe: async (o) => {
        log.push(`subscribe:${o.userVisibleOnly}:${o.applicationServerKey.length}`);
        return (sub = makeSub());
      },
    },
    getNotifications: async () => [{ close: () => log.push("close") }],
  };

  const deps: PushDeps = {
    // 65バイトの公開鍵（中身は何でもよい）
    vapidKey: "B" + "A".repeat(86),
    support: () => "available",
    permission: () => "granted",
    requestPermission: async () => {
      log.push("requestPermission");
      return "granted";
    },
    registration: () => reg,
    workerReady: async () => true,
    fetch: async (url, init) => {
      calls.push({
        url,
        method: String(init.method),
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      const ok = opts.putOk ?? true;
      return { ok, status: ok ? 200 : 503, json: async () => ({ nextOpenAt: 1 }) };
    },
    now: () => clock,
    store: {
      load: () => record,
      save: (r) => {
        record = r;
      },
      clear: () => {
        record = null;
      },
    },
    ...over,
  };

  return {
    client: createPushClient(deps),
    calls,
    log,
    record: () => record,
    hasSub: () => sub !== null,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const synced = (sched: Schedule, at = NOW): PushRecord => ({
  endpoint: ENDPOINT,
  synced: pushFingerprint(ENDPOINT, sched.salt, sched),
  syncedAtMs: at,
});

describe("押すまで通信しない（約束1・7）", () => {
  it("公開鍵の無いビルドでは何もしない", async () => {
    const e = env({ vapidKey: null });
    expect(await e.client.start(SCHED)).toBe("hidden");
    expect(e.calls).toEqual([]);
  });

  it("オンにしていなければ、起動しても一度も通信しない", async () => {
    const e = env();
    expect(await e.client.start(SCHED)).toBe("off");
    await e.client.sync({ ...SCHED, salt: "changed-salt-000" });
    expect(e.calls).toEqual([]);
  });

  it("控えが無いのにブラウザに購読が残っていたら、サーバーには送らずブラウザ側だけ外す", async () => {
    const e = env({}, { subscribed: true });
    expect(await e.client.start(SCHED)).toBe("off");
    expect(e.calls).toEqual([]);
    expect(e.log).toContain("unsubscribe");
    expect(e.hasSub()).toBe(false);
  });

  it("未対応・要追加の端末は状態を返すだけ", async () => {
    expect(await env({ support: () => "unsupported" }).client.start(SCHED)).toBe("unsupported");
    expect(await env({ support: () => "needs-install" }).client.start(SCHED)).toBe(
      "needs-install",
    );
  });
});

describe("オンにする", () => {
  it("許可ダイアログはクリックの同期区間で呼ばれる（iOS の要件）", async () => {
    const e = env();
    await e.client.start(SCHED);
    void e.client.enable(SCHED);
    // await を挟まずに確認する
    expect(e.log).toEqual(["requestPermission"]);
  });

  it("許可されたら購読し、購読情報・salt・窓だけを預ける", async () => {
    const e = env();
    await e.client.start(SCHED);
    expect(await e.client.enable(SCHED)).toBe("on");

    expect(e.log).toEqual(["requestPermission", "subscribe:true:65"]);
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0]!.url).toBe(PUSH_API);
    expect(e.calls[0]!.method).toBe("PUT");
    expect(e.calls[0]!.body).toEqual({
      subscription: { endpoint: ENDPOINT, keys: { p256dh: "BPub", auth: "authSecret" } },
      salt: SCHED.salt,
      window: SCHED.window,
      pending: null,
    });
    expect(e.record()).toEqual(synced(SCHED));
  });

  it("拒否されたら denied。購読もしない", async () => {
    const e = env({ requestPermission: async () => "denied" });
    await e.client.start(SCHED);
    expect(await e.client.enable(SCHED)).toBe("denied");
    expect(e.calls).toEqual([]);
    expect(e.hasSub()).toBe(false);
  });

  it("ダイアログを閉じただけなら off に戻る", async () => {
    const e = env({ requestPermission: async () => "default" });
    await e.client.start(SCHED);
    expect(await e.client.enable(SCHED)).toBe("off");
  });

  it("預けられなかったら error。ブラウザ側の購読も外し、控えは書かない", async () => {
    const e = env({}, { putOk: false });
    await e.client.start(SCHED);
    expect(await e.client.enable(SCHED)).toBe("error");
    expect(e.hasSub()).toBe(false);
    expect(e.record()).toBeNull();
  });

  it("SW が古いあいだは許可を求めず reopen", async () => {
    const e = env({ workerReady: async () => false });
    expect(await e.client.start(SCHED)).toBe("reopen");
    expect(await e.client.enable(SCHED)).toBe("reopen");
    expect(e.log).toEqual([]);
  });
});

describe("同期", () => {
  it("変化が無ければ通信しない", async () => {
    const e = env({}, { subscribed: true, record: synced(SCHED) });
    expect(await e.client.start(SCHED)).toBe("on");
    expect(await e.client.sync(SCHED)).toBe("on");
    expect(e.calls).toEqual([]);
  });

  it("窓を変えたら（予約も含めて）送り直す", async () => {
    const e = env({}, { subscribed: true, record: synced(SCHED) });
    await e.client.start(SCHED);
    const next: Schedule = {
      ...SCHED,
      pending: { window: { start: 420, end: 540 }, effectiveFrom: "2026-08-19" },
    };
    await e.client.sync(next);
    expect(e.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(e.record()!.synced).toBe(pushFingerprint(ENDPOINT, SCHED.salt, next));
  });

  it("読み込みで salt が変わっていたら、起動時に送り直す", async () => {
    const e = env({}, { subscribed: true, record: synced(SCHED) });
    await e.client.start({ ...SCHED, salt: "restored-salt-01" });
    expect(e.calls).toHaveLength(1);
    expect((e.calls[0]!.body as { salt: string }).salt).toBe("restored-salt-01");
  });

  it("7日たったら変化が無くても送り直す（サーバー側で消えていた場合の自己修復）", async () => {
    const e = env({}, { subscribed: true, record: synced(SCHED, NOW - RESYNC_MS) });
    await e.client.start(SCHED);
    expect(e.calls).toHaveLength(1);
  });

  it("送れなかったら控えを更新しない（次の起動でやり直す）", async () => {
    const old = synced(SCHED);
    const e = env({}, { subscribed: true, record: old, putOk: false });
    await e.client.start(SCHED);
    expect(await e.client.sync({ ...SCHED, salt: "changed-salt-000" })).toBe("on");
    expect(e.record()).toEqual(old);
  });

  it("端末の設定で拒否に変えられていたら、控えを消して denied", async () => {
    const e = env({ permission: () => "denied" }, { subscribed: true, record: synced(SCHED) });
    expect(await e.client.start(SCHED)).toBe("denied");
    expect(e.record()).toBeNull();
    expect(e.calls).toEqual([]);
  });

  it("ブラウザ側の購読が消えていたら off", async () => {
    const e = env({}, { subscribed: false, record: synced(SCHED) });
    expect(await e.client.start(SCHED)).toBe("off");
    expect(e.record()).toBeNull();
  });
});

describe("止める", () => {
  it("ブラウザ側を外し、endpoint と auth でサーバーから消す", async () => {
    const e = env({}, { subscribed: true, record: synced(SCHED) });
    await e.client.start(SCHED);
    expect(await e.client.disable()).toBe("off");
    expect(e.hasSub()).toBe(false);
    expect(e.record()).toBeNull();
    expect(e.calls).toEqual([
      { url: PUSH_API, method: "DELETE", body: { endpoint: ENDPOINT, auth: "authSecret" } },
    ]);
  });

  it("サーバーへの削除が失敗しても off になる", async () => {
    const e = env(
      { fetch: () => Promise.reject(new Error("offline")) },
      { subscribed: true, record: synced(SCHED) },
    );
    await e.client.start(SCHED);
    expect(await e.client.disable()).toBe("off");
    expect(e.record()).toBeNull();
  });
});

describe("開いたら通知を消す", () => {
  it("noren-open の通知を閉じる", async () => {
    const e = env();
    e.client.clearNotifications();
    await new Promise((r) => setTimeout(r, 0));
    expect(e.log).toContain("close");
  });
});

describe("通信の出口は1つ", () => {
  it("src/ で /api/push に触るのは src/push/client.ts だけ", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    // コメントの中で触れているのは構わない
    const code = (f: string) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    const offenders = walk(root)
      .filter((f) => !f.endsWith(join("push", "client.ts")))
      .filter((f) => /\/api\/push|PUSH_API/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("書き出し（バックアップ）は通知の控えを運ばない", () => {
    const src = readFileSync(new URL("../../src/data/transfer.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/KEYS\.push|noren:push/);
  });
});
