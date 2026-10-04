/**
 * Web Push の送信リクエストを組む（RFC 8030 / RFC 8292 VAPID）。
 *
 * **中身（payload）は載せない。** 通知の文言は Service Worker（public/sw-push.js）が持つ。
 * 載せないので RFC 8291 の暗号化が要らず、問題文が通知に漏れる経路も無い。
 * p256dh / auth は D1 に持っているが、ここでは使わない。
 *
 * WebCrypto だけで書く。Worker・Node（scripts/push-send.ts）・テストのどこでも同じに動く。
 * 時刻は引数で受け取る（CLAUDE.md 約束3）。
 */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface VapidConfig {
  /** 非圧縮の P-256 公開鍵（65バイト）を base64url にしたもの。アプリの applicationServerKey と同じ値。 */
  publicKey: string;
  /** 秘密鍵の JWK（JSON 文字列）。Worker Secret VAPID_PRIVATE_KEY に置く。 */
  privateJwk: string;
  /** `mailto:` か `https:`。Apple はそれ以外を BadJwtToken で拒む。 */
  subject: string;
}

/** JWT の有効期間。上限は24時間（RFC 8292）。余裕を見て12時間。 */
export const JWT_TTL_SEC = 12 * 3600;

export function isValidSubject(subject: string): boolean {
  return /^mailto:.+@.+/.test(subject) || /^https:\/\/.+/.test(subject);
}

export async function importVapidPrivateKey(privateJwk: string): Promise<CryptoKey> {
  const j = JSON.parse(privateJwk) as Record<string, unknown>;
  const field = (k: string): string => {
    const v = j[k];
    if (typeof v !== "string") throw new Error(`VAPID 秘密鍵の JWK に ${k} がありません`);
    return v;
  };
  // key_ops や ext が付いた JWK でも読めるよう、必要な項目だけ渡す
  const jwk = { kty: field("kty"), crv: field("crv"), x: field("x"), y: field("y"), d: field("d") };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** 宛先 URL の origin。VAPID の aud はプッシュサービスのオリジン単位。 */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * ES256 の JWT。WebCrypto の ECDSA 署名は r‖s（64バイト）で出てくるので、
 * JWS の形式にそのまま使える（DER からの変換は要らない）。
 */
export async function vapidJwt(
  key: CryptoKey,
  audience: string,
  subject: string,
  nowSec: number,
): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    enc.encode(JSON.stringify({ aud: audience, exp: nowSec + JWT_TTL_SEC, sub: subject })),
  );
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(input),
  );
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

export type Urgency = "very-low" | "low" | "normal" | "high";

export interface PushOptions {
  /** 秒。閉店までの残りを入れる。圏外で遅れて届いた通知は嘘になる。 */
  ttlSec: number;
  /** 同じ topic の未配達メッセージは置き換えられる。32文字以内の base64url 文字。 */
  topic: string;
  urgency: Urgency;
}

/** 中身なしの push リクエスト。 */
export function buildPushRequest(
  endpoint: string,
  opts: PushOptions,
  jwt: string,
  publicKey: string,
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      TTL: String(Math.max(0, Math.floor(opts.ttlSec))),
      Urgency: opts.urgency,
      Topic: opts.topic,
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
    },
    // 空の本文。Content-Length: 0 になり、Content-Type は付かない
    body: new Uint8Array(0),
  });
}

/**
 * 1回の起動のあいだ使う署名器。JWT はプッシュサービスのオリジンごとに1度だけ作る。
 * Free プランの CPU 10ms に収めるため、宛先ごとに署名し直さない。
 */
export function createVapidSigner(cfg: VapidConfig, nowSec: number) {
  let keyPromise: Promise<CryptoKey> | null = null;
  const jwts = new Map<string, Promise<string>>();

  return {
    publicKey: cfg.publicKey,
    jwtFor(endpoint: string): Promise<string> {
      const aud = audienceOf(endpoint);
      let jwt = jwts.get(aud);
      if (!jwt) {
        keyPromise ??= importVapidPrivateKey(cfg.privateJwk);
        jwt = keyPromise.then((key) => vapidJwt(key, aud, cfg.subject, nowSec));
        jwts.set(aud, jwt);
      }
      return jwt;
    },
    async request(endpoint: string, opts: PushOptions): Promise<Request> {
      return buildPushRequest(endpoint, opts, await this.jwtFor(endpoint), cfg.publicKey);
    },
  };
}

export type VapidSigner = ReturnType<typeof createVapidSigner>;
