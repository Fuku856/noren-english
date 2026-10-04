// VAPID 鍵を1組作る。ライブラリは使わず WebCrypto だけ。
//
//   node scripts/gen-vapid.mjs
//
// 出力のうち
//   - VAPID_PUBLIC_KEY  … Worker の変数と、Pages のビルド時変数 VITE_VAPID_PUBLIC_KEY の両方に置く
//   - VAPID_PRIVATE_KEY … Worker Secret にだけ置く（`wrangler secret put VAPID_PRIVATE_KEY`）
//
// ⚠ 秘密鍵はリポジトリにも .env にも書かないこと。
// ⚠ 鍵を作り直すと、既存の購読はすべて無効になる（applicationServerKey が変わるため）。
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const privateJwk = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });

console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk}`);
