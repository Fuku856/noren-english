# CLAUDE.md

**`SPEC.md` が唯一の仕様。** 迷ったら SPEC.md に戻ること。

- フェーズ単位で進め、**各フェーズ終了時に必ず動く状態**にする
- **仕様に無いライブラリを足す前に確認すること**
- Phase 1〜4 は `dev` ブランチに直接積む。完成後は `feat/*` `fix/*` → `dev` → `main`

## 破ってはいけない設計上の約束

1. **学習データをサーバーに送らない。** 通信はアプリ本体と例文JSONの取得だけ
   （Phase 3 の購読情報、Phase 5 の暗号化済み vault を除く）
2. **例文の選択に `salt` を混ぜない。** 全世界で同じ1文になることが要
3. **`src/app/clock.ts` 以外で `Date.now()` / 引数なし `new Date()` を書かない。**
   時刻を注入できないと1日1回しか開かないアプリはテストできない
4. **`shared/` は `window` `document` `localStorage` `process` に触らない。**
   フロントと Cloudflare Worker の両方から読まれる
5. **色は意味にだけ対応させる。** 藍＝押せるもの / 青緑＝合っていた語 / 朱＝違っていた語。
   装飾に機能色を使わない。ダークテーマは作らない（地は白）
6. **連続日数をどこにも表示しない。** 「今週」は やった日に丸が置かれるだけで、
   欠けた日は空のまま描く。分母（3回中2回など）も出さない
7. 通知オフでも全機能が使えること。パスキーを作らなくても全機能が使えること

## コマンド

```
npm run dev          開発サーバ
npm test             vitest
npm run test:tz      複数タイムゾーンで時刻ロジックを検証
npm run data:check   例文JSONの健全性チェック
npm run build        本番ビルド
npm run vapid:gen    通知の VAPID 鍵を1組作る（秘密鍵はどこにもコミットしない）
npm run push:send    購読 JSON 1つに通知を1通送る（実機確認用）
```

## 通知（Phase 3）

- 構成: 購読の受け口は Pages Functions（`functions/api/push/subscription.ts`）、
  送信は別の Worker（`worker/`、Cron で毎分）。両方が同じ D1 を使う。詳細は `docs/notifications-plan.md`
- **push に中身を載せない。** 文言は `public/sw-push.js` が持つ。`shared/push.ts` と一致させる
- `/api/push` に通信するのは `src/push/client.ts` だけ。押すまで一度も通信しない（テストで固定）
- `VITE_VAPID_PUBLIC_KEY` の無いビルドでは通知の UI が出ない
- リポジトリ直下に Pages 用の `wrangler.toml` を置かない（ダッシュボードの MAINTENANCE_MODE 運用が崩れる）

## 開発用パネル（dev ビルドのみ）

画面下に出る。**音読モードは既定ではないので、ここを通さないと出てこない。**

- `音読で開く` — 音読モードで開店させる（セッション中なら今の問題を音読に切り替える）
- `マイク: 実機/そのまま/1語違い/拒否` — 聞き取りの模擬。マイクの無い端末や
  SpeechRecognition 非対応のブラウザでも音読の経路を最後まで通せる。
  `拒否` はマイクを塞がれたときに並べ替えへ落ちるかの確認用
- `通知: 実機/未対応/要追加/拒否/成功` — 通知の模擬。dev サーバには Service Worker も
  `/api/push` も無いので、ここを通さないと設定画面の「通知」が出てこない。模擬でもサーバーには通信しない。
  切り替えると読み込み直す
- `メンテ表示` — メンテナンス画面を出す。dev サーバには Pages Functions が無く
  `/api/maintenance` が 404 なので、ここを通さないとこの画面を一度も見られない
- `?t=2026-08-18T21:46:30+09:00` で時刻を指定できる

## 実機検証

`crypto.subtle` / SpeechRecognition / PWA インストール / Web Push は **secure context 必須**。
iPhone の通知はホーム画面に追加したアプリからしか受け取れない。
`http://192.168.x.x:5173` では動かない。`dev` ブランチの Cloudflare Pages preview URL で確認する。
