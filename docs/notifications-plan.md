# Phase 3 通知 — 実装計画

`SPEC.md` §8・§12「Phase 3 — 通知」を、いまのコードの上にどう載せるかの計画。
仕様と食い違ったら `SPEC.md` が優先する。ここで仕様を変える必要が出た箇所は
§3「着手前に決めること」に挙げてあり、決まったら `SPEC.md` 側を先に直す。

---

## 1. ゴールと守る約束

**開店の瞬間に「開きました（残り5分）」とだけ届く。** タップすると開店中の画面が出る。

| 約束（CLAUDE.md） | この計画での守り方 |
|---|---|
| 1. 学習データを送らない | 送るのは購読情報・時間帯・salt だけ。記録・チケット・モードは一切送らない |
| 4. `shared/` は DOM/storage/process に触らない | 新しい共有コード（`shared/schedule.ts` `shared/push.ts`）も同じ制約。`guard.test.ts` がそのまま効く |
| 3. 時刻は `clock.ts` だけ | フロントは従来どおり。サーバー側は入口で1度だけ時刻を取り、純粋関数に渡す |
| 7. 通知オフでも全機能 | 通知は閉店中の画面に何も足さない。許可しなければ `/api/push` に一度も通信しない（テストで固定） |
| 運用費0円 | Cloudflare の Free プランだけで組む。上限を超えても**請求は来ず、通知が止まるだけ**（§4.8） |
| 通知本文に問題を含めない | push に**中身を載せない**（§3-2）。載せる手段が無いので構造的に漏れない |

## 2. 現状

できているもの：

- `shared/openTime.ts` … `openMinute` / `openInstantMs`。Worker と共有する前提で書かれていて、
  凍結ベクタ `shared/fixtures/openTime.vectors.json` もある
- `shared/dateKey.ts` `shared/window.ts` … JST 固定・04:00 境界・窓の検証
- `functions/` … Cloudflare Pages Functions（メンテナンス表示）。サーバー側の置き場はもうある
- PWA … `vite-plugin-pwa` の `generateSW`。`registerType: "prompt"`
- `src/pwa/installPrompt.ts` … `isStandalone()` / `detectPlatform()`。iOS の Web Push 判定に使える

無いもの：Worker 本体、D1、VAPID 鍵、Service Worker の push 処理、購読の UI。

## 3. 着手前に決めること

CLAUDE.md の「仕様に無いライブラリを足す前に確認」と「SPEC.md が唯一の仕様」に当たるもの。
**推奨で進めてよければ、そのまま §5 の順に着手できる。**

| # | 論点 | 推奨 | 理由 / 代替 |
|---|---|---|---|
| D1 | `push_subscriptions` の列を SPEC から変える | 変える（§4.2） | `tz_offset` は不要（窓も開店時刻も JST 固定で、端末のタイムゾーンを一度も見ていない）。代わりに「翌日から反映」の予約と、送信予定時刻 `next_open_at` が要る |
| D2 | push に中身（payload）を載せるか | **載せない** | 本文は固定文言なので Service Worker 側に持てば足りる。載せないと RFC 8291 の暗号化が丸ごと不要になり、Free プランの CPU 10ms にも収まりやすい。iOS で表示されるかは 3-2 のスパイクで先に確かめ、ダメなら暗号化を足す |
| D3 | Service Worker に push 処理を足す方法 | `workbox.importScripts` で `public/sw-push.js` を読ませる | 依存が増えず、生成される SW（プリキャッシュ・メンテナンスの経路）に手を入れない。代替は `injectManifest` で `src/sw.ts` を書く方法だが、`workbox-precaching` と `workbox-routing` を明示依存に足すことになり、SW を書き直す分の回帰リスクもある |
| D4 | `wrangler` を devDependencies に足すか | 足す（版を固定） | Worker のローカル実行・`--test-scheduled`・D1 マイグレーション・デプロイに要る。足さない場合は `npx wrangler@<版>` で都度実行 |
| D5 | 許可を求める場所 | 設定画面 ＋ 初回の案内画面（**その場で通知が使えるときだけ**） | iOS はホーム画面から開いたときにしか購読できないので、Safari で案内画面を見ている段階では出さない。閉店中の画面にはボタンを足さない（SPEC §9「ボタンはほぼ無い」） |
| D6 | Preview と Production で DB / Worker を分けるか | 分ける | 実機検証の購読が本番の D1 に混ざらないように。VAPID 鍵は1組を共有してよい |

