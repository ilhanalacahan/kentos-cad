import { listen, type Disposable } from '../../core/disposable';
import { formatChord } from '../../core/keymap';
import { h, overlayRoot, replaceChildren } from '../dom';

export interface TooltipContent {
  title: string;
  shortcut?: string;
  description?: string;
  note?: string;
}

const DELAY = 450;
let tip: HTMLElement | null = null;
let timer = 0;
let owner: HTMLElement | null = null;
/** Once a tooltip was shown, neighbours appear instantly (toolbar scanning). */
let warmUntil = 0;

function ensure(): HTMLElement {
  if (!tip) {
    tip = h('div', { class: 'tooltip', role: 'tooltip' });
    overlayRoot().append(tip);
  }
  return tip;
}

function show(target: HTMLElement, content: TooltipContent, placement: 'right' | 'bottom' | 'top'): void {
  const el = ensure();
  replaceChildren(
    el,
    h(
      'div',
      { class: 'tooltip__head' },
      h('span', { class: 'tooltip__title' }, content.title),
      content.shortcut ? h('kbd', { class: 'kbd' }, formatChord(content.shortcut)) : null,
    ),
    content.description ? h('div', { class: 'tooltip__desc' }, content.description) : null,
    content.note ? h('div', { class: 'tooltip__note' }, content.note) : null,
  );
  el.dataset.open = '';
  const r = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  let x = placement === 'right' ? r.right + 8 : r.left + r.width / 2 - t.width / 2;
  let y = placement === 'right' ? r.top + r.height / 2 - t.height / 2 : placement === 'top' ? r.top - t.height - 8 : r.bottom + 8;
  x = Math.max(8, Math.min(x, innerWidth - t.width - 8));
  y = Math.max(8, Math.min(y, innerHeight - t.height - 8));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTooltip(): void {
  clearTimeout(timer);
  if (tip && owner) {
    delete tip.dataset.open;
    warmUntil = performance.now() + 600;
  }
  owner = null;
}

/** Attach a rich tooltip; content is resolved lazily so shortcuts stay current. */
export function tooltip(
  target: HTMLElement,
  content: () => TooltipContent,
  placement: 'right' | 'bottom' | 'top' = 'bottom',
): Disposable {
  const enter = () => {
    clearTimeout(timer);
    const delay = performance.now() < warmUntil ? 0 : DELAY;
    timer = window.setTimeout(() => {
      owner = target;
      show(target, content(), placement);
    }, delay);
  };
  const subs = [
    listen(target, 'pointerenter', enter),
    listen(target, 'pointerleave', hideTooltip),
    listen(target, 'pointerdown', hideTooltip),
    listen(target, 'focus', enter),
    listen(target, 'blur', hideTooltip),
  ];
  return () => subs.forEach((d) => d());
}
