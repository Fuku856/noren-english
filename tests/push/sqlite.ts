/**
 * テスト用の D1 もどき。node:sqlite の上に、shared/pushServer.ts が使う分だけを生やす。
 * 本物のマイグレーション SQL を流すので、SQL の書き間違いはここで落ちる。
 */
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "@shared/pushServer";

const MIGRATION = new URL("../../worker/migrations/0001_push_subscriptions.sql", import.meta.url);

export function memoryD1(): SqlDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(MIGRATION, "utf8"));

  const statement = (sql: string, values: unknown[] = []): SqlStatement => ({
    bind: (...v) => statement(sql, v),
    first: async <T>() =>
      ((raw.prepare(sql).get(...(values as SQLInputValue[])) as T | undefined) ?? null),
    all: async <T>() => ({
      results: raw.prepare(sql).all(...(values as SQLInputValue[])).map((r) => ({ ...r }) as T),
    }),
    run: async () => {
      const r = raw.prepare(sql).run(...(values as SQLInputValue[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });

  return {
    raw,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      // D1 の batch はトランザクション
      raw.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
