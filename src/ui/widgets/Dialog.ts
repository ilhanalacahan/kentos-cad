import { DisposableStore, listen } from '../../core/disposable';
import { h, overlayRoot, type Child } from '../dom';
import { icon } from '../icons';
import { PopupMenu } from './PopupMenu';

/** Modal dialog with focus trap-lite, Esc to close and restored focus. */
export class Dialog {
  private static open: Dialog | null = null;
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly d = new DisposableStore();
  private readonly returnFocus: Element | null;
  private readonly onClose?: () => void;

  constructor(opts: { title: string; width?: number; className?: string; content: Child[]; footer?: Child[]; onClose?: () => void }) {
    Dialog.open?.close();
    Dialog.open = this;
    this.returnFocus = document.activeElement;
    const close = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Kapat' }, icon('close', 16));
    this.body = h('div', { class: 'dialog__body' }, opts.content);
    const card = h(
      'div',
      { class: `dialog ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title, tabindex: '-1', style: opts.width ? `width:min(${opts.width}px, 100% - 32px)` : null },
      h('header', { class: 'dialog__head' }, h('h2', { class: 'dialog__title' }, opts.title), close),
      this.body,
      opts.footer ? h('footer', { class: 'dialog__foot' }, opts.footer) : null,
    );
    this.el = h('div', { class: 'dialog-backdrop' }, card);
    this.onClose = opts.onClose;
    overlayRoot().append(this.el);
    card.focus();
    this.d.add(listen(close, 'click', () => this.close()));
    // Keys pressed inside the dialog never reach app shortcuts behind it.
    this.d.add(listen<KeyboardEvent>(card, 'keydown', (e) => e.stopPropagation()));
    this.d.add(
      listen<PointerEvent>(this.el, 'pointerdown', (e) => {
        if (e.target === this.el) this.close();
      }),
    );
    this.d.add(
      listen<KeyboardEvent>(
        window,
        'keydown',
        (e) => {
          // An open menu (a dropdown in the form) takes its own Esc first.
          if (e.key === 'Escape' && PopupMenu.isOpen) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
          } else if (!card.contains(e.target as Node)) {
            // Keep app shortcuts from firing behind the modal.
            e.stopPropagation();
          }
        },
        true,
      ),
    );
  }

  close(): void {
    this.onClose?.();
    this.d.dispose();
    this.el.remove();
    if (Dialog.open === this) Dialog.open = null;
    (this.returnFocus as HTMLElement | null)?.focus?.();
  }
}