> 決まったら **SPEC.md の §1（表定義）・§8（通知）・§11（技術スタック）を先に直す**。
> 計画書だけ直して仕様を置き去りにしない。

---

## 4. 設計

### 4.1 全体像

```
 端末                                    Cloudflare
┌──────────────────────┐   PUT/DELETE   ┌──────────────────────────────┐
│ アプリ (src/push/)    │ ─────────────→ │ Pages Functions               │
│  許可・購読・同期      │ /api/push/     │  functions/api/push/          │
│                      │ subscription   │  subscription.ts              │
│ Service Worker        │ ←── 開店時刻 ── │      │ UPSERT / DELETE        │
│  sw-push.js           │   (確認用)      │      ↓                        │
│  push → 通知を出す     │                │  D1  push_subscriptions       │
│  click → アプリを開く  │                │      ↑ SELECT 期限が来た行     │
└──────────▲───────────┘                │      │                        │
           │                            │  Worker (Cron 毎分)            │
           │  中身なしの push            │  worker/src/index.ts          │
           └──── プッシュサービス ←──────│   VAPID 署名して POST          │
            (FCM / Apple / Mozilla)     └──────────────────────────────┘
```

- **購読の受け口は Pages Functions**（同一オリジン。CORS 不要、既存の `functions/` とメンテナンス判定に乗る）
- **送信は別の Worker**。Pages Functions には Cron Trigger が無いため
- 両方が同じ D1 をバインドする。VAPID の秘密鍵を持つのは Worker だけ

### 4.2 D1 スキーマ（SPEC §1 からの差分つき）

```sql
CREATE TABLE push_subscriptions (
  endpoint      TEXT PRIMARY KEY,
  p256dh        TEXT NOT NULL,     -- 中身なし push では使わないが、D2 を覆すときのために持つ
  auth          TEXT NOT NULL,     -- 更新・削除の本人確認にも使う
  salt          TEXT NOT NULL,     -- 開店時刻の算出に必要（SPEC どおり）
  notify_start  INTEGER NOT NULL,  -- JST の分 (0-1439)
  notify_end    INTEGER NOT NULL,
  pending_start INTEGER,           -- 翌日から効く窓。無ければ NULL
  pending_end   INTEGER,
  pending_from  TEXT,              -- "YYYY-MM-DD"（のれん日）
  next_open_at  INTEGER NOT NULL,  -- 次に送る瞬間（epoch ms）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_push_next_open_at ON push_subscriptions (next_open_at);
```

- **`tz_offset` を削る。** 窓は JST の分で保存され、`dateKey` も JST 04:00 境界で決まる。
  端末のタイムゾーンは計算に一度も出てこない（`npm run test:tz` がそれを保証している）
- **`pending_*` を足す。** 時間帯の変更は翌日から反映（SPEC §3）。今日の送信時刻を動かさないために、
  サーバーも「いまの窓」と「明日からの窓」の両方を知っている必要がある
- **`next_open_at` を足す。** SPEC §8 の「毎分、その分に開店する購読者を抽出」は、
  開店時刻が SHA-256 由来なので SQL では求められない。全件を毎分読むと D1 の読み取り枠を食うので、
  **次に送る瞬間を事前に計算して索引を張る**。Cron は `next_open_at <= now` を引くだけになる
- マイグレーションは `worker/migrations/0001_push_subscriptions.sql`。Phase 5 の vault もこの番号列に続ける

### 4.3 「次に開く瞬間」を `shared/` に置く

新規 `shared/schedule.ts`。フロントと Worker が**同じ関数**で答えを出す（SPEC §3 の要求そのもの）。

```ts
export interface PendingWindow { window: TimeWindow; effectiveFrom: string }
export interface Schedule { salt: string; window: TimeWindow; pending: PendingWindow | null }

/** その のれん日 に効いている窓。src/data/settings.ts から移す。 */
export function effectiveWindow(s: Pick<Schedule, "window" | "pending">, dateKey: string): TimeWindow;

/** afterMs より**後**に来る最初の開店の瞬間。 */
export async function nextOpenInstant(s: Schedule, afterMs: number): Promise<number>;
```

