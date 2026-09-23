import type { Entity } from '../model/entities';
import { compileExpression } from './expression';
import type { DefaultsContext, DocumentSnapshot, ExecutionTarget, Feedback, FeatureSet, ProcessingTool, RunContext, RunResult } from './types';

/**
 * A run as data. The runner resolves what depends on the host (selection,
 * visible area, layers) into a RunJob that can be copied to a Web Worker
 * or sent to a server; `materialize` turns it back into what `run`
 * receives, against whatever document the executor has (the live one, or
 * a snapshot of its objects).
 */

/** A features input resolved to object ids. */
export interface FeatureRef {
  readonly ids: readonly number[];
  readonly description: string;
}

export interface RunJob {
  readonly toolId: string;
  /** Values keyed by parameter: features as FeatureRef, layers as TargetLayer, the rest as entered. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly units: DefaultsContext;
  readonly selection: readonly number[];
  /** Layer id → name, for expressions and summaries. */
  readonly layers: readonly (readonly [string, string])[];
}

/** Where a tool runs. `execute` gets the job and the document the page has; a remote one copies it. */
export interface Executor {
  readonly target: ExecutionTarget;
  available(): boolean;
  /** Whether this executor has the tool (a worker knows only the tools it was built with). */
  supports?(tool: ProcessingTool): boolean;
  execute(tool: ProcessingTool, job: RunJob, doc: DocumentSnapshot, feedback: Feedback): Promise<RunResult>;
}

const isFeatureRef = (v: unknown): v is FeatureRef => !!v && typeof v === 'object' && Array.isArray((v as FeatureRef).ids) && typeof (v as FeatureRef).description === 'string';

/** The values `run` receives: features as objects of this document, expressions compiled. */
export function materialize(tool: ProcessingTool, values: RunJob['values'], doc: DocumentSnapshot): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const p of tool.parameters) {
    const v = values[p.name];
    if (p.type === 'features' && isFeatureRef(v)) {
      const entities = v.ids.flatMap((id) => doc.get(id) ?? []);
      out[p.name] = { entities, description: v.description } satisfies FeatureSet;
    } else if (p.type === 'expression' && typeof v === 'string') {
      const src = v.trim();
      const r = src ? compileExpression(src) : null;
      out[p.name] = r?.ok ? r.expr : null;
    } else if (p.type === 'field' && typeof v === 'string') out[p.name] = v.trim();
  }
  return out;
}

export function jobContext(job: RunJob, doc: DocumentSnapshot): RunContext {
  const names = new Map(job.layers);
  return { doc, units: job.units, selection: job.selection, layerName: (id) => names.get(id) ?? id };
}

/** Read-only document made of copied objects (in a worker, or for a server request). */
export class EntitySnapshot implements DocumentSnapshot {
  private readonly byId = new Map<number, Entity>();
  private readonly layers = new Map<string, Entity[]>();

  constructor(entities: readonly Entity[]) {
    for (const e of entities) {
      this.byId.set(e.id, e);
      const list = this.layers.get(e.layerId);
      if (list) list.push(e);
      else this.layers.set(e.layerId, [e]);
    }
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  all(): Iterable<Entity> {
    return this.byId.values();
  }

  byLayer(layerId: string): readonly Entity[] {
    return this.layers.get(layerId) ?? [];
  }
}

/** Runs the tool in the page, on the live document. */
export const clientExecutor: Executor = {
  target: 'client',
  available: () => true,
  execute: async (tool, job, doc, feedback) => tool.run(materialize(tool, job.values, doc) as never, jobContext(job, doc), feedback),
};
