import { Signal } from '../core/signal';
import { foldTurkish } from '../core/text';
import type { Entity, NewEntity } from '../model/entities';
import { resolveFeatures, type FeatureHost } from './features';
import { isVisible, validateValues, type ValidationIssue } from './parameters';
import type { DefaultsContext, ExecutionTarget, Feedback, FeaturesValue, LayerParam, LayerValue, ProcessingTool, RunContext, RunResult, TargetLayer } from './types';

/**
 * Runs processing tools: validate → resolve inputs → execute on the first
 * available target → apply the ChangeSet as one undo step → record
 * history. Only the "client" executor exists today; worker, server and
 * PostGIS executors plug in through the same Executor interface.
 */

export interface Executor {
  readonly target: ExecutionTarget;
  available(): boolean;
  execute(tool: ProcessingTool, values: Record<string, unknown>, ctx: RunContext, feedback: Feedback): Promise<RunResult>;
}

/** Runs the tool in the page, on the live document. */
export const clientExecutor: Executor = {
  target: 'client',
  available: () => true,
  execute: async (tool, values, ctx, feedback) => tool.run(values as never, ctx, feedback),
};

export interface RunRecord {
  readonly seq: number;
  readonly toolId: string;
  readonly label: string;
  /** Values as entered (JSON-safe copy), for "run again". */
  readonly values: Record<string, unknown>;
  readonly started: number;
  readonly ms: number;
  readonly status: 'ok' | 'error' | 'canceled';
  readonly summary: string;
  /** Ids of objects the run created. */
  readonly added: readonly number[];
}

export type RunOutcome =
  | { status: 'ok'; result: RunResult; added: number[]; record: RunRecord }
  | { status: 'invalid'; issues: ValidationIssue[] }
  | { status: 'canceled' | 'error'; message: string; record: RunRecord };

/** A features parameter as the dialog shows it before running. */
export interface InputSummary {
  count: number;
  description: string;
}

export interface RunProgress {
  toolId: string;
  fraction: number;
  label: string;
}

const HISTORY_LIMIT = 100;

function emptyInputMessage(label: string, v: FeaturesValue): string {
  switch (v.scope) {
    case 'selection':
      return `“${label}”: seçili nesneler arasında uygun nesne yok. Önce nesneleri seçin ya da kapsamı değiştirin.`;
    case 'visible':
      return `“${label}”: görünen alanda uygun nesne yok. Görünümü kaydırın ya da kapsamı değiştirin.`;
    case 'layer':
      return `“${label}”: bu katmanda uygun nesne yok. Başka bir katman seçin.`;
    default:
      return `“${label}”: uygun nesne yok.`;
  }
}

export class ProcessingRunner {
  readonly running = new Signal<RunProgress | null>(null);
  readonly history = new Signal<readonly RunRecord[]>([]);
  private readonly host: FeatureHost;
  private readonly executors: Executor[];
  private canceled = false;
  private seq = 0;

  constructor(host: FeatureHost, executors: Executor[] = [clientExecutor]) {
    this.host = host;
    this.executors = executors;
  }

  defaults(): DefaultsContext {
    const s = this.host.doc.settings;
    return {
      lengthDecimals: s.lengthDecimals.value,
      areaDecimals: s.areaDecimals.value,
      angleUnit: s.angleUnit.value,
      plotScale: s.plotScale.value,
      activeLayer: this.host.doc.layers.active.value,
    };
  }

  validate(tool: ProcessingTool, values: Record<string, unknown>): ValidationIssue[] {
    const layers = this.host.doc.layers;
    return validateValues(tool, values, { layerExists: (id) => !!layers.get(id), layerLocked: (id) => layers.isLocked(id) });
  }

  /** What each features parameter currently resolves to ("12 kapalı alan; seçili nesneler"). */
  describeInputs(tool: ProcessingTool, values: Record<string, unknown>): Record<string, InputSummary> {
    const out: Record<string, InputSummary> = {};
    for (const p of tool.parameters) {
      if (p.type !== 'features' || !values[p.name]) continue;
      const set = resolveFeatures(values[p.name] as FeaturesValue, p, this.host);
      out[p.name] = { count: set.entities.length, description: set.description };
    }
    return out;
  }

  /** The executor that will run the tool, or null when none of its targets is available here. */
  executorFor(tool: ProcessingTool): Executor | null {
    for (const t of tool.targets) {
      const ex = this.executors.find((e) => e.target === t && e.available());
      if (ex) return ex;
    }
    return null;
  }

  cancel(): void {
    this.canceled = true;
  }

