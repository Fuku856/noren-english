import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOTIFY_BODY, NOTIFY_TAG, NOTIFY_TITLE } from "@shared/push";

const sw = readFileSync(new URL("../../public/sw-push.js", import.meta.url), "utf8");
const browser = readFileSync(new URL("../../src/push/browser.ts", import.meta.url), "utf8");
const vite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("Service Worker（public/sw-push.js）", () => {
  it("文言が shared/push.ts と一致する（push に中身が無いので、表示はこちらが決める）", () => {
    expect(sw).toContain(`const NOTIFY_TITLE = "${NOTIFY_TITLE}";`);
    expect(sw).toContain(`const NOTIFY_BODY = "${NOTIFY_BODY}";`);
    expect(sw).toContain(`const NOTIFY_TAG = "${NOTIFY_TAG}";`);
  });

  it("push を受けたら必ず通知を出す（event.data を読んで分岐しない）", () => {
    expect(sw).toMatch(/addEventListener\("push"[\s\S]*showNotification/);
    expect(sw).not.toMatch(/event\.data\b(?!\))/);
  });

  it("問い合わせの合言葉がアプリ側と一致する", () => {
    const ping = /const PING = "([^"]+)";/;
    expect(sw.match(ping)?.[1]).toBe(browser.match(ping)?.[1]);
  });

  it("生成される SW が読み込む", () => {
    expect(vite).toContain('importScripts: ["/sw-push.js"]');
  });
});
