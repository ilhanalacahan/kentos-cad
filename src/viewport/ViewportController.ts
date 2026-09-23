import type { AppContext } from '../app/context';
import { DisposableStore, listen } from '../core/disposable';
import { Emitter } from '../core/emitter';
import { Signal } from '../core/signal';
import type { Entity } from '../model/entities';
import type { Edge } from '../model/geom/intersect';
import { entityGrips } from '../model/ops/grips';
import type { Bounds, Vec2 } from '../model/geometry';
import { parseHex, readCanvasPalette, withAlpha, type CanvasPalette } from '../render/color';
import { createBackend } from '../render/createBackend';
import { buildGrid } from '../render/grid';
import { buildSceneLayer } from '../render/sceneBuilder';
import type { BackendKind, RenderBackend } from '../render/types';
import type { ToolPointer } from '../tools/Tool';
import { Camera } from './Camera';
import { drawCrosshair, drawGrips, drawLabels, drawNorthArrow, drawScaleBar, drawSnap, midGripVisible } from './overlay';
import { PickIndex, type SnapHit, type SnapKind } from './picking';

interface ViewportEvents {
  contextmenu: { clientX: number; clientY: number; world: Vec2 };
  /** A tool asks the UI to edit the text of an entity in place. */
  editText: { id: number };
}

/**
 * Owns the GPU canvas, the overlay canvas and the camera. Translates DOM
 * input into tool calls and keeps GPU buffers in sync with the document.
 */
export class ViewportController {
  readonly camera = new Camera();
  readonly cursorWorld = new Signal<Vec2 | null>(null);
  readonly backendKind = new Signal<BackendKind | null>(null);
  readonly backendLabel = new Signal('Başlatılıyor…');
  readonly events = new Emitter<ViewportEvents>();
  palette: CanvasPalette;

  private readonly ctx: AppContext;
  private readonly picker: PickIndex;
  private backend: RenderBackend | null = null;
  private overlay!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private host!: HTMLElement;
  private dpr = 1;
  private readonly d = new DisposableStore();

  private dirtyLayers = new Set<string>();
  private allDirty = true;
  private highlightDirty = true;
  private gridKey = '';
  private frameQueued = false;
  private glQueued = false;

  private screenCursor: Vec2 | null = null;
  /** Entity whose text is being edited inline (hidden from the overlay). */
  private editingId: number | null = null;
  private snap: SnapHit | null = null;
  private panFrom: Vec2 | null = null;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.picker = new PickIndex(ctx.doc);
    this.palette = readCanvasPalette();
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'viewport__overlay';
    this.overlay.tabIndex = 0;
    this.overlay.setAttribute('aria-label', 'Çizim alanı');
    host.append(this.overlay);
    this.g = this.overlay.getContext('2d')!;

    // ?renderer=webgpu overrides the saved preference (handy for testing).
    const param = new URLSearchParams(location.search).get('renderer');
    const preferred: BackendKind[] = [param === 'webgpu' || param === 'webgl2' ? param : this.ctx.prefs.rendererPreference.value];
    try {
      const { backend, errors } = await createBackend(host, preferred);
      this.backend = backend;
      this.backendKind.set(backend.kind);
      this.backendLabel.set(backend.label);
      errors.forEach((e) => this.ctx.log.warn(`Çizim arka ucu atlandı: ${e}`));
      this.ctx.log.info(`Çizim motoru hazır: ${backend.label}`);
    } catch (err) {
      this.backendLabel.set('Kullanılamıyor');
      this.ctx.log.error(`Çizim alanı başlatılamadı: ${(err as Error).message}. Tarayıcıda donanım hızlandırmasını açın.`);
      host.classList.add('viewport--failed');
    }

