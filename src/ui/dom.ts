/**
 * DOM の薄い道具。仮想DOMは作らない。
 *
 * 画面は3つしかなく、起動速度が体験の中心。マークアップは index.html の
 * <template> に置いてあるので初期パース時に処理され、実行時の組み立てが要らない。
 */

export function tmpl(id: string): DocumentFragment {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTemplateElement)) {
    throw new Error(`テンプレートが見つかりません: ${id}`);
  }
  return el.content.cloneNode(true) as DocumentFragment;
}

/** 必須要素の取得。無ければ即座に失敗させる（黙って壊れるより良い）。 */
export function qs<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  return el;
}

/** 変化があるときだけ書く。毎秒呼ばれるカウントダウンで無駄な書き込みを避ける。 */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function toggle(el: Element, className: string, on: boolean): void {
  el.classList.toggle(className, on);
}

export function show(el: HTMLElement, on: boolean): void {
  el.hidden = !on;
}

/** イベント登録と解除をまとめる。画面の destroy で確実に外すため。 */
export function listen<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
): () => void {
  el.addEventListener(type, handler);
  return () => el.removeEventListener(type, handler);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 解除処理をまとめて持つ小さな入れ物。 */
export function disposer() {
  const fns: Array<() => void> = [];
  return {
    add(fn: () => void) {
      fns.push(fn);
    },
    dispose() {
      for (const fn of fns.splice(0)) fn();
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