- `nextOpenInstant` は `dateKeyOf(afterMs)` の日と翌日の2日だけ見ればよい。
  窓は 04:00 をまたげない（`validateWindow`）ので、翌日の開店は必ず今日のどの時刻よりも後になる
- `effectiveWindow` と `PendingWindow` は `shared/` へ移し、`src/data/settings.ts` `src/data/schema.ts` は
  re-export する。**呼び出し側は1行も変えない**
- テストは `tests/time/schedule.test.ts` に置く（`test:tz` の対象に入れるため）

### 4.4 購読の受け口（Pages Functions）

`functions/api/push/subscription.ts`。入力の型と検証は `shared/push.ts` に置き、フロントと同じ型を使う。

| | 入力 | 処理 | 返り値 |
|---|---|---|---|
| `PUT` | `{ subscription: { endpoint, keys: { p256dh, auth } }, salt, window, pending }` | 検証 → 既存行があれば `auth` 一致を確認 → `next_open_at = nextOpenInstant(now)` → UPSERT | `{ nextOpenAt }` |
| `DELETE` | `{ endpoint, auth }` | 両方一致する行を消す | `204` |

検証（`shared/push.ts` の `parseSubscribeRequest`）：

- **endpoint は https かつ既知のプッシュサービスのホストだけ**（`fcm.googleapis.com` / `*.push.apple.com` /
  `*.push.services.mozilla.com` / `*.notify.windows.com`）。任意 URL を受けると、
  Worker が毎日どこにでも POST する踏み台になる
- 窓・予約は `validateWindow` を通す。`pending_from` は `YYYY-MM-DD`
- salt は 8〜64 文字、本文は 4KB まで
- **行数の上限**（例：2万）を超えたら新規は `503`。D1 の書き込み枠を守るため

その他：

- D1 のバインディング（`DB`）は **Pages のダッシュボードで設定する**。リポジトリ直下に Pages 用の
  `wrangler.toml` を置くと、それが Pages の設定の正になり、ダッシュボードで `MAINTENANCE_MODE` を
  切り替える今の運用が崩れる
- メンテナンス中は `_middleware.ts` が `/api/push/*` も 503 にする。**通り道に足さない。**
  端末側は失敗を「次の起動でやり直す」として扱う（§4.7）
- 時刻はハンドラの入口で `Date.now()` を1度だけ取り、純粋関数に渡す。ログに endpoint・salt を出さない

### 4.5 毎分の送信（Cron Worker）

`worker/`（`wrangler.toml` / `src/index.ts` / `src/run.ts` / `src/store.ts` / `src/webpush.ts`）。

```
scheduled(controller):
  now = controller.scheduledTime                       ← 端末の時計ではなくこれを使う
  due = SELECT … WHERE next_open_at <= now
          ORDER BY next_open_at LIMIT 40               ← 1回の起動で送る上限（§4.8）
  if due が空: return                                   ← ほとんどの分はここで終わる（D1 1クエリ）

  maintenance = GET {APP_ORIGIN}/api/maintenance        ← 判定の出どころを1つに保つ
  各行について:
    next = nextOpenInstant(row, now)
  UPDATE next_open_at = next（batch）                    ← **先に進める**。送るのはその後
  for row in due:
    if maintenance が on:          送らない
    if now >= row.next_open_at(旧) + SESSION_MS: 送らない（閉店後の通知は嘘になる）
    TTL = 閉店までの残り秒                                 ← 圏外で遅れて届くのを防ぐ
    POST endpoint（中身なし, TTL, Urgency: high, Topic: noren-open, Authorization: vapid …）
    404 / 410 → その行を DELETE
  console.log(送った数・消した数・飛ばした数)               ← 件数だけ。endpoint は出さない
```

- **先に進めてから送る（at-most-once）。** 同じ分に2回起動しても2通目は出ない。
  遅れて届く通知や二重の通知の方が、1通落ちるより害が大きい
- **取りこぼしは5分以内なら拾う。** Cron が遅れたり上限で溢れたりした行は、
  次の分の `next_open_at <= now` にそのまま残る。閉店後になった行は送らずに翌日へ進める
- VAPID の JWT（ES256）は WebCrypto で署名し、プッシュサービスのオリジンごとに1回の起動で1度だけ作る。
  `sub` は `VAPID_SUBJECT`（Worker の変数。Apple は `mailto:` か `https:` 以外を拒む）
