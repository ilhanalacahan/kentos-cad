import type { PathNode, Pt, SubPath } from '../../style/svg/pathData';
import { boxToBox, elementOf, regularPolygon, rotation, shapeBox, shapeId, shapesBox, transformShape, translate, type Paint, type SvgDoc, type SvgShape } from '../../style/svg/svgModel';
import type { Box } from '../../style/svg/pathData';

/**
 * The SVG editor's drawing surface: the canvas (viewBox) on paper with a
 * grid, the shapes, and screen-space handles on top. Tools: select (move,
 * scale by eight handles, rotate by the top knob), node editing of paths
 * (drag nodes and handles, click a segment to add a node), rectangle,
 * ellipse, regular polygon/star, polyline, Bézier pen and text. Points snap
 * to the grid and to other shapes' corners, centres and nodes.
 */

export type ToolId = 'select' | 'node' | 'rect' | 'ellipse' | 'polygon' | 'line' | 'pen' | 'text';

export interface CanvasOptions {
  grid: number;
  snapGrid: boolean;
  snapObjects: boolean;
  tile: boolean;
  sides: number;
  star: boolean;
  /** Preview colours: the symbol's colour, its second colour, the paper. */
  ink: string;
  second: string;
  paper: string;
}

export interface CanvasHost {
  readonly doc: SvgDoc;
  readonly selection: ReadonlySet<string>;
  readonly tool: ToolId;
  readonly nodeEdit: string | null;
  readonly options: CanvasOptions;
  /** Remember the drawing before an interactive change (one undo step). */
  begin(): void;
  /** The interactive change is over. */
  commit(label: string): void;
  /** Redraw after the drawing changed (during a drag). */
  changed(): void;
  select(ids: string[]): void;
  setTool(t: ToolId): void;
  editNodes(id: string | null): void;
  status(text: string): void;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

type Op =
  | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
  | { kind: 'move'; p0: Pt; orig: Map<string, SvgShape>; box: Box }
  | { kind: 'scale'; handle: number; orig: Map<string, SvgShape>; box: Box }
  | { kind: 'rotate'; p0: Pt; orig: Map<string, SvgShape>; box: Box }
  | { kind: 'marquee'; p0: Pt; p1: Pt; add: boolean }
  | { kind: 'draw'; p0: Pt; p1: Pt }
  | { kind: 'node'; sub: number; index: number; part: 'node' | 'in' | 'out'; p0: Pt; orig: SubPath[]; smooth: boolean };

export class SvgCanvas {
  readonly el: HTMLElement;
  private readonly host: CanvasHost;
  private readonly svg: SVGSVGElement;
  private zoom = 4;
  private ox = 20;
  private oy = 20;
  private op: Op | null = null;
  private spaceDown = false;
  /** Points of the polyline or pen path being drawn. */
  private draft: PathNode[] = [];
  private cursor: Pt | null = null;
  private snapMark: Pt | null = null;
  private nodeSel: { sub: number; index: number } | null = null;
  private fitted = false;
  /** Shift was held at the last pointer event (square, circle, proportional scale). */
  private shift = false;

