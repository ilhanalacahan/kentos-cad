import type { AppContext } from '../../app/context';
import { listen } from '../../core/disposable';
import { formatChordCompact } from '../../core/keymap';
import { watchAll } from '../../core/signal';
import { TOOL_GROUP_LABEL, type ToolGroup } from '../../tools/Tool';
import { Component } from '../Component';
import { h } from '../dom';
import { icon } from '../icons';
import { tooltip } from '../widgets/tooltip';

const GROUP_ORDER: ToolGroup[] = ['select', 'draw', 'annotate', 'modify', 'map'];
const EDGE_SNAP = 14;
const MARGIN = 8;

/**
 * Floating drawing toolbox. Drag by the grip, it sticks to viewport edges;
 * it can also be docked into the left column. Every button shows its
 * shortcut on a key cap so the palette doubles as a cheat sheet.
 */
export class Toolbox extends Component {
  readonly el: HTMLElement;
  private readonly ctx: AppContext;
  private readonly floatHost: HTMLElement;
  private readonly dockHost: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(ctx: AppContext, hosts: { float: HTMLElement; dock: HTMLElement }) {
    super();
    this.ctx = ctx;
    this.floatHost = hosts.float;
    this.dockHost = hosts.dock;
    const { ui } = ctx;

    const grip = h('div', { class: 'toolbox__grip', title: 'Taşımak için sürükleyin' }, icon('grip', 14));
    const colsBtn = h('button', { class: 'toolbox__hbtn', type: 'button', 'aria-label': 'Sütun sayısını değiştir' }, icon('columns', 14));
    const dockBtn = h('button', { class: 'toolbox__hbtn', type: 'button', 'aria-label': 'Kenara sabitle' }, icon('dock', 14));
    const body = h('div', { class: 'toolbox__body' });

    const groups = ctx.tools.byGroup();
    for (const g of GROUP_ORDER) {
      const list = groups.get(g);
      if (!list) continue;
      const section = h('div', { class: 'toolbox__section', role: 'group', 'aria-label': TOOL_GROUP_LABEL[g] });
      for (const d of list) {
        const chord = d.id === 'select' ? 'Esc' : ctx.keymap.chordFor(`tool.${d.id}`);
        const b = h(
          'button',
          {
            class: 'toolbox__tool',
            type: 'button',
            'aria-label': d.label,
            'aria-pressed': 'false',
            dataset: { tool: d.id, ready: String(d.ready) },
          },
          icon(d.icon, 20),
          chord ? h('span', { class: 'toolbox__key', 'aria-hidden': 'true' }, formatChordCompact(chord)) : null,
        );
        b.addEventListener('click', () => {
          ctx.commands.execute(`tool.${d.id}`);
          ctx.view.focus();
        });
        this.d.add(
          tooltip(
            b,
            () => ({
              title: d.label,
              shortcut: chord,
              description: d.description,
              note: d.ready ? undefined : 'Geliştirme aşamasında',
            }),
            'right',
          ),
        );
        this.buttons.set(d.id, b);
        section.append(b);
      }
      body.append(section);
    }

    this.el = h(
      'aside',
      { class: 'toolbox', 'aria-label': 'Çizim araçları' },
      h('div', { class: 'toolbox__head' }, grip, h('div', { class: 'toolbox__hactions' }, colsBtn, dockBtn)),
      body,
    );

    this.d.add(
      ctx.tools.activeId.subscribe((id, prev) => {
        this.buttons.get(prev)?.setAttribute('aria-pressed', 'false');
        this.buttons.get(id)?.setAttribute('aria-pressed', 'true');
      }),
    );
    this.buttons.get(ctx.tools.activeId.value)?.setAttribute('aria-pressed', 'true');

    this.d.add(listen(colsBtn, 'click', () => ui.toolboxColumns.set(ui.toolboxColumns.value === 2 ? 1 : 2)));
    this.d.add(listen(dockBtn, 'click', () => ui.toolboxDocked.set(!ui.toolboxDocked.value)));
    this.d.add(tooltip(colsBtn, () => ({ title: ui.toolboxColumns.value === 2 ? 'Tek sütun' : 'İki sütun' }), 'right'));
    this.d.add(tooltip(dockBtn, () => ({ title: ui.toolboxDocked.value ? 'Serbest bırak' : 'Kenara sabitle', shortcut: undefined }), 'right'));
    this.d.add(ui.toolboxColumns.subscribe((c) => (this.el.dataset.columns = String(c)), true));
    this.d.add(watchAll([ui.toolboxDocked, ui.toolboxVisible], () => this.place()));
    this.place();
    this.bindDrag(grip);
    const ro = new ResizeObserver(() => this.clamp());
    ro.observe(this.floatHost);
    this.d.add(() => ro.disconnect());
  }