- 秘密鍵は Worker Secret `VAPID_PRIVATE_KEY`（JWK）。公開鍵は Worker の変数と
  Pages のビルド時変数 `VITE_VAPID_PUBLIC_KEY` の両方に置く
- 鍵は `scripts/gen-vapid.mjs` で作る（WebCrypto だけ。ライブラリ不要）
- D1 との境は `store.ts` の小さなインタフェースに閉じ、`run.ts` は時刻・ストア・送信関数を
  引数で受ける。テストはメモリ上のストアで回す

### 4.6 Service Worker

`public/sw-push.js` を `vite.config.ts` の `workbox.importScripts` で読ませる（D3）。

- `push` … 毎回必ず `showNotification("のれん", { body: "開きました（残り5分）", tag: "noren-open",
  icon: "/icons/icon-192.png", lang: "ja" })`。**表示しない分岐を作らない**
  （Safari は通知を出さない push が続くと許可ごと取り消す）
- `notificationclick` … 既存のウィンドウがあればフォーカス、無ければ `/` を開く。
  開いたあとはアプリ側の `focus` / `visibilitychange` → `TICK` が今までどおり開店させるので、
  **SW から状態に触る必要は無い**
- 文言は `shared/push.ts` の定数と二重持ちになる。`sw-push.js` に同じ文字列が入っていることを
  テストで確かめる（`guard.test.ts` と同じ grep 方式）
- `pushsubscriptionchange` は扱わない。Chrome は発火しないので、どのみち起動時の照合（§4.7）が本命

**更新のずれについて。** `registerType: "prompt"` なので、新しい SW は全タブを閉じるまで有効にならない。
ただし画面の JS も同じプリキャッシュから出るので、「通知の UI があるのに SW が古い」は普通は起きない。
念のため、購読の前に SW へ `postMessage` で問い合わせ、`sw-push.js` が応答しなければ
「アプリを開き直すと使えます」と出す。

### 4.7 端末側

新規 `src/push/support.ts` `src/push/client.ts` `src/data/push.ts`。**`/api/push` への通信は `client.ts` からだけ。**

**状態**

```ts
type PushStatus =
  | "hidden"         // VITE_VAPID_PUBLIC_KEY が無いビルド。カードごと出さない
  | "unsupported"    // PushManager / Notification が無い
  | "needs-install"  // iOS でホーム画面から開いていない
  | "denied"         // 許可を拒否された
  | "off" | "on"
  | "busy"           // 登録・解除の通信中
  | "error";         // 登録できなかった（次の起動でやり直す）
```

**保存** … `noren:push` に `{ endpoint, synced, syncedAtMs }`。`synced` は
`{ endpoint, salt, window, pending }` を JSON にした文字列（指紋）。

- **書き出し（バックアップ）に含めない。** 購読は端末ごとのもので、別の端末に持っていっても意味が無い
- `clearAll()` で消えたのにブラウザ側の購読だけ残っていたら、**ブラウザ側を解除するだけ**にする。
  同意が確かでない状態でサーバーに送り直さない。サーバーの行は次の送信で 410 になって消える

**状態機械（`machine.ts` は純粋なまま）**

- `AppState.push: { status: PushStatus }` を足す
- Event：`PUSH_STATUS` / `PUSH_ENABLE_REQUESTED` / `PUSH_DISABLE_REQUESTED`
- Effect：`pushEnable` / `pushDisable` / `pushSync` / `clearNotifications`
- `WINDOW_REQUESTED` と `ONBOARDING_DONE` は、`status === "on"` なら `pushSync` を出す
- `startSession` は `clearNotifications` を出す（開いた時点で通知の役目は終わり。残すと翌日まで残骸になる）

**許可と購読はクリックの同期区間で呼ぶ。** iOS はユーザー操作の直後でないと許可ダイアログを出さない。
`store.dispatch` は Effect を同期で実行するので経路はそのままでよいが、`navigator.serviceWorker.ready` を
クリック後に `await` すると操作の文脈が切れうる。**registration は起動時に取っておき**、クリックでは
`registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` を直接呼ぶ。

**同期（`pushSync`）**

