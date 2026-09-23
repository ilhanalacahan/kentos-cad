import type { AppContext } from '../../app/context';
import { listen } from '../../core/disposable';
import type { Entity } from '../../model/entities';
import { layoutDimension } from '../../model/geom/dimension';
import { Component } from '../Component';
import { h } from '../dom';

/**
 * In-place editor for text and dimension values, opened by a double click
 * in the select tool. It sits exactly over the drawn text (same size and
 * angle), commits with Enter or blur and cancels with Esc. A dimension with
 * empty text shows its measured value again.
 */
export class InlineTextEditor extends Component {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly ctx: AppContext;
  private id: number | null = null;

  constructor(ctx: AppContext, host: HTMLElement) {
    super();
    this.ctx = ctx;
    this.input = h('input', { class: 'inline-text__input', spellcheck: 'false', 'aria-label': 'Yazıyı düzenle' });
    this.el = h('div', { class: 'inline-text', hidden: true }, this.input);
    host.append(this.el);

    this.d.add(ctx.view.events.on('editText', ({ id }) => this.open(id)));
    this.d.add(
      listen<KeyboardEvent>(this.input, 'keydown', (e) => {
        e.stopPropagation(); // typing must not trigger tool shortcuts
        if (e.key === 'Enter') this.close(true);
        else if (e.key === 'Escape') this.close(false);
      }),
    );
    this.d.add(listen(this.input, 'blur', () => this.close(true)));
    // Panning or zooming would leave the editor floating off its text.
    this.d.add(ctx.view.camera.changed.subscribe(() => this.close(true)));
  }

  private open(id: number): void {
    const e = this.ctx.doc.get(id);
    if (!e || (e.kind !== 'text' && e.kind !== 'dimension')) return;
    this.close(true);
    const place = placement(e);
    if (!place) return;
    this.id = id;
    const cam = this.ctx.view.camera;
    const s = cam.worldToScreen(place.at);
    const px = Math.max(13, Math.min(48, e.height * cam.scale));
    this.input.value = e.kind === 'text' ? e.text : (e.text ?? '');
    this.input.placeholder = e.kind === 'dimension' ? this.ctx.format.length(place.measured ?? 0, false) : '';
    Object.assign(this.el.style, {
      left: `${s.x}px`,
      top: `${s.y}px`,
      fontSize: `${px}px`,
      transform: `translate(${place.centered ? '-50%' : '0'}, -85%) rotate(${-place.rotation}deg)`,
      transformOrigin: place.centered ? '50% 85%' : '0 85%',
    });
    this.el.hidden = false;
    this.ctx.view.setEditing(id);
    this.input.focus();
    this.input.select();
  }

  private close(commit: boolean): void {
    if (this.id === null) return;
    const id = this.id;
    this.id = null;
    this.el.hidden = true;
    this.ctx.view.setEditing(null);
    const e = this.ctx.doc.get(id);
    if (!commit || !e) return;
    const value = this.input.value.trim();
    if (e.kind === 'text' && value && value !== e.text) this.ctx.doc.update(id, { text: value } as Partial<Entity>);
    if (e.kind === 'dimension' && value !== (e.text ?? '')) this.ctx.doc.update(id, { text: value || undefined } as Partial<Entity>);
    this.ctx.view.focus();
  }
}

function placement(e: Entity): { at: { x: number; y: number }; rotation: number; centered: boolean; measured?: number } | null {
  if (e.kind === 'text') return { at: e.p, rotation: e.rotation, centered: false };
  if (e.kind === 'dimension') {
    const l = layoutDimension(e);
    return l ? { at: l.textAt, rotation: l.rotation, centered: true, measured: l.length } : null;
  }
  return null;
}