  private place(): void {
    const { ui } = this.ctx;
    this.el.hidden = !ui.toolboxVisible.value;
    const docked = ui.toolboxDocked.value;
    this.el.dataset.docked = String(docked);
    this.dockHost.toggleAttribute('data-empty', !docked || !ui.toolboxVisible.value);
    if (docked) {
      this.dockHost.append(this.el);
      this.el.style.transform = '';
    } else {
      this.floatHost.append(this.el);
      this.moveTo(ui.toolboxX.value, ui.toolboxY.value);
    }
  }

  private moveTo(x: number, y: number): void {
    const host = this.floatHost.getBoundingClientRect();
    const w = this.el.offsetWidth || 80;
    const hgt = this.el.offsetHeight || 400;
    const maxX = Math.max(MARGIN, host.width - w - MARGIN);
    const maxY = Math.max(MARGIN, host.height - hgt - MARGIN);
    let nx = Math.min(Math.max(x, MARGIN), maxX);
    let ny = Math.min(Math.max(y, MARGIN), maxY);
    // Magnetic edges.
    if (nx - MARGIN < EDGE_SNAP) nx = MARGIN;
    if (maxX - nx < EDGE_SNAP) nx = maxX;
    if (ny - MARGIN < EDGE_SNAP) ny = MARGIN;
    if (maxY - ny < EDGE_SNAP) ny = maxY;
    this.el.style.transform = `translate(${Math.round(nx)}px, ${Math.round(ny)}px)`;
    this.pos = { x: nx, y: ny };
  }

  private pos = { x: MARGIN, y: MARGIN };

  private clamp(): void {
    const { ui } = this.ctx;
    if (!ui.toolboxDocked.value && ui.toolboxVisible.value) this.moveTo(ui.toolboxX.value, ui.toolboxY.value);
  }

  private bindDrag(grip: HTMLElement): void {
    let start: { x: number; y: number; px: number; py: number } | null = null;
    this.d.add(
      listen<PointerEvent>(grip, 'pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (this.ctx.ui.toolboxDocked.value) {
          // Dragging a docked toolbox undocks it under the cursor.
          const host = this.floatHost.getBoundingClientRect();
          this.ctx.ui.toolboxX.set(e.clientX - host.left - 20);
          this.ctx.ui.toolboxY.set(e.clientY - host.top - 10);
          this.ctx.ui.toolboxDocked.set(false);
        }
        grip.setPointerCapture(e.pointerId);
        start = { x: e.clientX, y: e.clientY, px: this.pos.x, py: this.pos.y };
        this.el.dataset.dragging = '';
      }),
    );
    this.d.add(
      listen<PointerEvent>(grip, 'pointermove', (e) => {
        if (!start) return;
        this.moveTo(start.px + e.clientX - start.x, start.py + e.clientY - start.y);
      }),
    );
    const end = () => {
      if (!start) return;
      start = null;
      delete this.el.dataset.dragging;
      this.ctx.ui.toolboxX.set(this.pos.x);
      this.ctx.ui.toolboxY.set(this.pos.y);
    };
    this.d.add(listen(grip, 'pointerup', end));
    this.d.add(listen(grip, 'pointercancel', end));
  }
}
