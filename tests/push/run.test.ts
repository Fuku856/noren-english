import { describe, expect, it } from "vitest";
import { addDays, dateKeyOf } from "@shared/dateKey";
import { openInstantMs, SESSION_MS } from "@shared/openTime";
import { d1Store, handleSubscribe, type PushStore } from "@shared/pushServer";
import type { SubscribeRequest } from "@shared/push";
import { runOnce, ttlSecFor, type RunDeps } from "../../worker/src/run";
import { memoryD1 } from "./sqlite";

const SALT = "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f";
const WIN = { start: 21 * 60, end: 23 * 60 };
const DAY = "2026-08-18";

const req = (i: number, salt = SALT): SubscribeRequest => ({
  subscription: {
    endpoint: `https://fcm.googleapis.com/fcm/send/sub${i}`,
    keys: { p256dh: "BPub", auth: `auth${i}` },
  },
  salt,
  window: WIN,
  pending: null,
});

async function setup(n = 1) {
  const store = d1Store(memoryD1());
  const morning = Date.UTC(2026, 7, 18, 0, 0); // 09:00 JST
  for (let i = 0; i < n; i++) await handleSubscribe(store, req(i), morning);
  const openAt = await openInstantMs({ salt: SALT, dateKey: DAY, window: WIN });
  return { store, openAt };
}

function deps(store: PushStore, nowMs: number, over: Partial<RunDeps> = {}) {
  const sent: Array<{ endpoint: string; ttlSec: number }> = [];
  const d: RunDeps = {
    store,
    nowMs,
    async send(endpoint, ttlSec) {
      sent.push({ endpoint, ttlSec });
      return 201;
    },
    isMaintenance: async () => false,
    ...over,
  };
  return { d, sent };
}

describe("毎分の送信", () => {
  it("開店の1分前は何も送らない", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt - 60_000);
    const r = await runOnce(d);
    expect(r.due).toBe(0);
    expect(sent).toEqual([]);
  });

  it("開店の分に1通送り、次の予定は翌日に進んでいる", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt);
    const r = await runOnce(d);

    expect(r).toMatchObject({ due: 1, sent: 1 });
    expect(sent).toEqual([{ endpoint: req(0).subscription.endpoint, ttlSec: 300 }]);

    const row = await store.find(req(0).subscription.endpoint);
    expect(dateKeyOf(row!.next_open_at)).toBe(addDays(DAY, 1));
    expect(row!.next_open_at).toBe(
      await openInstantMs({ salt: SALT, dateKey: addDays(DAY, 1), window: WIN }),
    );
  });

  it("同じ分に2回起動しても2通目は出ない", async () => {
    const { store, openAt } = await setup();
    const first = deps(store, openAt);
    const second = deps(store, openAt);
    await runOnce(first.d);
    await runOnce(second.d);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
  });

  it("並んで走った2つの起動のうち、片方だけが送る", async () => {
    const { store, openAt } = await setup(3);
    const a = deps(store, openAt);
    const b = deps(store, openAt);
    const [ra, rb] = await Promise.all([runOnce(a.d), runOnce(b.d)]);
    expect(a.sent.length + b.sent.length).toBe(3);
    expect(ra.lostRace + rb.lostRace).toBe(3);
  });

  it("遅れて起動しても閉店前なら送る。TTL は閉店までの残り", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt + 2 * 60_000 + 30_000);
    await runOnce(d);
    expect(sent).toEqual([{ endpoint: req(0).subscription.endpoint, ttlSec: 150 }]);
  });

  it("閉店後になっていたら送らずに翌日へ進める", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt + SESSION_MS);
    const r = await runOnce(d);
    expect(r.late).toBe(1);
    expect(sent).toEqual([]);
    const row = await store.find(req(0).subscription.endpoint);
    expect(dateKeyOf(row!.next_open_at)).toBe(addDays(DAY, 1));
  });

  it("何日も止まっていた行は、溜まった分を送らずに次の開店へ進む", async () => {
    const { store, openAt } = await setup();
    const threeDaysLater = openAt + 3 * 86_400_000 + 60 * 60_000;
    const { d, sent } = deps(store, threeDaysLater);
    await runOnce(d);
    expect(sent).toEqual([]);
    const row = await store.find(req(0).subscription.endpoint);
    expect(row!.next_open_at).toBeGreaterThan(threeDaysLater);
  });

  it("メンテナンス中は送らずに進める", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt, { isMaintenance: async () => true });
    const r = await runOnce(d);
    expect(r.maintenance).toBe(1);
    expect(sent).toEqual([]);
    expect(dateKeyOf((await store.find(req(0).subscription.endpoint))!.next_open_at)).toBe(
      addDays(DAY, 1),
    );
  });

  it("メンテナンス判定が失敗したら送る", async () => {
    const { store, openAt } = await setup();
    const { d, sent } = deps(store, openAt, {
      isMaintenance: () => Promise.reject(new Error("offline")),
    });
    await runOnce(d);
    expect(sent).toHaveLength(1);
  });

  it("404 / 410 の行は消え、429 / 5xx / 通信失敗の行は残る", async () => {
    const { store, openAt } = await setup(5);
    const statuses = [410, 404, 429, 503, -1];
    const { d } = deps(store, openAt, {
      async send(endpoint) {
        const i = Number(endpoint.slice(-1));
        if (statuses[i] === -1) throw new Error("network");
        return statuses[i]!;
      },
    });
    const r = await runOnce(d);
    expect(r).toMatchObject({ gone: 2, failed: 3, sent: 0 });
    expect(await store.count()).toBe(3);
    expect(await store.find(req(0).subscription.endpoint)).toBeNull();
    expect(await store.find(req(2).subscription.endpoint)).not.toBeNull();
  });

  it("上限を超えた分は次の分に送られる", async () => {
    const { store, openAt } = await setup(5);
    const first = deps(store, openAt, { limit: 3 });
    await runOnce(first.d);
    const second = deps(store, openAt + 60_000, { limit: 3 });
    await runOnce(second.d);
    expect(first.sent).toHaveLength(3);
    expect(second.sent).toHaveLength(2);
    expect(second.sent.every((s) => s.ttlSec === 240)).toBe(true);
  });

  it("壊れた行は消す", async () => {
    const db = memoryD1();
    const store = d1Store(db);
    const { openAt } = await setup();
    await handleSubscribe(store, req(0), openAt - 3_600_000);
    db.raw.exec("UPDATE push_subscriptions SET notify_end = notify_start");
    const { d, sent } = deps(store, openAt + 86_400_000);
    const r = await runOnce(d);
    expect(r.gone).toBe(1);
    expect(sent).toEqual([]);
    expect(await store.count()).toBe(0);
  });
});

describe("ttlSecFor", () => {
  it("開店の瞬間は 300 秒、閉店で 0", () => {
    expect(ttlSecFor(1000, 1000)).toBe(300);
    expect(ttlSecFor(1000, 1000 + SESSION_MS)).toBe(0);
  });
});
