import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import {
  MAINTENANCE_ART_SRC,
  MAINTENANCE_LINES,
  MAINTENANCE_PASS_THROUGH,
  MAINTENANCE_TITLE,
  isMaintenanceOn,
  maintenanceInfo,
} from "@shared/maintenance";
import { maintenancePage } from "@shared/maintenancePage";

describe("isMaintenanceOn", () => {
  it('"true" のときだけ ON', () => {
    expect(isMaintenanceOn("true")).toBe(true);
  });

  // 打ち間違いでサイト全体が閉じるのが一番困る。曖昧に真と見なさない
  it.each(["TRUE", "True", "1", "yes", "on", " true", "", undefined])(
    "%p は OFF",
    (value) => {
      expect(isMaintenanceOn(value)).toBe(false);
    },
  );
});

describe("maintenanceInfo", () => {
  it("見出しと本文は環境変数に関係なく常に同じ", () => {
    for (const message of [undefined, "", "   ", "お知らせ"]) {
      const info = maintenanceInfo(message);
      expect(info.title).toBe(MAINTENANCE_TITLE);
      expect(info.lines).toEqual(MAINTENANCE_LINES);
    }
  });

  it.each([undefined, "", "   ", "\n\t "])("%p は追記なし", (message) => {
    expect(maintenanceInfo(message).message).toBeNull();
  });

  it("追記は前後の空白を落として持つ", () => {
    expect(maintenanceInfo("  9:00 まで\n続きます  ").message).toBe(
      "9:00 まで\n続きます",
    );
  });
});

describe("maintenancePage", () => {
  it("見出しと本文がそのまま入る", () => {
    const html = maintenancePage(maintenanceInfo(undefined));
    expect(html).toContain(MAINTENANCE_TITLE);
    for (const line of MAINTENANCE_LINES) expect(html).toContain(line);
  });

  it("追記が無ければ段落ごと出さない", () => {
    const para = '<p class="maint__message">';
    expect(maintenancePage(maintenanceInfo(undefined))).not.toContain(para);
    expect(maintenancePage(maintenanceInfo("お知らせ"))).toContain(para);
  });

  /*
   * MAINTENANCE_MESSAGE はダッシュボードから任意のテキストが入る口。
   * 素で差し込むと、打ち間違いでレイアウトが壊れるだけでは済まない。
   */
  it("追記はエスケープして入れる", () => {
    const html = maintenancePage(maintenanceInfo('<script>alert("x")</script> & more'));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
  });

  it("スタイルシートを読みに行かない（全パスが 503）", () => {
    expect(maintenancePage(maintenanceInfo("お知らせ"))).not.toContain("<link");
  });

  /*
   * メンテナンス中は全パスが 503。ここから読みに行くものが
   * PASS_THROUGH に無ければ、その参照は必ず失敗する。
   * 片方だけ足したときにここで止める。
   */
  it("読みに行くのは PASS_THROUGH に入っているパスだけ", () => {
    const html = maintenancePage(maintenanceInfo("お知らせ"));
    const srcs = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);

    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(MAINTENANCE_PASS_THROUGH).toContain(src);
    }
  });
});

/*
 * アプリ側の1枚（index.html の tpl-maintenance）とサーバ側の1枚は
 * 同じ見た目でなければならない。飾りの差し替えでパスが片方だけ変わるのを止める。
 */
describe("アプリ側のテンプレート", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("飾りはサーバ側と同じパスを指している", () => {
    expect(html).toContain(`src="${MAINTENANCE_ART_SRC}"`);
  });

  it("飾りは読み上げに足さない（alt は空）", () => {
    const tag = html.slice(html.indexOf("maint__art"));
    expect(tag.slice(0, tag.indexOf(">"))).toContain('alt=""');
  });
});