- 起動時（`HYDRATED` の後）・窓の変更後・読み込み後（`reload` → 起動）に、指紋が変わっていれば `PUT`
- 指紋が同じでも、**最後の同期から7日たっていれば `PUT` し直す**（サーバー側で消えていた場合の自己修復）
- `pushManager.getSubscription()` の endpoint が保存値と違えば作り直されたとみなして `PUT`
- `Notification.permission === "denied"` なら保存を消し `denied` にする
- 失敗したら指紋を更新しない。次の起動でやり直す（メンテナンス中の 503 もこれで吸収する）
- `PUT` の返り値 `nextOpenAt` は、dev パネルに端末側の計算と並べて出す（パリティの目視確認用）

**解除** … `subscription.unsubscribe()` を先に済ませ、`DELETE` は失敗してもよい（行は 410 で消える）。

**画面**

設定画面に「通知」のカードを足す（「開く時間帯」の直下）。色・形は既存の `btn` だけを使い、新しい色を足さない。

| 状態 | 出すもの |
|---|---|
| off | `[開いたら通知する]` 「開いた瞬間に『開きました（残り5分）』とだけ届きます。オンにすると、開く時刻の計算に必要な値（時間帯と乱数の種）だけをサーバーに預けます。学習の記録は送りません。」 |
| on | `[通知を止める]` 「止めると、預けた値はサーバーから消します。」 |
| needs-install | 「iPhone では、ホーム画面に追加したアプリからだけ通知を受け取れます。」＋既存の `[追加のしかた]` |
| denied | 「通知が許可されていません。端末の設定でこのアプリの通知を許可すると使えます。」 |
| unsupported | 「このブラウザは通知に対応していません。時刻になったらアプリを開いてください。」 |
| error | 「通知の登録に失敗しました。通信できる場所でもう一度お試しください。」 |

- **初回の案内画面（`install`）** … 通知がその場で使えるとき（iOS のホーム画面起動 / Android / デスクトップ）
  だけ、同じ文言のカードと `[開いたら通知する]` を出す。断っても「はじめる」で進める（D5）
- **閉店中の画面** … ボタンは足さない。`note()` の文言だけ、通知オンなら「開いたら通知でお知らせします」に変える
  （いまの「通知はまだ無い」のコメントもここで直す）

**dev パネル** … `通知: 実機/未対応/要追加/拒否/成功` を足す（`src/dev/fakePush.ts`。`マイク:` と同じ作り）。
dev サーバには SW も `/api/push` も無いので、ここを通さないと設定画面の各状態を一度も見られない。

### 4.8 運用費0円の確認

Free プランの上限（2026年10月時点の公式ドキュメント。**着手時にもう一度確かめる**）：

| | 上限 | このアプリでの使い方 |
|---|---|---|
| Workers リクエスト | 10万/日 | Cron 1440回/日 ＋ `/api/maintenance` ＋ 購読の PUT（変化時と7日に1回だけ） |
| Workers CPU | 10ms/起動（Cron も同じ） | 中身なし push なら署名はオリジンごとに1回。暗号化を足すなら上限を下げる |
| サブリクエスト | 50/起動 | 1回の送信上限を 40 に置く。溢れた分は次の分に回る |
| Cron Trigger | 5/アカウント | Production・Preview で2つ |
| D1 読み取り | 500万行/日 | 索引で期限の来た行だけ読む。購読者あたり1日1〜2行 |
| D1 書き込み | 10万行/日 | 購読者あたり1日2行前後（`next_open_at` の更新＋索引）。**数万人がこの構成の天井** |

- 2026年9月1日から、Free プランの D1 は上限超過で**クエリが失敗する**（課金されない）。
  Workers も同様に失敗するだけ。つまり利用者が増えて枠を超えても、**開発者に請求は来ず、通知が止まるだけ**。
  アプリ本体は通知なしで全機能が動くので、SPEC の「運用費0円」と CLAUDE.md の約束7の両方が守られる
- 同じ分に 40 人以上が開店する規模（同じ2時間の窓に数千人）になったら、溢れた人は最大で数分遅れる。
  検証（3〜5人）の規模では起きない。起きたら上限か送り方を見直す

---

## 5. 作業ステップ

各ステップの終わりに `npm run typecheck` `npm test` `npm run test:tz` `npm run build` が通り、
**アプリは通知なしで今までどおり動く**こと。通知の UI は 3-6 まで出さない。

### 3-1 Web Push の芯（VAPID と送信リクエスト）

