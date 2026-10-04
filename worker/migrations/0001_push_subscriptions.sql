-- 通知の購読。SPEC.md §1「唯一の例外：通知の購読情報」。
-- 学習の記録はここに入れない。入るのは購読情報・salt・時間帯・次の送信時刻だけ。
--
-- 適用: npx wrangler d1 migrations apply <DB名> --remote（worker/ で実行）
-- 列を変えたら shared/pushServer.ts の SubscriptionRow と COLUMNS も直すこと。
CREATE TABLE push_subscriptions (
  endpoint      TEXT PRIMARY KEY,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,     -- 更新・削除の本人確認にも使う
  salt          TEXT NOT NULL,     -- 開店時刻の算出に必要
  notify_start  INTEGER NOT NULL,  -- JST の分 (0-1439)
  notify_end    INTEGER NOT NULL,
  pending_start INTEGER,           -- 翌日から効く窓。無ければ NULL
  pending_end   INTEGER,
  pending_from  TEXT,              -- その窓が効き始める のれん日 "YYYY-MM-DD"
  next_open_at  INTEGER NOT NULL,  -- 次に送る瞬間 (epoch ms)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 毎分の送信は next_open_at <= now を引くだけ。全件を読まないための索引
CREATE INDEX idx_push_next_open_at ON push_subscriptions (next_open_at);
