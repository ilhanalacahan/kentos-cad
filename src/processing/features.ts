import type { CadDocument } from '../model/document';
import { ENTITY_KIND_LABEL, entityBounds, type Entity, type EntityKind } from '../model/entities';
import type { Bounds } from '../model/geometry';
import type { FeatureSet, FeaturesParam, FeaturesValue } from './types';

/**
 * Turns a features value (selection, visible, all, a layer, explicit ids)
 * into the objects a tool works on. Selection and the visible area come
 * from the host, so this module stays free of UI and viewport.
 */

export interface FeatureHost {
  readonly doc: CadDocument;
  selectedIds(): readonly number[];
  /** World box on screen, or null when there is no view (tests, server). */
  visibleBounds(): Bounds | null;
  /** Replaces the selection (tools that select); absent where there is none. */
  select?(ids: readonly number[]): void;
}

export const SCOPE_LABEL: Record<FeaturesValue['scope'], string> = {
  selection: 'Seçili nesneler',
  visible: 'Görünen alandakiler',
  all: 'Tümü (görünen katmanlar)',
  layer: 'Bir katman',
  ids: 'Önceki adımın çıktısı',
};

const overlaps = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Objects in scope, before the kind filter. */
function inScope(value: FeaturesValue, host: FeatureHost): Entity[] {
  const { doc } = host;
  const shown = (e: Entity) => doc.layers.isVisible(e.layerId);
  switch (value.scope) {
    case 'selection':
      return host.selectedIds().flatMap((id) => doc.get(id) ?? []);
    case 'visible': {
      const view = host.visibleBounds();
      return [...doc.all()].filter((e) => shown(e) && e.kind !== 'xline' && e.kind !== 'ray' && (!view || overlaps(entityBounds(e), view)));
    }
    case 'all':
      return [...doc.all()].filter(shown);
    case 'layer': {
      // A group means every layer under it.
      const leaves = new Set(doc.layers.leavesOf(value.layerId).map((l) => l.id));
      leaves.add(value.layerId);
      return [...doc.all()].filter((e) => leaves.has(e.layerId));
    }
    case 'ids':
      return value.ids.flatMap((id) => doc.get(id) ?? []);
  }
}

/** "12 kapalı alan" / "7 nesne (kapalı alan, çoklu çizgi)". */
export function describeCount(entities: readonly Entity[]): string {
  if (!entities.length) return 'uygun nesne yok';
  const kinds = [...new Set(entities.map((e) => e.kind))];
  if (kinds.length === 1) return `${entities.length} ${ENTITY_KIND_LABEL[kinds[0]].toLocaleLowerCase('tr-TR')}`;
  return `${entities.length} nesne (${kinds.map((k) => ENTITY_KIND_LABEL[k].toLocaleLowerCase('tr-TR')).join(', ')})`;
}

export function resolveFeatures(value: FeaturesValue, def: Pick<FeaturesParam, 'kinds'>, host: FeatureHost): FeatureSet {
  return narrow(value, host, fitting(value, def, host));
}

/** Objects in scope that the tool can take, before the user's kind filter. */
function fitting(value: FeaturesValue, def: Pick<FeaturesParam, 'kinds'>, host: FeatureHost): Entity[] {
  const kinds = def.kinds ? new Set<EntityKind>(def.kinds) : null;
  return inScope(value, host).filter((e) => !kinds || kinds.has(e.kind));
}

function narrow(value: FeaturesValue, host: FeatureHost, candidates: Entity[]): FeatureSet {
  const only = value.kinds ? new Set<EntityKind>(value.kinds) : null;
  const entities = only ? candidates.filter((e) => only.has(e.kind)) : candidates;
  if (!entities.length) return { entities, description: `${WHERE_IN[value.scope](host, value)} uygun nesne yok` };
  const where = value.scope === 'layer' ? `“${host.doc.layers.get(value.layerId)?.name ?? '?'}” katmanında` : SCOPE_LABEL[value.scope].toLocaleLowerCase('tr-TR');
  return { entities, description: `${describeCount(entities)}; ${where}` };
}

/** A features parameter as the dialog shows it before running. */
export interface InputSummary {
  count: number;
  description: string;
  /** Kinds in scope the tool can take, with counts (for the kind filter), before that filter. */
  byKind: { kind: EntityKind; count: number }[];
  /** Attribute names on the objects, most common first (field pickers, expressions). */
  fields: { name: string; count: number }[];
}

export function summarizeFeatures(value: FeaturesValue, def: Pick<FeaturesParam, 'kinds'>, host: FeatureHost): InputSummary {
  const candidates = fitting(value, def, host);
  const set = narrow(value, host, candidates);
  const kinds = new Map<EntityKind, number>();
  for (const e of candidates) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const fields = new Map<string, number>();
  for (const e of set.entities.slice(0, 20000)) for (const k of Object.keys(e.attrs)) fields.set(k, (fields.get(k) ?? 0) + 1);
  return {
    count: set.entities.length,
    description: set.description,
    byKind: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    fields: [...fields].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr')),
  };
}

/** "Seçili nesneler arasında uygun nesne yok" — where the tool looked, as a sentence start. */
const WHERE_IN: Record<FeaturesValue['scope'], (host: FeatureHost, v: FeaturesValue) => string> = {
  selection: () => 'Seçili nesneler arasında',
  visible: () => 'Görünen alanda',
  all: () => 'Görünen katmanlarda',
  layer: (host, v) => `“${v.scope === 'layer' ? (host.doc.layers.get(v.layerId)?.name ?? '?') : '?'}” katmanında`,
  ids: () => 'Önceki adımın çıktısında',
};