**対象**：新規 `worker/src/webpush.ts` `scripts/gen-vapid.mjs` `scripts/push-send.ts` `tsconfig.worker.json`、
`tsconfig.json`（参照を足す）、`tests/push/webpush.test.ts`

- base64url、ES256 の JWT（`crypto.subtle.sign` の出力は r‖s なので JWS にそのまま使える）
- `buildPushRequest(endpoint, { ttl, topic, urgency }, vapid)` → 中身なしの `Request`
- `gen-vapid.mjs` は公開鍵（非圧縮65バイトの base64url）と秘密鍵（JWK）を出すだけ
- `push-send.ts` は購読 JSON を1つ受けて1通送る。3-2 のスパイクと、本番での手動確認に使う

**DoD**：テストで JWT が公開鍵で検証でき、`TTL` `Urgency` `Topic` `Authorization: vapid t=…, k=…` が揃っている。

### 3-2 スパイク：iPhone に中身なしで届くか（使い捨てのブランチ）

SPEC §14 が「先に潰れる可能性が高い」3番目に挙げている。**D1 や UI を作る前に確かめる。**

- `spike/push` ブランチに、`sw-push.js` と「購読して JSON を表示する」だけの隠しボタンを置き、Preview にデプロイ
- iPhone（iOS 16.4 以上・ホーム画面から起動）と Android Chrome で購読し、`push-send.ts` で送る
- 確かめること：中身なしで通知が出るか／タップでアプリが開くか／`TTL` を短くして圏外にすると届かないか／
  Apple が `VAPID_SUBJECT` を受け付けるか
- **結果をこの計画書に追記する。** 中身なしで出なければ、3-5 に RFC 8291（aes128gcm）の暗号化を足す。
  RFC 8291 付録の例をそのままテストベクタにする
- このブランチはマージしない

**DoD**：両方の端末での結果と、D2 の最終判断が書かれている。

### 3-3 「次に開く瞬間」を shared に置く

**対象**：新規 `shared/schedule.ts` `tests/time/schedule.test.ts`、`src/data/settings.ts` `src/data/schema.ts`（移して re-export）

- §4.3 のとおり
- テスト：凍結ベクタの `expectedInstantMs` と一致する／開店のちょうどその瞬間を渡すと翌日になる／
  予約が効く日から窓が切り替わる／23:00–01:00 の窓で 0時台の開店が前の のれん日 に属する

**DoD**：アプリの挙動が変わらない。4つのタイムゾーンで同じ答えになる。

### 3-4 購読の保存（D1 ＋ Pages Functions）

**対象**：新規 `worker/migrations/0001_push_subscriptions.sql` `shared/push.ts`
`functions/api/push/subscription.ts` `tests/push/api.test.ts`

- §4.2・§4.4 のとおり。D1 は Preview 用と Production 用を作り、Pages のダッシュボードで `DB` をそれぞれに繋ぐ
- テスト：不正な endpoint・窓・salt・大きすぎる本文が 400／`auth` が違う更新と削除が拒まれる／
  `nextOpenAt` が `nextOpenInstant` と一致する

**DoD**：Preview に `curl` で PUT すると D1 に1行入り、DELETE で消える。アプリからはまだ呼ばれない。

### 3-5 毎分の送信（Cron Worker）

**対象**：新規 `worker/wrangler.toml` `worker/src/index.ts` `worker/src/run.ts` `worker/src/store.ts`
`tests/push/run.test.ts`、`tests/guard.test.ts`（走査対象に `worker/src` を足し、入口の `index.ts` だけ除く）

- §4.5 のとおり。`wrangler.toml` に `[triggers] crons = ["* * * * *"]` と `env.preview`
- デプロイは Workers Builds（Git 連携・ルート `worker/`）か `wrangler deploy`
- テスト（メモリ上のストアと偽の送信関数で）：
  - 期限の来た行だけ送る。送る前に `next_open_at` が翌日へ進んでいる
  - 同じ `scheduledTime` で2回走らせても送信は1回
  - 閉店後になった行は送らずに進める。`TTL` が閉店までの残り秒になっている
  - 410 / 404 の行が消え、429 / 5xx の行は残る
  - メンテナンス中は送らずに進める
  - 上限を超えた分は次の分に送られる

**DoD**：`wrangler dev --test-scheduled` で、3-4 で入れた自分の購読に1通届く。

### 3-6 端末側（Service Worker・購読・画面）

