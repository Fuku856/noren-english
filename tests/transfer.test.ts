import { describe, expect, it } from "vitest";
import { defaultMilestones, defaultSettings, defaultTickets } from "@/data/schema";
import { backupFilename, buildBackup, parseBackup } from "@/data/transfer";

const input = {
  nowMs: Date.parse("2026-08-18T12:00:00Z"),
  salt: "0f8c1a2b-3d4e-5f60-7182-93a4b5c6d7e8",
  settings: defaultSettings(),
  records: [
    {
      date: "2026-08-17",
      opened: true,
      solved: true,
      accuracy: 0.8,
      sentenceId: 3,
      mode: "arrange" as const,
      source: "daily" as const,
      kind: "normal" as const,
      clockAnomaly: false,
    },
  ],
  tickets: defaultTickets(),
  milestones: defaultMilestones(),
};

describe("buildBackup", () => {
  it("印とバージョンを付ける", () => {
    const b = buildBackup(input);
    expect(b.app).toBe("noren");
    expect(b.version).toBe(1);
    expect(b.exportedAt).toBe("2026-08-18T12:00:00.000Z");
  });
});

describe("parseBackup", () => {
  it("書き出したものをそのまま読み戻せる", () => {
    const b = parseBackup(JSON.parse(JSON.stringify(buildBackup(input))));
    expect(b).not.toBeNull();
    expect(b!.salt).toBe(input.salt);
    expect(b!.records).toEqual(input.records);
  });

  it("印の無い JSON は受け取らない（他アプリのファイルで記録を消さない）", () => {
    expect(parseBackup({ records: [] })).toBeNull();
    expect(parseBackup(null)).toBeNull();
    expect(parseBackup([1, 2, 3])).toBeNull();
    expect(parseBackup("noren")).toBeNull();
  });

  it("salt が無ければ受け取らない（開店時刻が変わってしまう）", () => {
    const b = { ...buildBackup(input), salt: "" };
    expect(parseBackup(b)).toBeNull();
  });

  it("知らない将来のバージョンは受け取らない", () => {
    expect(parseBackup({ ...buildBackup(input), version: 99 })).toBeNull();
  });

  it("一部が壊れていても残りは復元する", () => {
    const b = parseBackup({
      ...buildBackup(input),
      tickets: "こわれている",
      records: [{ date: "2026-08-17", solved: true }, { nope: 1 }],
    });
    expect(b).not.toBeNull();
    expect(b!.tickets).toEqual(defaultTickets());
    expect(b!.records).toHaveLength(1);
    expect(b!.records[0]!.solved).toBe(true);
  });
});

describe("backupFilename", () => {
  it("日付が入る", () => {
    expect(backupFilename("2026-08-18")).toBe("noren-2026-08-18.json");
  });
});