  constructor(host: CanvasHost) {
    this.host = host;
    this.svg = el('svg', { class: 'svge__svg' }) as SVGSVGElement;
    this.el = document.createElement('div');
    this.el.className = 'svge__stage';
    this.el.tabIndex = 0;
    this.el.append(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('dblclick', (e) => this.dbl(e));
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === ' ') this.spaceDown = true;
    });
    this.el.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceDown = false;
    });
    new ResizeObserver(() => {
      if (!this.fitted && this.el.clientWidth > 0) {
        this.fitted = true;
        this.fit();
      } else this.render();
    }).observe(this.el);
  }

  // ── View ─────────────────────────────────────────────────────────────

  fit(): void {
    const { width, height } = this.host.doc;
    const w = this.el.clientWidth || 600;
    const h = this.el.clientHeight || 500;
    const k = this.host.options.tile ? 3 : 1;
    this.zoom = Math.min((w - 48) / (width * k), (h - 48) / (height * k));
    this.ox = (w - width * this.zoom) / 2;
    this.oy = (h - height * this.zoom) / 2;
    this.render();
  }

  zoomBy(f: number, at?: Pt): void {
    const cx = at ? at[0] : this.el.clientWidth / 2;
    const cy = at ? at[1] : this.el.clientHeight / 2;
    const z = Math.min(200, Math.max(0.2, this.zoom * f));
    this.ox = cx - ((cx - this.ox) * z) / this.zoom;
    this.oy = cy - ((cy - this.oy) * z) / this.zoom;
    this.zoom = z;
    this.render();
  }

  get scale(): number {
    return this.zoom;
  }

  private toDoc(e: { clientX: number; clientY: number }): Pt {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.zoom, (e.clientY - r.top - this.oy) / this.zoom];
  }

  private toScreen(p: Pt): Pt {
    return [p[0] * this.zoom + this.ox, p[1] * this.zoom + this.oy];
  }

  private paint = (p: Paint): string => (p === 'fill' ? this.host.options.ink : p === 'stroke' ? this.host.options.second : p);

  // ── Snapping ─────────────────────────────────────────────────────────

  /** A point snapped to other shapes' key points (preferred) or the grid. */
  snap(p: Pt, exclude: ReadonlySet<string> = new Set()): Pt {
    const o = this.host.options;
    const tol = 8 / this.zoom;
    let best: Pt | null = null;
    let bestD = tol;
    if (o.snapObjects) {
      for (const s of this.host.doc.shapes) {
        if (exclude.has(s.id) || s.hidden) continue;
        for (const q of keyPoints(s)) {
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      for (const q of [
        [0, 0],
        [this.host.doc.width, 0],
        [0, this.host.doc.height],
        [this.host.doc.width, this.host.doc.height],
        [this.host.doc.width / 2, this.host.doc.height / 2],
      ] as Pt[]) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) {
      this.snapMark = best;
      return best;
    }
    this.snapMark = null;
    if (!o.snapGrid || !(o.grid > 0)) return p;
    return [Math.round(p[0] / o.grid) * o.grid, Math.round(p[1] / o.grid) * o.grid];
  }

  // ── Rendering ────────────────────────────────────────────────────────

  render(): void {
    const { doc, options: o } = this.host;
    const svg = this.svg;
    svg.replaceChildren();
    const world = el('g', { transform: `translate(${this.ox} ${this.oy}) scale(${this.zoom})` });
    world.append(el('rect', { x: 0, y: 0, width: doc.width, height: doc.height, fill: o.paper, class: 'svge__paper' }));
    if (o.grid > 0 && o.grid * this.zoom >= 5) {
      let d = '';
      for (let x = 0; x <= doc.width + 1e-9; x += o.grid) d += `M${x} 0V${doc.height}`;
      for (let y = 0; y <= doc.height + 1e-9; y += o.grid) d += `M0 ${y}H${doc.width}`;
      world.append(el('path', { d, class: 'svge__grid', 'stroke-width': 1 / this.zoom }));
    }
    const shapes = el('g');
    for (const s of doc.shapes) if (!s.hidden) shapes.append(this.shapeEl(s));
    if (o.tile) {
      // The drawing repeated around itself, as a pattern fill tiles it.
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1]) {
          if (!dx && !dy) continue;
          const copy = shapes.cloneNode(true) as SVGGElement;
          copy.setAttribute('transform', `translate(${dx * doc.width} ${dy * doc.height})`);
          copy.setAttribute('opacity', '0.45');
          copy.setAttribute('pointer-events', 'none');
          world.append(copy);
        }
    }
    world.append(shapes);
    world.append(el('rect', { x: 0, y: 0, width: doc.width, height: doc.height, fill: 'none', class: 'svge__frame', 'stroke-width': 1 / this.zoom, 'pointer-events': 'none' }));
    svg.append(world);
    svg.append(this.overlay());
  }

  private shapeEl(s: SvgShape): SVGElement {
    const spec = elementOf(s, this.paint);
    const node = el(spec.tag, spec.attrs);
    if (spec.text !== undefined) node.textContent = spec.text;
    node.setAttribute('data-id', s.id);
    node.setAttribute('pointer-events', 'all');
    return node;
  }

  private overlay(): SVGGElement {
    const g = el('g', { class: 'svge__overlay' }) as SVGGElement;
    const { doc, selection } = this.host;
    const sel = doc.shapes.filter((s) => selection.has(s.id));
    // Draft of the polyline or pen path.
    if (this.draft.length) {
      const pts = [...this.draft];
      const d = pathD(pts.map((n) => ({ ...n, x: n.x, y: n.y })), false, (p) => this.toScreen(p));
      g.append(el('path', { d, class: 'svge__draft' }));
      if (this.cursor) {
        const last = this.toScreen([pts[pts.length - 1].x, pts[pts.length - 1].y]);
        const c = this.toScreen(this.cursor);
        g.append(el('line', { x1: last[0], y1: last[1], x2: c[0], y2: c[1], class: 'svge__draft' }));
      }
      for (const n of pts) {
        const s = this.toScreen([n.x, n.y]);
        g.append(el('rect', { x: s[0] - 3, y: s[1] - 3, width: 6, height: 6, class: 'svge__node' }));
      }
    }
    if (this.op?.kind === 'draw') this.drawPreview(g, this.op.p0, this.op.p1);
    if (this.op?.kind === 'marquee') {
      const a = this.toScreen(this.op.p0);
      const b = this.toScreen(this.op.p1);
      g.append(el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), class: 'svge__marquee' }));
    }
    const editing = this.host.nodeEdit ? doc.shapes.find((s) => s.id === this.host.nodeEdit) : undefined;
    if (editing?.kind === 'path') this.nodeHandles(g, editing);
    else if (sel.length && this.host.tool === 'select') {
      const b = shapesBox(sel)!;
      const [x0, y0] = this.toScreen([b.minX, b.minY]);
      const [x1, y1] = this.toScreen([b.maxX, b.maxY]);
      g.append(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'svge__selbox' }));
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const handles: Pt[] = [
        [x0, y0],
        [mx, y0],
        [x1, y0],
        [x1, my],
        [x1, y1],
        [mx, y1],
        [x0, y1],
        [x0, my],
      ];
      handles.forEach(([hx, hy], i) => g.append(el('rect', { x: hx - 4, y: hy - 4, width: 8, height: 8, class: 'svge__handle', 'data-handle': i })));
      g.append(el('line', { x1: mx, y1: y0, x2: mx, y2: y0 - 22, class: 'svge__selbox' }));
      g.append(el('circle', { cx: mx, cy: y0 - 26, r: 5, class: 'svge__handle svge__rot', 'data-handle': 'rot' }));
    }
    if (this.snapMark && this.op) {
      const [sx, sy] = this.toScreen(this.snapMark);
      g.append(el('path', { d: `M${sx - 6} ${sy}H${sx + 6}M${sx} ${sy - 6}V${sy + 6}`, class: 'svge__snap' }));
    }
    return g;
  }

  private drawPreview(g: SVGGElement, p0: Pt, p1: Pt): void {
    const shape = this.shapeFromDrag(p0, p1, false);
    if (!shape) return;
    const spec = elementOf(shape, this.paint);
    const node = el(spec.tag, spec.attrs);
    if (spec.text !== undefined) node.textContent = spec.text;
    const w = el('g', { transform: `translate(${this.ox} ${this.oy}) scale(${this.zoom})`, opacity: 0.6 });
    w.append(node);
    g.append(w);
  }

  private nodeHandles(g: SVGGElement, s: Extract<SvgShape, { kind: 'path' }>): void {
    s.subs.forEach((sp, si) =>
      sp.nodes.forEach((n, ni) => {
        const p = this.toScreen([n.x, n.y]);
        for (const part of ['in', 'out'] as const) {
          const h = n[part];
          if (!h) continue;
          const q = this.toScreen(h);
          g.append(el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: 'svge__hline' }));
          g.append(el('circle', { cx: q[0], cy: q[1], r: 4, class: 'svge__ctrl', 'data-node': `${si},${ni},${part}` }));
        }
        const on = this.nodeSel?.sub === si && this.nodeSel.index === ni;
        g.append(el('rect', { x: p[0] - 4, y: p[1] - 4, width: 8, height: 8, class: `svge__node${on ? ' svge__node--on' : ''}`, 'data-node': `${si},${ni},node` }));
      }),
    );
  }

  // ── Pointer ──────────────────────────────────────────────────────────

  private down(e: PointerEvent): void {
    this.el.focus();
    this.shift = e.shiftKey;
    const p = this.toDoc(e);
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.op = { kind: 'pan', x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    this.svg.setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const host = this.host;
    const tool = host.tool;
    const nodeAttr = target.getAttribute('data-node');
    if (host.nodeEdit && nodeAttr) {
      const [si, ni, part] = nodeAttr.split(',');
      const shape = host.doc.shapes.find((s) => s.id === host.nodeEdit);
      if (shape?.kind !== 'path') return;
      const node = shape.subs[+si].nodes[+ni];
      this.nodeSel = { sub: +si, index: +ni };
      host.begin();
      this.op = { kind: 'node', sub: +si, index: +ni, part: part as 'node' | 'in' | 'out', p0: p, orig: structuredClone(shape.subs), smooth: isSmooth(node) };
      this.render();
      return;
    }
    if (host.nodeEdit) {
      const id = target.closest('[data-id]')?.getAttribute('data-id');
      if (id === host.nodeEdit) return this.insertNode(p);
      host.editNodes(null);
      this.nodeSel = null;
    }
    const handle = target.getAttribute('data-handle');
    if (tool === 'select' && handle !== null) {
      const sel = host.doc.shapes.filter((s) => host.selection.has(s.id));
      const box = shapesBox(sel);
      if (!box) return;
      host.begin();
      const orig = new Map(sel.map((s) => [s.id, structuredClone(s)]));
      this.op = handle === 'rot' ? { kind: 'rotate', p0: p, orig, box } : { kind: 'scale', handle: Number(handle), orig, box };
      return;
    }
    switch (tool) {
      case 'select':
      case 'node': {
        const id = target.closest('[data-id]')?.getAttribute('data-id');
        if (id) {
          const members = this.groupOf(id);
          if (e.shiftKey) {
            const next = new Set(host.selection);
            const on = members.every((m) => next.has(m));
            for (const m of members) on ? next.delete(m) : next.add(m);
            host.select([...next]);
            return;
          }
          if (!host.selection.has(id)) host.select(members);
          const sel = host.doc.shapes.filter((s) => host.selection.has(s.id));
          host.begin();
          this.op = { kind: 'move', p0: p, orig: new Map(sel.map((s) => [s.id, structuredClone(s)])), box: shapesBox(sel)! };
        } else {
          this.op = { kind: 'marquee', p0: p, p1: p, add: e.shiftKey };
          if (!e.shiftKey) host.select([]);
        }
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'text': {
        const q = this.snap(p);
        this.op = { kind: 'draw', p0: q, p1: q };
        return;
      }
      case 'line':
      case 'pen': {
        const q = this.snap(p);
        const first = this.draft[0];
        if (first && this.draft.length > 2 && Math.hypot(first.x - q[0], first.y - q[1]) < 8 / this.zoom) return this.finishDraft(true);
        this.draft.push({ x: q[0], y: q[1] });
        this.op = tool === 'pen' ? { kind: 'draw', p0: q, p1: q } : null;
        this.render();
        return;
      }
    }
  }

  private move(e: PointerEvent): void {
    this.shift = e.shiftKey;
    const p = this.toDoc(e);
    const op = this.op;
    const host = this.host;
    if (!op) {
      if (this.draft.length) {
        this.cursor = this.snap(p);
        this.render();
      }
      return;
    }
    switch (op.kind) {
      case 'pan':
        this.ox = op.ox + e.clientX - op.x;
        this.oy = op.oy + e.clientY - op.y;
        this.render();
        return;
      case 'move': {
        const d: Pt = [p[0] - op.p0[0], p[1] - op.p0[1]];
        // The selection's corner snaps (to the grid or a shape); its centre may land on a shape instead.
        const ids = new Set(op.orig.keys());
        const cx = (op.box.minX + op.box.maxX) / 2;
        const cy = (op.box.minY + op.box.maxY) / 2;
        const corner = this.snap([op.box.minX + d[0], op.box.minY + d[1]], ids);
        const cornerHit = this.snapMark;
        const centre = this.snap([cx + d[0], cy + d[1]], ids);
        const centreHit = this.snapMark;
        let dd: Pt;
        if (centreHit && !cornerHit) dd = [centre[0] - cx, centre[1] - cy];
        else {
          dd = [corner[0] - op.box.minX, corner[1] - op.box.minY];
          this.snapMark = cornerHit;
        }
        this.replace(op.orig, (s) => transformShape(s, translate(dd[0], dd[1])));
        return;
      }
      case 'scale': {
        const q = this.snap(p, new Set(op.orig.keys()));
        const b = { ...op.box };
        const h = op.handle;
        if (h === 0 || h === 6 || h === 7) b.minX = q[0];
        if (h === 2 || h === 3 || h === 4) b.maxX = q[0];
        if (h === 0 || h === 1 || h === 2) b.minY = q[1];
        if (h === 4 || h === 5 || h === 6) b.maxY = q[1];
        if (e.shiftKey && h % 2 === 0) {
          // Corners keep the proportions.
          const k = Math.max((b.maxX - b.minX) / (op.box.maxX - op.box.minX), (b.maxY - b.minY) / (op.box.maxY - op.box.minY));
          const w = (op.box.maxX - op.box.minX) * k;
          const hh = (op.box.maxY - op.box.minY) * k;
          if (h === 0 || h === 6) b.minX = b.maxX - w;
          else b.maxX = b.minX + w;
          if (h === 0 || h === 2) b.minY = b.maxY - hh;
          else b.maxY = b.minY + hh;
        }
        if (Math.abs(b.maxX - b.minX) < 1e-6 || Math.abs(b.maxY - b.minY) < 1e-6) return;
        const m = boxToBox(op.box, b);
        this.replace(op.orig, (s) => transformShape(s, m));
        return;
      }
      case 'rotate': {
        const cx = (op.box.minX + op.box.maxX) / 2;
        const cy = (op.box.minY + op.box.maxY) / 2;
        let deg = ((Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(op.p0[1] - cy, op.p0[0] - cx)) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        this.replace(op.orig, (s) => transformShape(s, rotation(deg, cx, cy)));
        host.status(`Döndürme: ${Math.round(deg)}°`);
        return;
      }
      case 'marquee':
        op.p1 = p;
        this.render();
        return;
      case 'draw': {
        const q = this.snap(p);
        op.p1 = q;
        if (host.tool === 'pen' && this.draft.length) {
          // Dragging out of a new node gives it symmetric handles.
          const n = this.draft[this.draft.length - 1];
          if (Math.hypot(q[0] - n.x, q[1] - n.y) > 2 / this.zoom) {
            n.out = q;
            n.in = [2 * n.x - q[0], 2 * n.y - q[1]];
          }
        }
        this.render();
        return;
      }
      case 'node': {
        const shape = host.doc.shapes.find((s) => s.id === host.nodeEdit);
        if (shape?.kind !== 'path') return;
        const q = op.part === 'node' ? this.snap(p, new Set([shape.id])) : p;
        const subs = structuredClone(op.orig);
        const n = subs[op.sub].nodes[op.index];
        const o = op.orig[op.sub].nodes[op.index];
        if (op.part === 'node') {
          const dx = q[0] - o.x;
          const dy = q[1] - o.y;
          n.x = q[0];
          n.y = q[1];
          if (o.in) n.in = [o.in[0] + dx, o.in[1] + dy];
          if (o.out) n.out = [o.out[0] + dx, o.out[1] + dy];
        } else {
          n[op.part] = q;
          const other = op.part === 'in' ? 'out' : 'in';
          const oh = o[other];
          // A smooth node keeps its handles in line (Alt breaks them apart).
          if (op.smooth && oh && !e.altKey) {
            const len = Math.hypot(oh[0] - o.x, oh[1] - o.y);
            const dx = q[0] - n.x;
            const dy = q[1] - n.y;
            const l = Math.hypot(dx, dy) || 1;
            n[other] = [n.x - (dx / l) * len, n.y - (dy / l) * len];
          }
        }
        shape.subs = subs;
        host.changed();
        return;
      }
    }
  }

  private up(e: PointerEvent): void {
    const op = this.op;
    this.op = null;
    this.snapMark = null;
    const host = this.host;
    if (!op) return;
    switch (op.kind) {
      case 'move':
        if (sameShapes(op.orig, host.doc)) host.commit('');
        else host.commit('Taşı');
        break;
      case 'scale':
        host.commit('Boyutlandır');
        break;
      case 'rotate':
        host.commit('Döndür');
        host.status('');
        break;
      case 'node':
        host.commit('Düğümü taşı');
        break;
      case 'marquee': {
        const b: Box = { minX: Math.min(op.p0[0], op.p1[0]), minY: Math.min(op.p0[1], op.p1[1]), maxX: Math.max(op.p0[0], op.p1[0]), maxY: Math.max(op.p0[1], op.p1[1]) };
        if (b.maxX - b.minX > 1e-6 || b.maxY - b.minY > 1e-6) {
          const inside = host.doc.shapes.filter((s) => {
            if (s.hidden) return false;
            const sb = shapeBox(s);
            return sb.minX >= b.minX && sb.maxX <= b.maxX && sb.minY >= b.minY && sb.maxY <= b.maxY;
          });
          const ids = new Set(op.add ? host.selection : []);
          for (const s of inside) for (const m of this.groupOf(s.id)) ids.add(m);
          host.select([...ids]);
        }
        this.render();
        break;
      }
      case 'draw': {
        if (host.tool === 'pen') {
          this.render();
          break;
        }
        const shape = this.shapeFromDrag(op.p0, op.p1, e.altKey);
        if (shape) {
          host.begin();
          host.doc.shapes.push(shape);
          host.commit(TOOL_LABEL[host.tool]);
          host.select([shape.id]);
          if (host.tool !== 'text') host.setTool('select');
        }
        this.render();
        break;
      }
      case 'pan':
        break;
    }
  }

  private dbl(e: MouseEvent): void {
    const host = this.host;
    if (host.tool === 'line' || host.tool === 'pen') {
      // The double click's second press added a node on the last one: drop it.
      if (this.draft.length > 1) this.draft.pop();
      return this.finishDraft(false);
    }
    if (host.nodeEdit && (e.target as Element).getAttribute('data-node')?.endsWith(',node')) return this.toggleSmooth();
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    const shape = id ? host.doc.shapes.find((s) => s.id === id) : undefined;
    if (shape?.kind === 'path') {
      host.select([shape.id]);
      host.editNodes(shape.id);
      host.status('Düğüm düzenleme: düğümü ya da kolunu sürükleyin; parçaya tıklayınca düğüm eklenir, Sil düğümü kaldırır, çift tık köşe/yumuşak yapar, Esc bitirir.');
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.svg.getBoundingClientRect();
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, [e.clientX - r.left, e.clientY - r.top]);
  }

  // ── Tools ────────────────────────────────────────────────────────────

  private shapeFromDrag(p0: Pt, p1: Pt, fromCentre: boolean): SvgShape | null {
    const host = this.host;
    const tool = host.tool;
    const base = { id: shapeId(), fill: 'fill' as Paint, stroke: 'none' as Paint, strokeWidth: Math.max(1, host.doc.width / 50) };
    if (tool === 'text') return { ...base, kind: 'text', x: p0[0], y: p0[1], text: 'Aa', size: host.doc.height / 5, weight: 700, font: 'sans', anchor: 'start' };
    let dx = p1[0] - p0[0];
    let dy = p1[1] - p0[1];
    if (Math.hypot(dx, dy) < 0.5) return null;
    if (tool === 'polygon') {
      const r = Math.hypot(dx, dy);
      const sp = regularPolygon(p0[0], p0[1], r, Math.max(3, host.options.sides), host.options.star ? r * 0.45 : undefined);
      // The first corner points at the pointer.
      const turn = Math.atan2(dy, dx) + Math.PI / 2;
      const rotated = transformShape({ ...base, kind: 'path', subs: [sp] }, rotation((turn * 180) / Math.PI, p0[0], p0[1]));
      return rotated;
    }
    if (this.shift) {
      const k = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * k;
      dy = Math.sign(dy || 1) * k;
    }
    const x0 = fromCentre ? p0[0] - Math.abs(dx) : Math.min(p0[0], p0[0] + dx);
    const y0 = fromCentre ? p0[1] - Math.abs(dy) : Math.min(p0[1], p0[1] + dy);
    const w = fromCentre ? 2 * Math.abs(dx) : Math.abs(dx);
    const h = fromCentre ? 2 * Math.abs(dy) : Math.abs(dy);
    if (tool === 'rect') return { ...base, kind: 'rect', x: x0, y: y0, w, h };
    return { ...base, kind: 'ellipse', cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2 };
  }

  /** Ends the polyline or pen path being drawn (Enter, double click, a click on its first node). */
  finishDraft(closed: boolean): void {
    const host = this.host;
    const nodes = this.draft;
    this.draft = [];
    this.cursor = null;
    if (nodes.length >= 2) {
      const shape: SvgShape = { id: shapeId(), kind: 'path', subs: [{ nodes, closed }], fill: closed ? 'fill' : 'none', stroke: closed ? 'none' : 'fill', strokeWidth: Math.max(1, host.doc.width / 25) };
      host.begin();
      host.doc.shapes.push(shape);
      host.commit(host.tool === 'pen' ? 'Kalem' : 'Çizgi');
      host.select([shape.id]);
    }
    this.render();
  }

  cancelDraft(): boolean {
    if (!this.draft.length) return false;
    this.draft = [];
    this.cursor = null;
    this.render();
    return true;
  }

  private insertNode(p: Pt): void {
    const host = this.host;
    const shape = host.doc.shapes.find((s) => s.id === host.nodeEdit);
    if (shape?.kind !== 'path') return;
    let best: { sub: number; seg: number; t: number; d: number } | null = null;
    shape.subs.forEach((sp, si) => {
      const n = sp.nodes.length;
      for (let i = 0; i < (sp.closed ? n : n - 1); i++) {
        const a = sp.nodes[i];
        const b = sp.nodes[(i + 1) % n];
        for (let k = 0; k <= 40; k++) {
          const t = k / 40;
          const q = pointAt(a, b, t);
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (!best || d < best.d) best = { sub: si, seg: i, t, d };
        }
      }
    });
    const hit = best as { sub: number; seg: number; t: number; d: number } | null;
    if (!hit || hit.d > 10 / this.zoom || hit.t <= 0 || hit.t >= 1) return;
    host.begin();
    const sp = shape.subs[hit.sub];
    const n = sp.nodes.length;
    const a = sp.nodes[hit.seg];
    const b = sp.nodes[(hit.seg + 1) % n];
    const [left, mid, right] = split(a, b, hit.t);
    sp.nodes[hit.seg] = left;
    sp.nodes[(hit.seg + 1) % n] = right;
    sp.nodes.splice(hit.seg + 1, 0, mid);
    this.nodeSel = { sub: hit.sub, index: hit.seg + 1 };
    host.commit('Düğüm ekle');
  }

  /** Removes the chosen node of the edited path (a subpath keeps at least two). */
  deleteNode(): boolean {
    const host = this.host;
    const shape = host.doc.shapes.find((s) => s.id === host.nodeEdit);
    if (shape?.kind !== 'path' || !this.nodeSel) return false;
    const sp = shape.subs[this.nodeSel.sub];
    if (!sp || sp.nodes.length <= 2) return false;
    host.begin();
    sp.nodes.splice(this.nodeSel.index, 1);
    this.nodeSel = null;
    host.commit('Düğümü sil');
    return true;
  }

  private toggleSmooth(): void {
    const host = this.host;
    const shape = host.doc.shapes.find((s) => s.id === host.nodeEdit);
    if (shape?.kind !== 'path' || !this.nodeSel) return;
    const sp = shape.subs[this.nodeSel.sub];
    const i = this.nodeSel.index;
    const n = sp.nodes[i];
    host.begin();
    if (n.in || n.out) {
      delete n.in;
      delete n.out;
    } else {
      // Handles along the line through the neighbours, a third of the way.
      const len = sp.nodes.length;
      const prev = sp.nodes[(i - 1 + len) % len];
      const next = sp.nodes[(i + 1) % len];
      const dx = (next.x - prev.x) / 6;
      const dy = (next.y - prev.y) / 6;
      n.in = [n.x - dx, n.y - dy];
      n.out = [n.x + dx, n.y + dy];
    }
    host.commit('Düğüm türü');
  }

  private replace(orig: Map<string, SvgShape>, fn: (s: SvgShape) => SvgShape): void {
    const doc = this.host.doc;
    doc.shapes = doc.shapes.map((s) => (orig.has(s.id) ? fn(orig.get(s.id)!) : s));
    this.host.changed();
  }

  private groupOf(id: string): string[] {
    const s = this.host.doc.shapes.find((x) => x.id === id);
    if (!s?.group) return [id];
    return this.host.doc.shapes.filter((x) => x.group === s.group).map((x) => x.id);
  }
}

const TOOL_LABEL: Record<ToolId, string> = { select: 'Seç', node: 'Düğüm', rect: 'Dikdörtgen', ellipse: 'Elips', polygon: 'Çokgen', line: 'Çizgi', pen: 'Kalem', text: 'Yazı' };

function keyPoints(s: SvgShape): Pt[] {
  const b = shapeBox(s);
  const pts: Pt[] = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.minX, b.maxY],
    [b.maxX, b.maxY],
    [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
    [(b.minX + b.maxX) / 2, b.minY],
    [(b.minX + b.maxX) / 2, b.maxY],
    [b.minX, (b.minY + b.maxY) / 2],
    [b.maxX, (b.minY + b.maxY) / 2],
  ];
  if (s.kind === 'path') for (const sp of s.subs) for (const n of sp.nodes) pts.push([n.x, n.y]);
  return pts;
}

function isSmooth(n: PathNode): boolean {
  if (!n.in || !n.out) return false;
  const a = Math.atan2(n.y - n.in[1], n.x - n.in[0]);
  const b = Math.atan2(n.out[1] - n.y, n.out[0] - n.x);
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05;
}

function pointAt(a: PathNode, b: PathNode, t: number): Pt {
  if (!a.out && !b.in) return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
  const c1 = a.out ?? [a.x, a.y];
  const c2 = b.in ?? [b.x, b.y];
  const u = 1 - t;
  return [u * u * u * a.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.y];
}

/** Splits segment a→b at t (de Casteljau): the new a, the middle node, the new b. */
function split(a: PathNode, b: PathNode, t: number): [PathNode, PathNode, PathNode] {
  if (!a.out && !b.in) {
    const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return [a, m, b];
  }
  const p0: Pt = [a.x, a.y];
  const p1: Pt = a.out ?? p0;
  const p3: Pt = [b.x, b.y];
  const p2: Pt = b.in ?? p3;
  const lerp = (u: Pt, v: Pt): Pt => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  return [
    { ...a, out: q0 },
    { x: s[0], y: s[1], in: r0, out: r1 },
    { ...b, in: q2 },
  ];
}

/** Path data in screen space for a node list (drafts). */
function pathD(nodes: PathNode[], closed: boolean, t: (p: Pt) => Pt): string {
  if (!nodes.length) return '';
  const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let d = `M${f(t([nodes[0].x, nodes[0].y]))}`;
  for (let i = 1; i < nodes.length + (closed ? 1 : 0); i++) {
    const a = nodes[i - 1];
    const b = nodes[i % nodes.length];
    d += a.out || b.in ? `C${f(t(a.out ?? [a.x, a.y]))} ${f(t(b.in ?? [b.x, b.y]))} ${f(t([b.x, b.y]))}` : `L${f(t([b.x, b.y]))}`;
  }
  return d;
}

function sameShapes(orig: Map<string, SvgShape>, doc: SvgDoc): boolean {
  return doc.shapes.every((s) => !orig.has(s.id) || JSON.stringify(s) === JSON.stringify(orig.get(s.id)));
}