**対象**：新規 `public/sw-push.js` `src/push/support.ts` `src/push/client.ts` `src/data/push.ts`
`src/dev/fakePush.ts` `tests/push/client.test.ts`、
変更 `vite.config.ts` `src/data/storage.ts`（`KEYS.push`） `src/app/machine.ts` `src/app/effects.ts`
`src/app/store.ts` `src/main.ts` `src/ui/screens/settings.ts` `src/ui/screens/install.ts`
`src/ui/screens/closed.ts` `index.html` `src/dev/panel.ts` `tests/machine.test.ts`

- §4.6・§4.7 のとおり
- **Pages の `VITE_VAPID_PUBLIC_KEY` はこの段階では Preview にだけ設定する。** Production はカードが出ない
- テスト：
  - **通知を有効にしていなければ `fetch('/api/push…')` が一度も呼ばれない**（約束1・7の機械的な保証）
  - `WINDOW_REQUESTED` が `status === "on"` のときだけ `pushSync` を出す
  - 指紋が同じなら PUT しない／7日たてば PUT する／失敗したら指紋を更新しない
  - 書き出した JSON に `noren:push` の中身が入らない
  - `sw-push.js` の文言が `shared/push.ts` の定数と一致する

**DoD**：Preview URL で、Android Chrome と iPhone（ホーム画面）の両方で
オン → 開店時刻に通知 → タップで開店中の画面、が通る。オフにすると D1 から行が消える。

### 3-7 実機で7日、それから本番

- Preview で自分の端末を7日間使う。SPEC §13 の手書きの記録に
  「通知は来たか／何秒遅れたか／通知から開いたか」を足す
- 問題なければ Production の D1・Worker・`VITE_VAPID_PUBLIC_KEY` を設定して公開
- `SPEC.md`（§1・§8・§11）と `CLAUDE.md`（コマンド、dev パネルの `通知:`、実機検証の手順）を更新
- Phase 4 の利用ログに「通知をオンにした／切った」（日付と種別だけ）を残す口を用意する。
  SPEC §13 の「通知を切った人が何人出たか」を、聞き取りだけでなく記録からも裏付けられる

**DoD**：本番で通知が届き、通知を許可しない端末では今までどおり全機能が使える。

---

## 6. リスクと手当て

| リスク | 手当て |
|---|---|
| iOS で中身なし push が表示されない | 3-2 で最初に確かめる。ダメなら aes128gcm を実装（ライブラリは足さず WebCrypto で） |
| Cron が遅れる・飛ぶ | `next_open_at <= now` で取りこぼしを拾い、閉店前なら遅れても送る。閉店後は送らない |
| 端末の時計がずれている | 通知はサーバーの時刻、開店は端末の時刻で決まるので、ずれた分だけ食い違う。今回は直さず、7日の試用で起きるかを見る（`clockAnomaly` と同じ扱い） |
| 新しい SW がなかなか有効にならない | 画面と SW は同じプリキャッシュから出るので普通は揃う。揃わないときは `postMessage` の応答で検知して「開き直してください」と出す |
| 任意 URL を登録されて踏み台にされる | endpoint をプッシュサービスのホストに限る。行数の上限 |
| 無料枠を超える | 請求は来ず通知が止まるだけ。アプリ本体は動く（§4.8） |
| `wrangler.toml` を置いて Pages の設定を壊す | Pages 用は置かない。`worker/` の中だけに置く |

## 7. やらないこと

- 通知の時刻や文言を利用者が変える設定（SPEC は「開きました（残り5分）」だけ）
- 予告通知（「5分後に開きます」など）。開店の瞬間の1通だけ
- 長く開いていない人への送信停止。そのために最終利用日をサーバーへ送ると約束1に触れる。止めたい人は OS で切れる
- `pushsubscriptionchange` の処理（起動時の照合で拾う）
- サーバー側での利用統計。件数のログ以上は取らない

## 8. 参考

- Cloudflare Workers の上限：https://developers.cloudflare.com/workers/platform/limits/
- D1 の料金と上限：https://developers.cloudflare.com/d1/platform/pricing/
- D1 の Free プラン上限の適用（2026-09-01）：https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Safari の Web Push（通知を必ず表示すること）：https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- RFC 8030（Web Push）／ RFC 8292（VAPID）／ RFC 8291（暗号化。D2 を覆すときだけ）
