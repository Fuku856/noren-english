/**
 * 暖簾。**これ自体が残り時間**。
 *
 * 開店時に画面上部から錆朱の暖簾が下り、5分かけて少しずつ短くなり、
 * 時間切れで完全に上がる。数字のカウントダウンは補助に留める。
 *
 * ## なぜ scaleY ではなく clip-path なのか
 *
 * scaleY だと布ごと押し潰されるので、裾の切れ込みや縫い返しの比率まで変わり、
 * 「短くなった暖簾」ではなく「潰れた暖簾」に見える。
 * clip-path で裾から詰めれば、丈だけが縮んで布の作りはそのまま残る。
 * どちらも合成レイヤで動くので速さは変わらない。
 *
 * ## なぜ rAF ではなく CSS transition なのか
 *
 * `requestAnimationFrame` はタブが隠れる・端末がロックされると止まる。
 * rAF で暖簾を縮めると画面ロック中に凍り、復帰した瞬間に飛ぶ。
 * 時間ベースの transition なら、そもそもフレーム毎の仕事が要らない。
 * 復帰時に resync() で残り時間から掛け直せば、勝手に辻褄が合う。
 *
 * ## 屋号を入れないこと
 *
 * 文字を入れた瞬間に店の看板になり、静けさが消える。無地のままにする。
 */

import { prefersReducedMotion } from "../dom";

/** reduced-motion のときの段数。連続的に動かさず、これだけの回数で跳ぶ。 */
const STEPS = 10;

/** 上がりきってから DOM を隠すまで。CSS の --noren-slide-ms より少し長く。 */
const HIDE_DELAY_MS = 1000;

export interface Noren {
  /** 開店。endsAtMs が真実で、nowMs との差から残りを出す。 */
  open(endsAtMs: number, totalMs: number, nowMs: number): void;
  /** 画面が戻ってきたときに掛け直す。スリープで生じたズレを自己修正する。 */
  resync(nowMs: number): void;
  close(): void;
  destroy(): void;
}

/** 残り割合 → clip-path。裾側から詰める。 */
const clipFor = (ratio: number): string =>
  `inset(0 0 ${((1 - ratio) * 100).toFixed(3)}% 0)`;

export function createNoren(slide: HTMLElement, body: HTMLElement): Noren {
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
    body.style.transition = "none";
    body.style.clipPath = clipFor(ratioAt(nowMs));
    void body.offsetHeight; // reflow を強制して開始値を確定させる
    body.style.transition = `clip-path ${remaining}ms linear`;
    body.style.clipPath = clipFor(0);
  };

  /** 段階的に縮める。動きを嫌う人にも、減っていることは伝える。 */
  const applySteps = (nowMs: number) => {
    const step = Math.round(ratioAt(nowMs) * STEPS);
    if (step === lastStep) return;
    lastStep = step;
    body.style.transition = "none";
    body.style.clipPath = clipFor(step / STEPS);
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
    body.style.transition = "none";
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

      slide.hidden = false;
      // 上から するり と下ろす
      slide.classList.remove("noren-layer--up");
      apply(nowMs);
    },

    resync(nowMs) {
      apply(nowMs);
    },

    close() {
      if (!active && slide.hidden) return;
      active = false;
      // 終われば上がる。上がりきってから DOM ごと隠す
      slide.classList.add("noren-layer--up");
      body.style.transition = "none";
      body.style.clipPath = clipFor(0);

      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!active) slide.hidden = true;
      }, HIDE_DELAY_MS);
    },

    destroy() {
      mq.removeEventListener("change", onMotionChange);
      if (hideTimer !== null) clearTimeout(hideTimer);
      active = false;
    },
  };
}
