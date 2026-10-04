import { describe, expect, it } from "vitest";
import {
  audienceOf,
  b64url,
  buildPushRequest,
  createVapidSigner,
  fromB64url,
  isValidSubject,
  JWT_TTL_SEC,
  vapidJwt,
  importVapidPrivateKey,
} from "../../worker/src/webpush";

async function makeKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(raw), privateJwk: JSON.stringify(jwk), verifyKey: pair.publicKey };
}

const dec = new TextDecoder();
const NOW = 1_787_000_000;
const FCM = "https://fcm.googleapis.com/fcm/send/abc:def";
const APPLE = "https://web.push.apple.com/QGx1Zm9v";

describe("base64url", () => {
  it("往復で元に戻る（パディングなし）", () => {
    for (const n of [0, 1, 2, 3, 16, 65]) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const s = b64url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      expect([...fromB64url(s)]).toEqual([...bytes]);
    }
  });
});

describe("VAPID の JWT", () => {
  it("公開鍵で検証でき、aud・exp・sub が入っている", async () => {
    const k = await makeKeys();
    const key = await importVapidPrivateKey(k.privateJwk);
    const jwt = await vapidJwt(key, "https://fcm.googleapis.com", "mailto:a@example.com", NOW);

    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(dec.decode(fromB64url(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(dec.decode(fromB64url(c!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: NOW + JWT_TTL_SEC,
      sub: "mailto:a@example.com",
    });

    const sig = fromB64url(s!);
    expect(sig.length).toBe(64); // r‖s。DER ではない
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      k.verifyKey,
      sig,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("有効期間は24時間以内（RFC 8292）", () => {
    expect(JWT_TTL_SEC).toBeLessThanOrEqual(24 * 3600);
  });

  it("subject は mailto: か https: だけ", () => {
    expect(isValidSubject("mailto:me@example.com")).toBe(true);
    expect(isValidSubject("https://noren.example")).toBe(true);
    expect(isValidSubject("me@example.com")).toBe(false);
    expect(isValidSubject("http://noren.example")).toBe(false);
  });
});

describe("push リクエスト", () => {
  it("中身なし・TTL・Urgency・Topic・Authorization が揃う", async () => {
    const req = buildPushRequest(
      FCM,
      { ttlSec: 287.9, topic: "noren-open", urgency: "high" },
      "a.b.c",
      "PUBKEY",
    );
    expect(req.method).toBe("POST");
    expect(req.url).toBe(FCM);
    expect(req.headers.get("TTL")).toBe("287");
    expect(req.headers.get("Urgency")).toBe("high");
    expect(req.headers.get("Topic")).toBe("noren-open");
    expect(req.headers.get("Authorization")).toBe("vapid t=a.b.c, k=PUBKEY");
    expect(req.headers.get("Content-Type")).toBeNull();
    expect((await req.arrayBuffer()).byteLength).toBe(0);
  });

  it("TTL は負にならない", () => {
    const req = buildPushRequest(FCM, { ttlSec: -3, topic: "t", urgency: "high" }, "j", "k");
    expect(req.headers.get("TTL")).toBe("0");
  });

  it("aud はプッシュサービスの origin", () => {
    expect(audienceOf(FCM)).toBe("https://fcm.googleapis.com");
    expect(audienceOf(APPLE)).toBe("https://web.push.apple.com");
  });
});

describe("署名器", () => {
  it("同じオリジンへは JWT を1度しか作らない", async () => {
    const k = await makeKeys();
    const signer = createVapidSigner(
      { publicKey: k.publicKey, privateJwk: k.privateJwk, subject: "mailto:a@example.com" },
      NOW,
    );
    const a = await signer.jwtFor(FCM);
    const b = await signer.jwtFor("https://fcm.googleapis.com/fcm/send/other");
    const c = await signer.jwtFor(APPLE);
    expect(a).toBe(b);
    expect(c).not.toBe(a);

    const req = await signer.request(APPLE, { ttlSec: 60, topic: "noren-open", urgency: "high" });
    expect(req.headers.get("Authorization")).toBe(`vapid t=${c}, k=${k.publicKey}`);
  });
});
