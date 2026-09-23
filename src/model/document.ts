import { Emitter } from '../core/emitter';
import { Signal } from '../core/signal';
import { entityBounds, type Entity, type NewEntity } from './entities';
import type { CrsDef } from '../geo/crs';
import { ProjectSettings, type ProjectSettingsData } from './projectSettings';
import { emptyBounds, isEmptyBounds, type Bounds, type Vec2 } from './geometry';
import type { LayerStyle } from './layers';
import { LayerStore } from './layers';
import type { ProjectStyles } from './style';

type Op =
  | { type: 'add'; entity: Entity }
  | { type: 'remove'; entity: Entity }
  | { type: 'update'; before: Entity; after: Entity }
  /** A layer's look (colour, line type, renderer …) is project data: undoable like objects. */
  | { type: 'layerStyle'; layerId: string; before: LayerStyle; after: LayerStyle };

interface Transaction {
  label: string;
  ops: Op[];
}

interface DocumentEvents {
  /** Entities on these layers changed geometry or membership. */
  changed: { layerIds: Set<string> };
  /** Only attributes changed (no geometry rebuild needed). */
  attrs: { ids: number[] };
}

/**
 * The drawing. Coordinates are stored in float64 world units; `origin` is a
 * local anchor near the data so the GPU can work in float32 without jitter
 * (TM coordinates reach 4 500 000 m).
 */
export class CadDocument {
  readonly events = new Emitter<DocumentEvents>();
  readonly name: Signal<string>;
  readonly dirty = new Signal(false);
  readonly canUndo = new Signal(false);
  readonly canRedo = new Signal(false);
  /** Project-scoped settings (CRS, units, plot scale) — saved with the file. */
  readonly settings: ProjectSettings;
  readonly layers: LayerStore;
  readonly origin: Vec2;
  /** Symbols and assets that belong to this project (docs/STYLE.md §5), saved with the file. */
  readonly styles = new Signal<ProjectStyles>({ items: [], categories: [] });
  /** Where the view opens (the project's start extent); all objects when unset. */
  homeView: Bounds | null = null;

  private entities = new Map<number, Entity>();
  private nextId = 1;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private pending: Transaction | null = null;
  /** Open group (see beginGroup): committed transactions join it instead of the undo stack. */
  private group: Transaction | null = null;

  constructor(opts: { name: string; layers: LayerStore; origin: Vec2; settings?: Partial<ProjectSettingsData> }) {
    this.name = new Signal(opts.name);
    this.layers = opts.layers;
    this.origin = opts.origin;
    this.settings = new ProjectSettings(opts.settings);
    // Project settings are part of the file: changing them is an edit.
    this.settings.changed.subscribe(() => this.dirty.set(true));
    this.name.subscribe(() => this.dirty.set(true));
    this.styles.subscribe(() => this.dirty.set(true));
  }

  /**
   * Assigned CRS. Changing it re-labels coordinates; it does not reproject
   * (reprojection is an explicit, undoable geo/transform operation).
   */
  get crs(): Signal<CrsDef> {
    return this.settings.crs;
  }

