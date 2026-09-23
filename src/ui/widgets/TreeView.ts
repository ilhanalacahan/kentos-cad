import { h } from '../dom';
import { icon } from '../icons';

export interface TreeAdapter<T> {
  id(node: T): string;
  children(node: T): readonly T[];
  isExpanded(node: T): boolean;
  setExpanded(node: T, expanded: boolean): void;
  /** Fill the row's content cell. */
  renderRow(node: T, row: HTMLElement): void;
  /** Double click / Enter. */
  onActivate?(node: T): void;
  /** Space. */
  onToggle?(node: T): void;
  onRename?(node: T): void;
  onContextMenu?(node: T, e: MouseEvent): void;
  /** Keep a node while filtering (ancestors of matches are kept automatically). */
  matches?(node: T, query: string): boolean;
}

/** Generic keyboard-accessible tree (role=tree), re-rendered from the model. */
export class TreeView<T> {
  readonly el: HTMLElement;
  private readonly adapter: TreeAdapter<T>;
  private flat: { node: T; row: HTMLElement }[] = [];
  private focusedId: string | null = null;
  private query = '';
  private roots: readonly T[] = [];

  constructor(adapter: TreeAdapter<T>, label: string) {
    this.adapter = adapter;
    this.el = h('div', { class: 'tree', role: 'tree', 'aria-label': label, tabindex: '0' });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('focus', () => {
      if (!this.focusedId && this.flat.length) this.focus(this.adapter.id(this.flat[0].node));
    });
  }

  setFilter(q: string): void {
    this.query = q.trim().toLocaleLowerCase('tr-TR');
    this.render(this.roots);
  }

  render(roots: readonly T[]): void {
    this.roots = roots;
    const a = this.adapter;
    this.el.textContent = '';
    this.flat = [];
    const q = this.query;
    const keep = (n: T): boolean => !q || !!a.matches?.(n, q) || a.children(n).some(keep);
    const walk = (nodes: readonly T[], depth: number) => {
      for (const n of nodes) {
        if (!keep(n)) continue;
        const kids = a.children(n);
        const hasKids = kids.length > 0;
        const expanded = hasKids && (a.isExpanded(n) || !!q);
        const id = a.id(n);
        const caret = h(
          'span',
          { class: 'tree__caret', 'data-empty': hasKids ? null : '' },
          hasKids ? icon(expanded ? 'chevronDown' : 'chevronRight', 14) : null,
        );
        const content = h('div', { class: 'tree__content' });
        const row = h(
          'div',
          {
            class: 'tree__row',
            role: 'treeitem',
            'aria-level': String(depth + 1),
            'aria-expanded': hasKids ? String(expanded) : null,
            'aria-selected': String(id === this.focusedId),
            style: `--depth:${depth}`,
            dataset: { id },
          },
          caret,
          content,
        );
        a.renderRow(n, content);
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          if (hasKids) a.setExpanded(n, !a.isExpanded(n));
        });
        row.addEventListener('click', () => this.focus(id, false));
        row.addEventListener('dblclick', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (hasKids && !a.onActivate) a.setExpanded(n, !a.isExpanded(n));
          else a.onActivate?.(n);
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.focus(id, false);
          a.onContextMenu?.(n, e);
        });
        this.el.append(row);
        this.flat.push({ node: n, row });
        if (expanded) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    if (!this.flat.length) this.el.append(h('div', { class: 'tree__empty' }, q ? 'Aramayla eşleşen katman yok.' : 'Katman yok.'));
  }

  focus(id: string, moveDom = true): void {
    this.focusedId = id;
    for (const { node, row } of this.flat) row.setAttribute('aria-selected', String(this.adapter.id(node) === id));
    const hit = this.flat.find((f) => this.adapter.id(f.node) === id);
    if (hit && moveDom) hit.row.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest('input')) return;
    const a = this.adapter;
    const i = this.flat.findIndex((f) => a.id(f.node) === this.focusedId);
    const cur = this.flat[i]?.node;
    const go = (k: number) => {
      const f = this.flat[Math.max(0, Math.min(this.flat.length - 1, k))];
      if (f) this.focus(a.id(f.node));
    };
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        return go(i + 1);
      case 'ArrowUp':
        handled();
        return go(i - 1);
      case 'Home':
        handled();
        return go(0);
      case 'End':
        handled();
        return go(this.flat.length - 1);
      case 'ArrowRight':
        handled();
        if (cur && a.children(cur).length) a.isExpanded(cur) ? go(i + 1) : a.setExpanded(cur, true);
        return;
      case 'ArrowLeft': {
        handled();
        if (!cur) return;
        if (a.children(cur).length && a.isExpanded(cur)) return a.setExpanded(cur, false);
        const level = Number(this.flat[i].row.getAttribute('aria-level'));
        for (let k = i - 1; k >= 0; k--) if (Number(this.flat[k].row.getAttribute('aria-level')) < level) return go(k);
        return;
      }
      case 'Enter':
        handled();
        if (cur) a.onActivate?.(cur);
        return;
      case ' ':
        handled();
        if (cur) a.onToggle?.(cur);
        return;
      case 'F2':
        handled();
        if (cur) a.onRename?.(cur);
        return;
    }
  }

  rowOf(id: string): HTMLElement | undefined {
    return this.flat.find((f) => this.adapter.id(f.node) === id)?.row;
  }
}
