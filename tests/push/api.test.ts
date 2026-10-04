import { describe, expect, it } from "vitest";
import { dayStartMs, jstMinuteToEpoch } from "@shared/dateKey";
import { openInstantMs } from "@shared/openTime";
import {
  isAllowedEndpoint,
  MAX_REQUEST_BYTES,
  parseSubscribeRequest,
  type SubscribeRequest,
} from "@shared/push";
import { nextOpenInstant } from "@shared/schedule";
import { d1Store, handleSubscribe, handleUnsubscribe, parseBody } from "@shared/pushServer";
import { memoryD1 } from "./sqlite";

const SALT = "9f2c1d4e-7a3b-4c5d-8e6f-0a1b2c3d4e5f";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:def";

const req = (over: Partial<SubscribeRequest> = {}): SubscribeRequest => ({
  subscription: { endpoint: ENDPOINT, keys: { p256dh: "BPub_key-1", auth: "authSecret" } },
  salt: SALT,
  window: { start: 21 * 60, end: 23 * 60 },
  pending: null,
  ...over,
});

const MORNING = jstMinuteToEpoch("2026-08-18", 8 * 60);

describe("宛先の制限", () => {
  it("既知のプッシュサービスだけ通す", () => {
    expect(isAllowedEndpoint(ENDPOINT)).toBe(true);
    expect(isAllowedEndpoint("https://web.push.apple.com/QGx1")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
  });

  it("それ以外は通さない", () => {
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/x", // https でない
      "https://example.com/push",
      "https://evilpush.apple.com/x", // サフィックスの騙し
      "https://fcm.googleapis.com.evil.example/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "not a url",
      `https://fcm.googleapis.com/${"a".repeat(1100)}`,
    ]) {
      expect(isAllowedEndpoint(bad), bad).toBe(false);
    }
  });
});

describe("入力の検証", () => {
  it("正しい入力は通る", () => {
    expect(parseSubscribeRequest(req())).toEqual(req());
  });

  it("壊れた入力は丸ごと拒む", () => {
    const cases: unknown[] = [
      null,
      [],
      { ...req(), salt: "short" },
      { ...req(), salt: "x".repeat(65) },
      { ...req(), window: { start: 21 * 60, end: 21 * 60 + 30 } }, // 60分未満
      { ...req(), window: { start: 2 * 60, end: 6 * 60 } }, // 04:00 をまたぐ
      { ...req(), window: { start: "21:00", end: "23:00" } },
      { ...req(), pending: { window: { start: 420, end: 540 }, effectiveFrom: "tomorrow" } },
      { ...req(), subscription: { endpoint: "https://example.com/x", keys: req().subscription.keys } },
      { ...req(), subscription: { endpoint: ENDPOINT, keys: { p256dh: "a b", auth: "x" } } },
      { ...req(), subscription: { endpoint: ENDPOINT } },
    ];
    for (const c of cases) expect(parseSubscribeRequest(c)).toBeNull();
  });

  it("学習データを入れる口が無い（余計な項目は落とす）", () => {
    const parsed = parseSubscribeRequest({ ...req(), records: [{ date: "2026-08-18" }] });
    expect(parsed).not.toHaveProperty("records");
  });

  it("大きすぎる本文と JSON でない本文は読まない", () => {
    expect(parseBody("{")).toBeNull();
    expect(parseBody(JSON.stringify({ pad: "x".repeat(MAX_REQUEST_BYTES) }))).toBeNull();
    expect(parseBody(JSON.stringify(req()))).toEqual(req());
  });
});