    this.bindInput();
    this.bindModel();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.d.add(() => ro.disconnect());
    this.resize();
    this.zoomExtents();
    document.fonts?.ready.then(() => this.requestOverlay());
  }

  dispose(): void {
    this.d.dispose();
    this.backend?.dispose();
  }

  // ── Public API used by tools and commands ───────────────────────────

  requestRender(): void {
    this.glQueued = true;
    this.schedule();
  }

  requestOverlay(): void {
    this.schedule();
  }

  pick(screen: Vec2): Entity | null {
    return this.picker.hit(this.camera.screenToWorld(screen), this.ctx.prefs.pickAperture.value / this.camera.scale);
  }

  pickRect(r: Bounds, crossing: boolean): number[] {
    return this.picker.inRect(r, crossing);
  }

  /** Edge-only pick for modify tools (ignores polygon interiors, points and text). */
  pickEdge(screen: Vec2, filter?: (e: Entity) => boolean): Entity | null {
    return this.picker.hitEdge(this.camera.screenToWorld(screen), this.ctx.prefs.pickAperture.value / this.camera.scale, filter);
  }

  /** Smallest closed shape around a world point (hatch boundary). */
  enclosingRing(world: Vec2): { entity: Entity; ring: Vec2[] } | null {
    return this.picker.enclosing(world);
  }

  /** Boundary edges of visible entities overlapping `r`, optionally excluding one entity. */
  edgesIn(r: Bounds, exceptId?: number): Edge[] {
    return this.picker.edgesIn(r, exceptId);
  }

  /** Grip of a selected, unlocked entity under the cursor. */
  gripAt(screen: Vec2): { id: number; index: number } | null {
    const { doc, selection } = this.ctx;
    if (selection.size > 150) return null;
    let found: { id: number; index: number } | null = null;
    let bestD = 6; // px
    for (const id of selection.ids.value) {
      const e = doc.get(id);
      if (!e || doc.layers.isLocked(e.layerId)) continue;
      const grips = entityGrips(e);
      for (let index = 0; index < grips.length; index++) {
        if (!midGripVisible(e, index, grips, this.camera)) continue;
        const s = this.camera.worldToScreen(grips[index]);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d <= bestD) {
          bestD = d;
          found = { id, index };
        }
      }
    }
    return found;
  }

  /** Tools call this; the UI layer owns the actual editor (tools never touch the DOM). */
  requestTextEdit(id: number): void {
    this.events.emit('editText', { id });
  }

  /** Hide an entity's overlay text while an inline editor covers it. */
  setEditing(id: number | null): void {
    this.editingId = id;
    this.requestOverlay();
  }

  /** CSS-pixel rectangle of the viewport in the page (for positioning overlays). */
  clientRect(): DOMRect {
    return this.overlay.getBoundingClientRect();
  }

  /** World distance equivalent to `px` screen pixels at the current zoom. */
  worldTolerance(px: number): number {
    return px / this.camera.scale;
  }

  zoomExtents(): void {
    const b = this.ctx.doc.bounds();
    if (b) this.camera.fit(b);
  }

  zoomToSelection(): void {
    const b = this.ctx.doc.bounds(this.ctx.selection.ids.value);
    if (b) this.camera.fit(b, 96);
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(factor, { x: this.camera.width / 2, y: this.camera.height / 2 });
  }

  focus(): void {
    this.overlay?.focus({ preventScroll: true });
  }

  /** Re-read canvas colours from CSS (theme switch). */
  refreshPalette(): void {
    this.palette = readCanvasPalette();
    this.allDirty = true;
    this.highlightDirty = true;
    this.gridKey = '';
    this.requestRender();
  }

  // ── Wiring ──────────────────────────────────────────────────────────

  private bindModel(): void {
    const { doc, selection, settings, tools } = this.ctx;
    const d = this.d;
    d.add(
      doc.events.on('changed', ({ layerIds }) => {
        layerIds.forEach((id) => this.dirtyLayers.add(id));
        this.highlightDirty = true;
        this.requestRender();
      }),
    );
    d.add(doc.events.on('attrs', () => this.requestOverlay()));
    d.add(
      doc.layers.events.on('state', ({ ids }) => {
        ids.forEach((id) => this.dirtyLayers.add(id));
        this.requestRender();
      }),
    );
    d.add(
      doc.layers.events.on('structure', () => {
        this.allDirty = true;
        this.requestRender();
      }),
    );
    const hl = () => {
      this.highlightDirty = true;
      this.requestRender();
    };
    d.add(selection.ids.subscribe(hl));
    d.add(selection.hover.subscribe(hl));
    d.add(this.camera.changed.subscribe(() => this.requestRender()));
    d.add(settings.grid.subscribe(() => this.requestRender()));
    d.add(this.ctx.prefs.hiDpi.subscribe(() => this.resize()));
    d.add(this.ctx.prefs.crosshair.subscribe(() => this.requestOverlay()));
    d.add(
      tools.activeId.subscribe(() => {
        this.snap = null;
        this.overlay.dataset.cursor = tools.active.cursor;
        this.requestOverlay();
      }),
    );
    this.overlay.dataset.cursor = 'pick';
  }

  private screenOf(e: PointerEvent | MouseEvent): Vec2 {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pointer(e: PointerEvent | MouseEvent): ToolPointer {
    const screen = this.screenOf(e);
    const raw = this.camera.screenToWorld(screen);
    return { world: this.snap?.point ?? raw, raw, screen, snap: this.snap, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private snapKinds(): Set<SnapKind> {
    const p = this.ctx.prefs;
    const kinds = new Set<SnapKind>();
    if (p.snapEndpoint.value) kinds.add('endpoint');
    if (p.snapMidpoint.value) kinds.add('midpoint');
    if (p.snapCenter.value) kinds.add('center');
    if (p.snapNode.value) kinds.add('node');
    if (p.snapEndpoint.value) kinds.add('quadrant');
    if (p.snapIntersection.value) kinds.add('intersection');
    if (p.snapPerpendicular.value) kinds.add('perpendicular');
    if (p.snapNearest.value) kinds.add('nearest');
    if (p.snapTangent.value) kinds.add('tangent');
    return kinds;
  }

  private updateSnap(screen: Vec2): void {
    const tool = this.ctx.tools.active;
    const on = tool.snaps && this.ctx.settings.snap.value;
    this.snap = on
      ? this.picker.snap(this.camera.screenToWorld(screen), this.ctx.prefs.snapAperture.value / this.camera.scale, this.snapKinds(), tool.snapFrom?.() ?? null)
      : null;
  }

  private bindInput(): void {
    const el = this.overlay;
    const d = this.d;
    d.add(
      listen<PointerEvent>(el, 'pointerdown', (e) => {
        el.focus({ preventScroll: true });
        el.setPointerCapture(e.pointerId);
        if (e.button === 1) {
          e.preventDefault();
          this.panFrom = { x: e.clientX, y: e.clientY };
          el.dataset.panning = '';
          return;
        }
        if (e.button === 2) return;
        // Recompute the snap here: a click can arrive without a preceding move
        // (pen, touch, fast clicks), and a stale snap would place the point elsewhere.
        this.updateSnap(this.screenOf(e));
        this.ctx.tools.active.pointerDown?.(this.pointer(e));
      }),
    );
    d.add(
      listen<PointerEvent>(el, 'pointermove', (e) => {
        if (this.panFrom) {
          this.camera.panBy(e.clientX - this.panFrom.x, e.clientY - this.panFrom.y);
          this.panFrom = { x: e.clientX, y: e.clientY };
        }
        const r = el.getBoundingClientRect();
        this.screenCursor = { x: e.clientX - r.left, y: e.clientY - r.top };
        this.updateSnap(this.screenCursor);
        const p = this.pointer(e);
        this.cursorWorld.set(p.world);
        if (!this.panFrom) this.ctx.tools.active.pointerMove?.(p);
        this.requestOverlay();
      }),
    );
    d.add(
      listen<PointerEvent>(el, 'pointerup', (e) => {
        if (e.button === 1 && this.panFrom) {
          this.panFrom = null;
          delete el.dataset.panning;
          return;
        }
        if (e.button !== 0) return;
        this.updateSnap(this.screenOf(e));
        this.ctx.tools.active.pointerUp?.(this.pointer(e));
      }),
    );
    d.add(
      listen<PointerEvent>(el, 'pointerleave', () => {
        this.screenCursor = null;
        this.snap = null;
        this.cursorWorld.set(null);
        if (this.ctx.tools.activeId.value === 'select') this.ctx.selection.hover.set(null);
        this.requestOverlay();
      }),
    );
    d.add(
      listen<WheelEvent>(
        el,
        'wheel',
        (e) => {
          e.preventDefault();
          const step = e.deltaMode === 1 ? e.deltaY * 0.05 : e.deltaY * 0.0015;
          const r = el.getBoundingClientRect();
          this.camera.zoomAt(Math.exp(-step), { x: e.clientX - r.left, y: e.clientY - r.top });
        },
        { passive: false },
      ),
    );
    d.add(
      listen<MouseEvent>(el, 'auxclick', (e) => {
        if (e.button === 1 && e.detail === 2) this.zoomExtents();
      }),
    );
    d.add(
      listen<MouseEvent>(el, 'contextmenu', (e) => {
        e.preventDefault();
        const tool = this.ctx.tools.active;
        // Right click confirms a running command, like Enter.
        if (tool.id !== 'select' && tool.confirm) return tool.confirm();
        this.events.emit('contextmenu', { clientX: e.clientX, clientY: e.clientY, world: this.pointer(e).raw });
      }),
    );
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.dpr = this.ctx.prefs.hiDpi.value ? window.devicePixelRatio || 1 : 1;
    this.overlay.width = Math.round(w * this.dpr);
    this.overlay.height = Math.round(h * this.dpr);
    this.backend?.resize(w, h, this.dpr);
    this.camera.setSize(w, h);
    this.requestRender();
  }

  // ── Frame ───────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.frameQueued = false;
    if (this.backend && this.glQueued) {
      this.glQueued = false;
      this.syncLayers();
      this.renderGl();
    }
    this.drawOverlay();
  }

  private syncLayers(): void {
    const { doc } = this.ctx;
    const backend = this.backend!;
    const ids = this.allDirty ? doc.layers.leaves().map((l) => l.id) : [...this.dirtyLayers];
    this.allDirty = false;
    this.dirtyLayers.clear();
    for (const id of ids) {
      const node = doc.layers.get(id);
      if (!node || node.type !== 'layer') {
        backend.remove(id);
        continue;
      }
      backend.upload(buildSceneLayer(id, doc.byLayer(id), node.style, { origin: doc.origin, palette: this.palette }));
    }
    if (this.highlightDirty) {
      this.highlightDirty = false;
      this.uploadHighlight();
    }
  }

  private uploadHighlight(): void {
    const { doc, selection } = this.ctx;
    const accent = parseHex(this.palette.accent);
    const base = { color: 'fg', lineType: 'continuous' as const, lineWeight: 0.25 };
    const sel = [...selection.ids.value].map((id) => doc.get(id)).filter((e): e is Entity => !!e);
    this.backend!.upload(
      buildSceneLayer('__sel', sel, base, {
        origin: doc.origin,
        palette: this.palette,
        overrideColor: accent,
        overrideFill: withAlpha(accent, 0.13),
        overrideDash: [6, 3],
        pointStyle: { size: 15, shape: 'ring' },
      }),
    );
    const hoverId = selection.hover.value;
    const hover = hoverId !== null && !selection.has(hoverId) ? doc.get(hoverId) : undefined;
    this.backend!.upload(
      buildSceneLayer('__hover', hover ? [hover] : [], base, {
        origin: doc.origin,
        palette: this.palette,
        overrideColor: withAlpha(accent, 0.85),
        // Hover is outline-only: a fill flickers across large areas as the cursor moves.
        overrideFill: null,
        overrideDash: null,
        pointStyle: { size: 15, shape: 'ring' },
      }),
    );
  }

  private renderGl(): void {
    const { doc, settings } = this.ctx;
    const origin = doc.origin;
    const cam = this.camera;
    const view = {
      center: { x: cam.center.x - origin.x, y: cam.center.y - origin.y },
      scale: cam.scale,
      width: cam.width,
      height: cam.height,
      dpr: this.dpr,
    };
    const showGrid = settings.grid.value;
    const key = showGrid ? `${cam.center.x}|${cam.center.y}|${cam.scale}|${cam.width}|${cam.height}` : 'off';
    if (key !== this.gridKey) {
      this.gridKey = key;
      if (showGrid) this.backend!.upload(buildGrid(view, origin, this.palette));
      else this.backend!.remove('__grid');
    }
    const order = doc.layers
      .leaves()
      .filter((l) => doc.layers.isVisible(l.id))
      .map((l) => l.id)
      .reverse();
    this.backend!.render({
      view,
      clearColor: this.palette.background,
      order,
      underlays: showGrid ? ['__grid'] : [],
      overlays: ['__hover', '__sel'],
    });
  }

  private drawOverlay(): void {
    const g = this.g;
    const cam = this.camera;
    const pal = this.palette;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, cam.width, cam.height);
    drawLabels(g, this.ctx.doc, cam, pal, (e) => this.picker.boundsOf(e), (m) => this.ctx.format.length(m, false), this.editingId);
    const sel = [...this.ctx.selection.ids.value].map((id) => this.ctx.doc.get(id)).filter((e): e is Entity => !!e);
    drawGrips(g, sel, cam, pal, this.ctx.tools.active.activeGrip?.() ?? null);
    this.ctx.tools.active.draw?.(g, cam);
    if (this.snap) drawSnap(g, this.snap, cam, pal);
    drawNorthArrow(g, cam, pal);
    drawScaleBar(g, cam, pal);
    if (this.screenCursor && !this.panFrom) drawCrosshair(g, this.screenCursor, this.ctx.tools.active.cursor, pal, this.ctx.prefs.crosshair.value);
  }
}