  get size(): number {
    return this.entities.size;
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  all(): IterableIterator<Entity> {
    return this.entities.values();
  }

  byLayer(layerId: string): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) if (e.layerId === layerId) out.push(e);
    return out;
  }

  countByLayer(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.entities.values()) m.set(e.layerId, (m.get(e.layerId) ?? 0) + 1);
    return m;
  }

  bounds(ids?: Iterable<number>): Bounds | null {
    const b = emptyBounds();
    const list = ids ? [...ids].map((id) => this.entities.get(id)).filter((e): e is Entity => !!e) : this.entities.values();
    for (const e of list) {
      const eb = entityBounds(e);
      b.minX = Math.min(b.minX, eb.minX);
      b.minY = Math.min(b.minY, eb.minY);
      b.maxX = Math.max(b.maxX, eb.maxX);
      b.maxY = Math.max(b.maxY, eb.maxY);
    }
    return isEmptyBounds(b) ? null : b;
  }

  // ── Editing (all edits are undoable) ────────────────────────────────

  /** Groups several edits into one undo step. */
  transact<T>(label: string, fn: () => T): T {
    if (this.pending) return fn();
    this.pending = { label, ops: [] };
    try {
      return fn();
    } finally {
      const tx = this.pending;
      this.pending = null;
      if (tx.ops.length) this.commit(tx);
    }
  }

  /**
   * Groups everything committed until `end()` into one undo step, across
   * awaits (a processing model runs several tools, each applying its own
   * transaction). `cancel()` reverts what the group did and records
   * nothing. A group inside a group joins the outer one.
   */
  beginGroup(label: string): { end(): void; cancel(): void } {
    if (this.group) return { end: () => {}, cancel: () => {} };
    const g: Transaction = { label, ops: [] };
    this.group = g;
    const close = () => {
      if (this.group === g) this.group = null;
    };
    return {
      end: () => {
        close();
        if (g.ops.length) this.commit(g);
      },
      cancel: () => {
        close();
        if (g.ops.length) this.applyAll([...g.ops].reverse().map(invert));
      },
    };
  }

  add(init: NewEntity): Entity {
    const entity = { ...init, id: this.nextId++ } as Entity;
    this.record({ type: 'add', entity }, 'Ekle');
    return entity;
  }

  remove(ids: Iterable<number>): void {
    this.transact('Sil', () => {
      for (const id of ids) {
        const entity = this.entities.get(id);
        if (entity) this.record({ type: 'remove', entity }, 'Sil');
      }
    });
  }

  /** Changes a layer's style as one undoable step (the Layers panel, the layer style window). */
  setLayerStyle(layerId: string, patch: Partial<LayerStyle>, label = 'Katman stili'): void {
    const node = this.layers.get(layerId);
    if (!node) return;
    const before = structuredClone(node.style);
    const after = { ...before, ...structuredClone(patch) };
    for (const k of Object.keys(after) as (keyof LayerStyle)[]) if (after[k] === undefined) delete after[k];
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.record({ type: 'layerStyle', layerId, before, after }, label);
  }

  update(id: number, patch: Partial<Entity>): void {
    const before = this.entities.get(id);
    if (!before) return;
    const after = { ...before, ...patch, id } as Entity;
    // Holes belong to polygons only: trimming or breaking one opens it into a polyline.
    if (after.kind !== 'polygon' && 'holes' in after) delete (after as { holes?: unknown }).holes;
    this.record({ type: 'update', before, after }, 'Değiştir');
  }

  /** Bulk load without history (file open, sample data). */
  load(list: NewEntity[]): void {
    for (const init of list) {
      const entity = { ...init, id: this.nextId++ } as Entity;
      this.entities.set(entity.id, entity);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistory();
    this.events.emit('changed', { layerIds: new Set(list.map((e) => e.layerId)) });
  }

  undo(): string | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.applyAll([...tx.ops].reverse().map(invert));
    this.redoStack.push(tx);
    this.syncHistory();
    return tx.label;
  }

  redo(): string | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.applyAll(tx.ops);
    this.undoStack.push(tx);
    this.syncHistory();
    return tx.label;
  }

  private record(op: Op, label: string): void {
    if (this.pending) {
      this.pending.ops.push(op);
      this.applyAll([op]);
    } else {
      this.applyAll([op]);
      this.commit({ label, ops: [op] });
    }
  }

  private commit(tx: Transaction): void {
    if (this.group && tx !== this.group) {
      this.group.ops.push(...tx.ops);
      return;
    }
    this.undoStack.push(tx);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty.set(true);
    this.syncHistory();
  }

  private applyAll(ops: Op[]): void {
    const layerIds = new Set<string>();
    const attrIds: number[] = [];
    for (const op of ops) {
      if (op.type === 'layerStyle') {
        this.layers.replaceStyle(op.layerId, op.after);
        continue;
      }
      if (op.type === 'add') {
        this.entities.set(op.entity.id, op.entity);
        layerIds.add(op.entity.layerId);
      } else if (op.type === 'remove') {
        this.entities.delete(op.entity.id);
        layerIds.add(op.entity.layerId);
      } else {
        this.entities.set(op.after.id, op.after);
        if (geometryChanged(op.before, op.after)) {
          layerIds.add(op.before.layerId);
          layerIds.add(op.after.layerId);
        } else attrIds.push(op.after.id);
      }
    }
    if (layerIds.size) this.events.emit('changed', { layerIds });
    if (attrIds.length) this.events.emit('attrs', { ids: attrIds });
  }

  private syncHistory(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }
}

function invert(op: Op): Op {
  if (op.type === 'layerStyle') return { ...op, before: op.after, after: op.before };
  if (op.type === 'add') return { type: 'remove', entity: op.entity };
  if (op.type === 'remove') return { type: 'add', entity: op.entity };
  return { type: 'update', before: op.after, after: op.before };
}

function geometryChanged(a: Entity, b: Entity): boolean {
  if (a.layerId !== b.layerId || a.color !== b.color || a.label !== b.label) return true;
  const { attrs: _a, ...ga } = a;
  const { attrs: _b, ...gb } = b;
  return JSON.stringify(ga) !== JSON.stringify(gb);
}