describe("PUT /api/push/subscription", () => {
  it("登録すると1行入り、次の送信時刻が返る", async () => {
    const db = memoryD1();
    const store = d1Store(db);
    const r = await handleSubscribe(store, req(), MORNING);

    const expected = await openInstantMs({
      salt: SALT,
      dateKey: "2026-08-18",
      window: req().window,
    });
    expect(r).toEqual({ status: 200, body: { nextOpenAt: expected } });

    const row = await store.find(ENDPOINT);
    expect(row).toMatchObject({
      salt: SALT,
      notify_start: 21 * 60,
      notify_end: 23 * 60,
      pending_start: null,
      next_open_at: expected,
      created_at: MORNING,
      updated_at: MORNING,
    });
    expect(await store.count()).toBe(1);
  });

  it("予約した窓も保存され、翌日の送信時刻に効く", async () => {
    const store = d1Store(memoryD1());
    const next = { start: 7 * 60, end: 9 * 60 };
    const night = jstMinuteToEpoch("2026-08-18", 23 * 60 + 30);
    const body = req({ pending: { window: next, effectiveFrom: "2026-08-19" } });
    const r = await handleSubscribe(store, body, night);

    const expected = await openInstantMs({ salt: SALT, dateKey: "2026-08-19", window: next });
    expect(r.body).toEqual({ nextOpenAt: expected });
    expect(await store.find(ENDPOINT)).toMatchObject({
      pending_start: 7 * 60,
      pending_end: 9 * 60,
      pending_from: "2026-08-19",
    });
  });

  it("同じ宛先の更新は、auth が一致したときだけ。created_at は保つ", async () => {
    const store = d1Store(memoryD1());
    await handleSubscribe(store, req(), MORNING);

    const later = MORNING + 3_600_000;
    const changed = req({ window: { start: 19 * 60, end: 22 * 60 } });
    expect((await handleSubscribe(store, changed, later)).status).toBe(200);
    expect(await store.find(ENDPOINT)).toMatchObject({
      notify_start: 19 * 60,
      created_at: MORNING,
      updated_at: later,
    });

    const hijack = req({
      subscription: { endpoint: ENDPOINT, keys: { p256dh: "BPub", auth: "someoneElse" } },
      salt: "attacker-salt-0000",
    });
    expect((await handleSubscribe(store, hijack, later)).status).toBe(403);
    expect((await store.find(ENDPOINT))?.salt).toBe(SALT);
  });

  it("上限に達したら新規は 503。既存の更新は通す", async () => {
    const store = d1Store(memoryD1());
    await handleSubscribe(store, req(), MORNING, 1);
    const other = req({
      subscription: { endpoint: `${ENDPOINT}2`, keys: req().subscription.keys },
    });
    expect((await handleSubscribe(store, other, MORNING, 1)).status).toBe(503);
    expect((await handleSubscribe(store, req(), MORNING, 1)).status).toBe(200);
  });

  it("不正な入力は 400 で、何も書かない", async () => {
    const store = d1Store(memoryD1());
    expect((await handleSubscribe(store, { ...req(), salt: 1 }, MORNING)).status).toBe(400);
    expect(await store.count()).toBe(0);
  });

  it("返る時刻は nextOpenInstant と一致する（端末とのパリティ）", async () => {
    const store = d1Store(memoryD1());
    const at = dayStartMs("2026-12-31");
    const r = await handleSubscribe(store, req(), at);
    expect(r.body).toEqual({
      nextOpenAt: await nextOpenInstant({ salt: SALT, window: req().window, pending: null }, at),
    });
  });
});

describe("DELETE /api/push/subscription", () => {
  it("endpoint と auth が一致したときだけ消える", async () => {
    const store = d1Store(memoryD1());
    await handleSubscribe(store, req(), MORNING);

    expect(await handleUnsubscribe(store, { endpoint: ENDPOINT, auth: "wrong" })).toEqual({
      status: 204,
      body: null,
    });
    expect(await store.count()).toBe(1);

    await handleUnsubscribe(store, { endpoint: ENDPOINT, auth: "authSecret" });
    expect(await store.count()).toBe(0);
  });

  it("不正な入力は 400", async () => {
    const store = d1Store(memoryD1());
    expect((await handleUnsubscribe(store, { endpoint: "x", auth: "y" })).status).toBe(400);
  });
});
