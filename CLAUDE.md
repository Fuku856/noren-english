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
5. **錆朱 `#A8412F` は開店中の画面にしか出さない。** 閉店中の DOM に入れない
6. **連続日数をどこにも表示しない。** 暖簾には屋号を入れず無地のままにする
7. 通知オフでも全機能が使えること。パスキーを作らなくても全機能が使えること

## コマンド

```
npm run dev          開発サーバ
npm test             vitest
npm run test:tz      複数タイムゾーンで時刻ロジックを検証
npm run data:check   例文JSONの健全性チェック
npm run build        本番ビルド
```

## 実機検証

`crypto.subtle` / SpeechRecognition / PWA インストールは **secure context 必須**。
`http://192.168.x.x:5173` では動かない。`dev` ブランチの Cloudflare Pages preview URL で確認する。
