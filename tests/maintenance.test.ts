import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMaintenance,
  fetchMaintenance,
  loadMaintenance,
  saveMaintenance,
} from "@/data/maintenance";
import { setBackendForTest } from "@/data/storage";
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

/*
 * 「メンテナンス中」と「取れなかった」を混ぜてはいけない。
 * 混ぜると、保存した旗を解いてよいかが判断できなくなる。
 */
describe("fetchMaintenance", () => {
  const answer = (body: unknown, ok = true) =>
    Object.assign(async () => ({ ok, json: async () => body }), {}) as never;

  const withFetch = async <T>(impl: unknown, fn: () => Promise<T>): Promise<T> => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("maintenance:true なら on。追記も載る", async () => {
    const probe = await withFetch(
      answer({ maintenance: true, message: "  20:00 まで  " }),
      () => fetchMaintenance(),
    );
    expect(probe.state).toBe("on");
    expect(probe.state === "on" && probe.info.message).toBe("20:00 まで");
  });

  it("maintenance:false なら off", async () => {
    const probe = await withFetch(answer({ maintenance: false }), () =>
      fetchMaintenance(),
    );
    expect(probe.state).toBe("off");
  });

  // ここを off にすると、壊れた応答ひとつで旗が解けてしまう
  it.each([{}, { maintenance: "true" }, { maintenance: null }, []])(
    "%p は unknown（旗に触らない）",
    async (body) => {
      const probe = await withFetch(answer(body), () => fetchMaintenance());
      expect(probe.state).toBe("unknown");
    },
  );

  it("2xx でなければ unknown", async () => {
    const probe = await withFetch(answer({ maintenance: false }, false), () =>
      fetchMaintenance(),
    );
    expect(probe.state).toBe("unknown");
  });

  it("届かなければ unknown（圏外で勝手に閉じない・勝手に開けない）", async () => {
    const probe = await withFetch(
      () => Promise.reject(new Error("offline")),
      () => fetchMaintenance(),
    );
    expect(probe.state).toBe("unknown");
  });
});

/*
 * 判定が返るまでの窓を塞ぐための保存。これが無いと、リロードのたびに
 * 数百ms〜3秒のあいだアプリが操作できてしまう。
 */
describe("保存された旗", () => {
  beforeEach(() => setBackendForTest(null));

  it("何も無ければ null", () => {
    expect(loadMaintenance()).toBeNull();
  });

  it("書いたら次の起動で読める", () => {
    saveMaintenance(maintenanceInfo("20:00 まで"));
    expect(loadMaintenance()?.message).toBe("20:00 まで");
  });

  // 見出しと本文は保存値を信用せず定数から組み直す
  it("追記が無くても旗としては立つ", () => {
    saveMaintenance(maintenanceInfo(undefined));
    const loaded = loadMaintenance();
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe(MAINTENANCE_TITLE);
    expect(loaded?.lines).toEqual(MAINTENANCE_LINES);
    expect(loaded?.message).toBeNull();
  });

  it("解けば消える", () => {
    saveMaintenance(maintenanceInfo("お知らせ"));
    clearMaintenance();
    expect(loadMaintenance()).toBeNull();
  });
});
