// 1つの購読に、中身なしの push を1通だけ送る。実機の確認用。
//
//   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY='{"kty":…}' VAPID_SUBJECT=mailto:… \
//     node --experimental-strip-types scripts/push-send.ts subscription.json [ttl秒]
//
// subscription.json は PushSubscription.toJSON() の形（{ endpoint, keys: { p256dh, auth } }）。
// 送信は Worker と同じ worker/src/webpush.ts を通るので、ここで届けば Worker からも届く。
import { readFileSync } from "node:fs";
import { createVapidSigner, isValidSubject } from "../worker/src/webpush.ts";

const [file, ttlArg] = process.argv.slice(2);
const publicKey = process.env["VAPID_PUBLIC_KEY"];
const privateJwk = process.env["VAPID_PRIVATE_KEY"];
const subject = process.env["VAPID_SUBJECT"];

if (!file || !publicKey || !privateJwk || !subject) {
  console.error(
    "使い方: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT を環境変数に置き、購読 JSON のパスを渡す",
  );
  process.exit(2);
}
if (!isValidSubject(subject)) {
  console.error("VAPID_SUBJECT は mailto: か https: で始めること（Apple が拒むため）");
  process.exit(2);
}

const sub = JSON.parse(readFileSync(file, "utf8")) as { endpoint?: unknown };
if (typeof sub.endpoint !== "string") {
  console.error("購読 JSON に endpoint がありません");
  process.exit(2);
}

const signer = createVapidSigner(
  { publicKey, privateJwk, subject },
  Math.floor(Date.now() / 1000),
);
const req = await signer.request(sub.endpoint, {
  ttlSec: Number(ttlArg ?? 300),
  topic: "noren-open",
  urgency: "high",
});
const res = await fetch(req);
console.log(`${res.status} ${res.statusText}`);
const text = await res.text();
if (text) console.log(text);
process.exit(res.ok ? 0 : 1);