  async run(tool: ProcessingTool, values: Record<string, unknown>, log?: (level: 'info' | 'warn', message: string) => void): Promise<RunOutcome> {
    const issues = this.validate(tool, values);
    if (issues.length) return { status: 'invalid', issues };
    const started = Date.now();
    const copy = JSON.parse(JSON.stringify(values)) as Record<string, unknown>;
    const record = (status: RunRecord['status'], summary: string, added: number[] = []): RunRecord => {
      const r: RunRecord = { seq: ++this.seq, toolId: tool.id, label: tool.label, values: copy, started, ms: Date.now() - started, status, summary, added };
      this.history.set([r, ...this.history.value].slice(0, HISTORY_LIMIT));
      return r;
    };
    const executor = this.executorFor(tool);
    if (!executor) {
      const message = `“${tool.label}” bu ortamda çalıştırılamıyor (${tool.targets.join(', ')} gerekli).`;
      return { status: 'error', message, record: record('error', message) };
    }

    // Resolve inputs: features to objects, layers to a target (new layers are made only on apply).
    const resolved: Record<string, unknown> = { ...values };
    const newLayers = new Map<string, { name: string; def: LayerParam }>();
    for (const p of tool.parameters) {
      const v = values[p.name];
      if (!isVisible(p, values) || v === null || v === undefined) continue;
      if (p.type === 'features') {
        const set = resolveFeatures(v as FeaturesValue, p, this.host);
        // Running on nothing is a mistake worth stopping (usually: nothing selected);
        // an empty output passed along a model is not.
        if (!set.entities.length && !p.optional && (v as FeaturesValue).scope !== 'ids') return { status: 'invalid', issues: [{ param: p.name, message: emptyInputMessage(p.label, v as FeaturesValue) }] };
        resolved[p.name] = set;
      }
      if (p.type === 'layer') {
        const target = this.resolveLayer(v as LayerValue);
        if (target.isNew) newLayers.set(target.id, { name: target.name, def: p });
        resolved[p.name] = target;
      }
    }

    this.canceled = false;
    let lastYield = performance.now();
    const isCanceled = () => this.canceled;
    const feedback: Feedback = {
      progress: (fraction, label) => this.running.set({ toolId: tool.id, fraction: Math.max(0, Math.min(1, fraction)), label: label ?? '' }),
      info: (m) => log?.('info', m),
      warn: (m) => log?.('warn', m),
      get canceled() {
        return isCanceled();
      },
      yield: () => {
        if (performance.now() - lastYield < 16) return Promise.resolve();
        return new Promise((r) =>
          setTimeout(() => {
            lastYield = performance.now();
            r();
          }, 0),
        );
      },
    };
    this.running.set({ toolId: tool.id, fraction: 0, label: '' });
    try {
      const result = await executor.execute(tool, resolved, { doc: this.host.doc, units: this.defaults() }, feedback);
      if (this.canceled) {
        const message = 'İşlem iptal edildi; çizim değişmedi.';
        return { status: 'canceled', message, record: record('canceled', message) };
      }
      const added = this.apply(tool, result, newLayers, log);
      const summary = result.summary ?? `${added.length} nesne eklendi.`;
      return { status: 'ok', result, added, record: record('ok', summary, added) };
    } catch (err) {
      const message = `“${tool.label}” çalışırken hata: ${(err as Error).message}`;
      return { status: 'error', message, record: record('error', message) };
    } finally {
      this.running.set(null);
    }
  }

  /**
   * A new-layer value reuses a layer that already has that name (running a
   * tool twice keeps writing to the same "Köşe noktaları"); otherwise it
   * gets an id now and is created on apply.
   */
  private resolveLayer(v: LayerValue): TargetLayer {
    const layers = this.host.doc.layers;
    if ('layerId' in v) return { id: v.layerId, name: layers.get(v.layerId)?.name ?? v.layerId, isNew: false };
    const name = v.newName.trim();
    const same = layers.leaves().find((l) => foldTurkish(l.name) === foldTurkish(name));
    if (same) return { id: same.id, name: same.name, isNew: false };
    let id = `islem-${foldTurkish(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    for (let k = 2; layers.get(id); k++) id = `${id}-${k}`;
    return { id, name, isNew: true };
  }

  /** Applies the ChangeSet in one undo step; locked layers are left alone and counted. */
  private apply(tool: ProcessingTool, result: RunResult, newLayers: Map<string, { name: string; def: LayerParam }>, log?: (level: 'info' | 'warn', message: string) => void): number[] {
    const { doc } = this.host;
    const ch = result.changes;
    if (!ch) return [];
    // Layers the run writes to but that do not exist yet.
    for (const e of ch.add ?? []) {
      const pending = newLayers.get(e.layerId);
      if (!pending || doc.layers.get(e.layerId)) continue;
      doc.layers.add({ id: e.layerId, name: pending.name, style: pending.def.newLayerStyle }, null);
    }
    const locked = (layerId: string) => doc.layers.isLocked(layerId);
    let skipped = 0;
    const added: number[] = [];
    doc.transact(tool.label, () => {
      for (const id of ch.remove ?? []) {
        const e = doc.get(id);
        if (!e) continue;
        if (locked(e.layerId)) skipped++;
        else doc.remove([id]);
      }
      for (const u of ch.update ?? []) {
        const e = doc.get(u.id);
        if (!e) continue;
        if (locked(e.layerId)) skipped++;
        else doc.update(u.id, u.patch as Partial<Entity>);
      }
      for (const n of ch.add ?? []) {
        if (!doc.layers.get(n.layerId) || locked(n.layerId)) {
          skipped++;
          continue;
        }
        added.push(doc.add(n as NewEntity).id);
      }
    });
    if (skipped) log?.('warn', `${skipped} değişiklik kilitli ya da olmayan katmanda olduğu için atlandı.`);
    return added;
  }
}
