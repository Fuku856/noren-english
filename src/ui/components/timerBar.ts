/**
 * 残り時間のバー。**これ自体が残り時間**で、数字は補助。
 *
 * ## なぜ rAF ではなく CSS transition なのか
 *
 * `requestAnimationFrame` はタブが隠れる・端末がロックされると止まる。
 * rAF で縮めると画面ロック中に凍り、復帰した瞬間に飛ぶ。
 * 時間ベースの transition なら、そもそもフレーム毎の仕事が要らない。
 * 復帰時に resync() で残り時間から掛け直せば、勝手に辻褄が合う。
 *
 * ## なぜ width ではなく transform なのか
 *
 * width を連続的に変えるとフレーム毎にレイアウトが走る。5分ぶん走らせる理由はない。
 * scaleX なら合成だけで済む。角丸はトラック側の overflow で作る。
 */

import { prefersReducedMotion } from "../dom";

/** reduced-motion のときの段数。連続的に動かさず、これだけの回数で跳ぶ。 */
const STEPS = 10;

/** 空になってから DOM を隠すまで。 */
const HIDE_DELAY_MS = 400;

export interface TimerBar {
  /** 開始。endsAtMs が真実で、nowMs との差から残りを出す。 */
  open(endsAtMs: number, totalMs: number, nowMs: number): void;
  /** 画面が戻ってきたときに掛け直す。スリープで生じたズレを自己修正する。 */
  resync(nowMs: number): void;
  close(): void;
  destroy(): void;
}

const scaleFor = (ratio: number): string => `scaleX(${ratio.toFixed(4)})`;

export function createTimerBar(host: HTMLElement, fill: HTMLElement): TimerBar {
  let endsAtMs = 0;
  let totalMs = 0;
  let active = false;
  let lastStep = -1;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

  const ratioAt = (nowMs: number): number => {
    if (totalMs <= 0) return 0;
    return Math.max(0, Math.min(1, (endsAtMs - nowMs) / totalMs));
  };

  /** 連続的に縮める。掛けたあとは5分間 JS が一切動かない。 */
  const applyTransition = (nowMs: number) => {
    const remaining = Math.max(0, endsAtMs - nowMs);
    fill.style.transition = "none";
    fill.style.transform = scaleFor(ratioAt(nowMs));
    void fill.offsetHeight; // reflow を強制して開始値を確定させる
    fill.style.transition = `transform ${remaining}ms linear`;
    fill.style.transform = scaleFor(0);
  };

  /** 段階的に縮める。動きを嫌う人にも、減っていることは伝える。 */
  const applySteps = (nowMs: number) => {
    const step = Math.round(ratioAt(nowMs) * STEPS);
    if (step === lastStep) return;
    lastStep = step;
    fill.style.transition = "none";
    fill.style.transform = scaleFor(step / STEPS);
  };

  const apply = (nowMs: number) => {
    if (!active) return;
    if (prefersReducedMotion()) applySteps(nowMs);
    else applyTransition(nowMs);
  };

  const onMotionChange = () => {
    lastStep = -1;
    // 掛け直しには現在時刻が要るが、ここは時刻を持たないので
    // 次の resync（毎秒のティック）に任せる
    fill.style.transition = "none";
  };
  mq.addEventListener("change", onMotionChange);

  return {
    open(nextEndsAtMs, nextTotalMs, nowMs) {
      endsAtMs = nextEndsAtMs;
      totalMs = nextTotalMs;
      active = true;
      lastStep = -1;

      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }

      host.hidden = false;
      apply(nowMs);
    },

    resync(nowMs) {
      apply(nowMs);
    },

    close() {
      if (!active && host.hidden) return;
      active = false;
      // 残りを一気に詰めてから消す。解き終えても時間切れでも同じ終わり方をする
      fill.style.transition = `transform ${HIDE_DELAY_MS / 2}ms var(--ease)`;
      fill.style.transform = scaleFor(0);

      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!active) host.hidden = true;
      }, HIDE_DELAY_MS);
    },

    destroy() {
      mq.removeEventListener("change", onMotionChange);
      if (hideTimer !== null) clearTimeout(hideTimer);
      active = false;
    },
  };
}
