// 時刻ロジックが端末のタイムゾーンから独立していることを確認する。
// 設計上 shared/ ではローカルタイムのゲッタを一切使っていないので構造的に独立だが、
// それを守り続けるための回帰ガードとして4つのゾーンで同じテストを走らせる。
import { spawnSync } from "node:child_process";

const ZONES = [
  "UTC",
  "Asia/Tokyo",
  "America/Los_Angeles",
  "Pacific/Kiritimati", // UTC+14。日付が最も進むゾーン
];

const TARGETS = ["shared/", "tests/time"];

let failed = 0;
for (const tz of ZONES) {
  process.stdout.write(`\n=== TZ=${tz}\n`);
  const r = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...TARGETS],
    { stdio: "inherit", env: { ...process.env, TZ: tz } },
  );
  if (r.status !== 0) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} タイムゾーンでテストが失敗しました`);
  process.exit(1);
}
console.log("\nすべてのタイムゾーンで一致しました");
