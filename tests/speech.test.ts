import { describe, expect, it } from "vitest";
import { isStructuralFailure, type SttFailure } from "@/speech/stt";

describe("isStructuralFailure", () => {
  it("マイクが塞がれている失敗は並べ替えに落とす", () => {
    expect(isStructuralFailure("denied")).toBe(true);
    expect(isStructuralFailure("unavailable")).toBe(true);
  });

  it("言い直せば直る失敗は音読のまま残す", () => {
    expect(isStructuralFailure("no-speech")).toBe(false);
    expect(isStructuralFailure("failed")).toBe(false);
  });

  it("失敗の種類はこの4つだけ（増やしたらここも決めること）", () => {
    const all: SttFailure[] = ["denied", "unavailable", "no-speech", "failed"];
    expect(all.filter(isStructuralFailure)).toEqual(["denied", "unavailable"]);
  });
});
