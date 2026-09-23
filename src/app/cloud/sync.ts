import { Signal } from '../../core/signal';
import type { CommandEnvelope } from '../../contracts/generated/CommandEnvelope';
import type { EventRecord } from '../../contracts/generated/EventRecord';
import type { FeatureConflict } from '../../contracts/generated/FeatureConflict';
import type { FeatureRecord } from '../../contracts/generated/FeatureRecord';
import type { ProjectPatch } from '../../contracts/generated/ProjectPatch';
import type { CadDocument, ExternalMeta } from '../../model/document';
import type { Entity } from '../../model/entities';
import { ApiFailure, type CloudApi } from './api';
import type { Draft, DraftStore } from './drafts';
import { readEntities, readIncoming } from './incoming';
import { Tracker, changeOf, entityJson, metaParts, metaPatch, type MetaParts, type Planned } from './tracker';

/**
 * Autosave of an open cloud project (CLAUDE.md §21.3, §15 "Edit commit
 * protokolü"). Edits are diffed against what the server acknowledged
 * (tracker.ts), kept on this device as a draft while they wait, and sent a
 * second after the last edit (at most five seconds after the first) as one
 * `project.changes` command at a time. "Kaydedildi" is shown only after the
 * server's answer, with nothing left to send.
 *
 * - A lost answer or a dead network: the same command goes again with the
 *   same idempotency key (the server answers from its log, never twice).
 * - A 409: nothing more is sent until the user chooses the server's copy or
 *   theirs; the local drawing is kept either way until then.
 * - Another editor's changes (events): applied at once, unless the object
 *   has unsent local changes, which makes it a conflict too.
 */

export type SaveState = 'saved' | 'pending' | 'saving' | 'offline_pending' | 'conflict' | 'error' | 'readonly';

export interface SyncConflict {
  featureId: string;
  localId: number | null;
  reason: 'changed' | 'deleted' | 'exists' | 'project' | 'remote';
  /** The server's current copy (null when deleted, or for the project's metadata). */
  server: FeatureRecord | null;
  /** The server's current version (null when deleted). */
  actual: string | null;
}

export interface SyncOptions {
  doc: CadDocument;
  api: CloudApi;
  drafts: DraftStore;
  draftKey: string;
  userId: string;
  tenantId: string;
  projectId: string;
  /** Whether this account may change the project's metadata (layer tree, settings, name, styles). */
  canEditMeta: boolean;
  /** Whether it may change objects at all (a viewer may not: edits stay on screen, unsent). */
  canWrite?: boolean;
  metaVersion: string;
  cursor: string;
  /** What the server sent when the project was opened. */
  records: readonly { localId: number; featureId: string; version: string }[];
  warn: (text: string) => void;
  newId?: () => string;
  debounceMs?: number;
  maxDelayMs?: number;
}

const BATCH = 2000;
const DRAFT_MS = 300;
const uuid = () => crypto.randomUUID();

interface Inflight {
  envelope: CommandEnvelope;
  planned: Planned[];
  meta: MetaParts | null;
  revision: number;
}

export class ProjectSync {
  readonly state = new Signal<SaveState>('saved');
  /** Objects (and the metadata) waiting to be sent. */
  readonly pending = new Signal(0);
  readonly conflicts = new Signal<readonly SyncConflict[]>([]);
  readonly lastSaved = new Signal<number | null>(null);
  readonly error = new Signal('');
  /** The newest event cursor applied. */
  cursor: string;
  private readonly o: SyncOptions;
  private readonly tracker: Tracker;
  private readonly dirty = new Set<number>();
  private metaDirty = false;
  private metaVersion: string;
  private metaBase: MetaParts;
  private inflight: Inflight | null = null;
  private readonly own = new Set<string>();
  private flushing: Promise<boolean> | null = null;
  private again = false;
  private firstPending = 0;
  private timer = 0;
  private draftTimer = 0;
  private retries = 0;
  private remoteQueue: Promise<void> = Promise.resolve();
  private readonly unsubscribe: (() => void)[] = [];
  private noticeShown = false;
  private disposed = false;

  constructor(o: SyncOptions) {
    this.o = o;
    this.cursor = o.cursor;
    this.metaVersion = o.metaVersion;
    this.tracker = new Tracker(o.newId ?? uuid);
    for (const r of o.records) {
      const e = o.doc.get(r.localId);
      this.tracker.set(r.localId, { featureId: r.featureId, version: r.version, json: e ? entityJson(e) : null });
    }
    this.metaBase = metaParts(o.doc);
    const doc = o.doc;
    this.unsubscribe.push(
      doc.events.on('touched', (e) => {
        if (e.external) return;
        for (const id of e.ids) this.dirty.add(id);
        if (e.layerStyles) this.metaDirty = true;
        this.changed();
      }),
      doc.name.subscribe(() => this.metaChanged()),
      doc.settings.changed.subscribe(() => this.metaChanged()),
      doc.styles.subscribe(() => this.metaChanged()),
      doc.layers.events.on('structure', () => this.metaChanged()),
      doc.layers.events.on('state', () => this.metaChanged()),
    );
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.draftTimer);
    for (const u of this.unsubscribe) u();
  }

  /** The server id of a local object (for tests and the conflict list). */
  featureOf(localId: number): string | undefined {
    return this.tracker.get(localId)?.featureId;
  }

  /** Objects that came from the server or the device, checked like a file; a bad one is reported and left out. */
  private checked(list: readonly { key: string; entity: unknown }[]): Map<string, Entity> {
    const out = new Map<string, Entity>();
    if (!list.length) return out;
    // One check for the batch; only a failing batch is checked object by object, to name the bad one.
    const all = readEntities(this.o.doc, list.map((i) => i.entity));
    if (all.ok) {
      list.forEach((item, i) => out.set(item.key, all.entities[i]));
      return out;
    }
    for (const item of list) {
      const read = readEntities(this.o.doc, [item.entity]);
      if (read.ok) out.set(item.key, read.entities[0]);
      else this.o.warn(`Buluttan gelen bir nesne okunamadı (${item.key}): ${read.error}`);
    }
    return out;
  }

  /** The project's metadata from the server, checked; null (and a warning) when unreadable. */
  private async serverMeta(): Promise<{ meta: ExternalMeta; version: string } | null> {
    const info = await this.o.api.project(this.o.tenantId, this.o.projectId);
    const read = readIncoming(info, []);
    if (!read.ok) {
      this.o.warn(`Proje bilgileri sunucudan okunamadı: ${read.error}`);
      return null;
    }
    const c = read.content;
    return { meta: { name: c.name, settings: c.settings, layers: c.layers, styles: c.styles }, version: info.metaVersion };
  }

  private metaChanged(): void {
    // The quiet external meta changes also arrive here; they leave the drawing equal to the base.
    if (metaPatch(this.o.doc, this.metaBase) === null) return;
    this.metaDirty = true;
    this.changed();
  }

  private sendsMeta(): boolean {
    return this.metaDirty && this.o.canEditMeta;
  }

  private changed(): void {
    if (this.disposed) return;
    if (this.o.canWrite === false) {
      if (!this.noticeShown) {
        this.noticeShown = true;
        this.o.warn('Bu projeyi yalnız görüntüleyebilirsiniz; değişiklikleriniz buluta kaydedilmez.');
      }
      this.state.set('readonly');
      return;
    }
    this.pending.set(this.dirty.size + (this.sendsMeta() ? 1 : 0));
    if (this.metaDirty && !this.o.canEditMeta && !this.noticeShown) {
      this.noticeShown = true;
      this.o.warn('Katman ve proje bilgisi değişiklikleriniz yalnız bu cihazda kalıyor: projede bunları değiştirme yetkiniz yok.');
    }
    if (!this.firstPending) this.firstPending = Date.now();
    if (this.state.value === 'saved' || this.state.value === 'error') this.state.set('pending');
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.saveDraft(), DRAFT_MS) as unknown as number;
    this.schedule();
  }

  private schedule(delay?: number): void {
    clearTimeout(this.timer);
    if (this.conflicts.value.length) return;
    const debounce = this.o.debounceMs ?? 1000;
    const latest = this.firstPending + (this.o.maxDelayMs ?? 5000) - Date.now();
    this.timer = setTimeout(() => void this.flush(), delay ?? Math.max(0, Math.min(debounce, latest))) as unknown as number;
  }

  // ── Drafts ─────────────────────────────────────────────────────────────

  private draft(): Draft | null {
    const changes: Draft['changes'] = {};
    for (const id of this.dirty) {
      const p = this.tracker.plan(this.o.doc, id);
      if (!p) continue;
      const base = p.op === 'create' ? null : p.expected;
      changes[p.featureId] = { base, entity: p.op === 'delete' ? null : structuredClone(p.entity) };
    }
    const patch = this.sendsMeta() ? metaPatch(this.o.doc, this.metaBase) : null;
    if (!Object.keys(changes).length && !patch && !this.inflight) return null;
    return {
      userId: this.o.userId,
      changes,
      meta: patch ? { base: this.metaVersion, patch } : undefined,
      inflight: this.inflight?.envelope,
      updated: Date.now(),
    };
  }

  private async saveDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    try {
      const d = this.draft();
      if (d) await this.o.drafts.put(this.o.draftKey, d);
      else await this.o.drafts.delete(this.o.draftKey);
    } catch (e) {
      // The changes are still in memory and still being sent; the user must know a crash would lose them.
      this.error.set(`Değişiklikler bu cihaza yedeklenemedi (${(e as Error).message}); sekmeyi kapatmayın.`);
    }
  }

  // ── Sending ────────────────────────────────────────────────────────────

  /** Sends everything waiting now; true when the server has it all. */
  flush(): Promise<boolean> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this.run().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    });
    return this.flushing;
  }

  private async run(): Promise<boolean> {
    if (this.disposed || this.conflicts.value.length || this.o.canWrite === false) return false;
    const doc = this.o.doc;
    if (doc.busy) {
      this.schedule(200);
      return false;
    }
    clearTimeout(this.timer);
    if (this.inflight && !(await this.send(this.inflight))) return false;
    for (;;) {
      const planned: Planned[] = [];
      for (const id of [...this.dirty]) {
        const p = this.tracker.plan(doc, id);
        if (p) planned.push(p);
        else this.dirty.delete(id);
        if (planned.length >= BATCH) break;
      }
      const patch = this.sendsMeta() ? metaPatch(doc, this.metaBase) : null;
      if (!patch) this.metaDirty = this.metaDirty && !this.o.canEditMeta && metaPatch(doc, this.metaBase) !== null;
      if (!planned.length && !patch) break;
      const expectedVersions: Record<string, string> = {};
      for (const p of planned) if (p.op !== 'create') expectedVersions[p.featureId] = p.expected;
      if (patch) expectedVersions['@project'] = this.metaVersion;
      const envelope: CommandEnvelope = {
        commandName: 'project.changes',
        version: 1,
        tenantId: this.o.tenantId,
        projectId: this.o.projectId,
        requestId: `web-${uuid()}`,
        idempotencyKey: uuid(),
        expectedVersions,
        input: { features: planned.map(changeOf), ...(patch ? { project: patch } : {}) },
      };
      this.inflight = { envelope, planned, meta: patch ? metaParts(doc) : null, revision: doc.revision };
      // Kept on the device before it goes: after a crash the same key is sent again.
      await this.saveDraft();
      if (!(await this.send(this.inflight))) return false;
    }
    this.firstPending = 0;
    this.pending.set(0);
    this.state.set('saved');
    this.error.set('');
    if (!this.dirty.size && !this.sendsMeta()) doc.markSaved(doc.revision);
    await this.saveDraft();
    return true;
  }

  private async send(f: Inflight): Promise<boolean> {
    this.state.set('saving');
    this.own.add(f.envelope.requestId);
    try {
      const result = await this.o.api.command(f.envelope);
      for (const p of f.planned) {
        this.tracker.acknowledge(p, result.versions[p.featureId]);
        if (this.tracker.settled(this.o.doc, p)) this.dirty.delete(p.localId);
      }
      if (f.meta) {
        this.metaVersion = result.metaVersion;
        this.metaBase = f.meta;
        this.metaDirty = metaPatch(this.o.doc, this.metaBase) !== null;
      }
      this.inflight = null;
      this.retries = 0;
      this.lastSaved.set(Date.now());
      this.pending.set(this.dirty.size + (this.sendsMeta() ? 1 : 0));
      return true;
    } catch (e) {
      const failure = e instanceof ApiFailure ? e : new ApiFailure(0, {}, String(e));
      if (failure.code === 'conflict') {
        this.inflight = null;
        this.enterConflicts(failure.conflicts);
      } else if (failure.transient) {
        // Same command, same key, a little later (1 s … 30 s).
        this.state.set('offline_pending');
        this.retries++;
        this.schedule(Math.min(30_000, 1000 * 2 ** Math.min(this.retries - 1, 5)));
      } else {
        // The server refused it for good (a locked layer, a missing right): say why and wait for the next edit.
        this.inflight = null;
        this.state.set('error');
        this.error.set(failure.message);
        this.o.warn(`Bulut kaydı yapılamadı: ${failure.message}`);
      }
      await this.saveDraft();
      return false;
    }
  }

  // ── Conflicts ──────────────────────────────────────────────────────────

  private enterConflicts(list: readonly FeatureConflict[]): void {
    const mapped = list.map((c): SyncConflict => ({
      featureId: c.id,
      localId: c.id === '@project' ? null : (this.tracker.localOf(c.id) ?? null),
      reason: c.reason,
      server: c.current ?? null,
      actual: c.actual ?? null,
    }));
    this.addConflicts(mapped);
  }

  private addConflicts(list: readonly SyncConflict[]): void {
    const known = new Map(this.conflicts.value.map((c) => [c.featureId, c]));
    for (const c of list) known.set(c.featureId, c);
    this.conflicts.set([...known.values()]);
    clearTimeout(this.timer);
    this.state.set('conflict');
  }

  /** Ends the conflicts: take the server's copies, or keep mine and send them over the server's versions. */
  async resolve(choice: 'server' | 'mine'): Promise<void> {
    const list = this.conflicts.value;
    const doc = this.o.doc;
    if (choice === 'server') {
      const put: Entity[] = [];
      const remove: number[] = [];
      let meta: ExternalMeta | undefined;
      for (const c of list) {
        if (c.reason === 'project') {
          const m = await this.serverMeta();
          if (m) {
            meta = m.meta;
            this.metaVersion = m.version;
          }
          continue;
        }
        if (c.localId === null && !c.server) continue;
        const incoming = c.server ? this.checked([{ key: c.featureId, entity: c.server.entity }]).get(c.featureId) : undefined;
        if (c.server && incoming) {
          const id = c.localId ?? doc.allocateId();
          const e = { ...incoming, id } as Entity;
          put.push(e);
          this.tracker.set(id, { featureId: c.featureId, version: c.server.version, json: entityJson(e) });
          this.dirty.delete(id);
        } else if (!c.server && c.localId !== null) {
          remove.push(c.localId);
          this.tracker.set(c.localId, { featureId: c.featureId, version: null, json: null });
          this.dirty.delete(c.localId);
        }
      }
      await this.whenIdle();
      doc.applyExternal({ put, remove, meta });
      if (meta) {
        this.metaBase = metaParts(doc);
        this.metaDirty = false;
      }
    } else {
      for (const c of list) {
        if (c.reason === 'project') {
          this.metaVersion = c.actual ?? this.metaVersion;
          continue;
        }
        if (c.localId === null) continue;
        const t = this.tracker.get(c.localId);
        if (c.reason === 'exists') this.tracker.set(c.localId, { featureId: (this.o.newId ?? uuid)(), version: null, json: null });
        else if (t) this.tracker.set(c.localId, { featureId: t.featureId, version: c.actual, json: c.server ? entityJson({ ...c.server.entity, id: c.localId } as Entity) : null });
        this.dirty.add(c.localId);
      }
    }
    this.conflicts.set([]);
    this.state.set('pending');
    this.pending.set(this.dirty.size + (this.sendsMeta() ? 1 : 0));
    await this.saveDraft();
    await this.flush();
  }

  private whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => (this.o.doc.busy ? setTimeout(check, 100) : resolve());
      check();
    });
  }

  // ── Other editors ──────────────────────────────────────────────────────

  /** Applies committed events (from the socket, in order). Our own commits are skipped. */
  receive(events: readonly EventRecord[]): Promise<void> {
    this.remoteQueue = this.remoteQueue.then(() => this.apply(events)).catch((e) => {
      this.o.warn(`Başka kullanıcıların değişiklikleri alınamadı: ${(e as Error).message}`);
    });
    return this.remoteQueue;
  }

  private busyLocally(localId: number | undefined): boolean {
    if (localId === undefined) return false;
    return this.dirty.has(localId) || !!this.inflight?.planned.some((p) => p.localId === localId);
  }

  private async apply(events: readonly EventRecord[]): Promise<void> {
    if (!events.length) return;
    const last = events[events.length - 1].seq;
    const ops = new Map<string, 'create' | 'update' | 'delete'>();
    let meta = false;
    for (const e of events) {
      if (e.requestId && this.own.has(e.requestId)) continue;
      for (const f of e.features) ops.set(f.id, f.op);
      meta ||= e.meta;
    }
    const wanted = [...ops].filter(([, op]) => op !== 'delete').map(([id]) => id);
    const fetched = new Map<string, FeatureRecord>();
    for (let i = 0; i < wanted.length; i += BATCH) {
      const page = await this.o.api.featuresById(this.o.tenantId, this.o.projectId, wanted.slice(i, i + BATCH));
      for (const f of page.features) fetched.set(f.id, f);
    }
    // Metadata first: new objects may sit on a layer the new tree brings.
    let externalMeta: ExternalMeta | undefined;
    let metaConflict: SyncConflict | null = null;
    if (meta) {
      const m = await this.serverMeta();
      if (m && this.sendsMeta()) metaConflict = { featureId: '@project', localId: null, reason: 'project', server: null, actual: m.version };
      else if (m) {
        externalMeta = m.meta;
        this.metaVersion = m.version;
        await this.whenIdle();
        this.o.doc.applyExternal({ meta: externalMeta });
        this.metaBase = metaParts(this.o.doc);
      }
    }
    const good = this.checked([...fetched.values()].map((f) => ({ key: f.id, entity: f.entity })));
    const doc = this.o.doc;
    const put: Entity[] = [];
    const remove: number[] = [];
    const conflicts: SyncConflict[] = [];
    for (const [featureId] of ops) {
      const local = this.tracker.localOf(featureId);
      const record = fetched.get(featureId) ?? null;
      if (this.busyLocally(local)) {
        conflicts.push({ featureId, localId: local ?? null, reason: record ? 'remote' : 'deleted', server: record, actual: record?.version ?? null });
        continue;
      }
      if (record) {
        const incoming = good.get(featureId);
        if (!incoming) continue;
        const id = local ?? doc.allocateId();
        const e = { ...incoming, id } as Entity;
        put.push(e);
        this.tracker.set(id, { featureId, version: record.version, json: entityJson(e) });
      } else if (local !== undefined) {
        remove.push(local);
        this.tracker.set(local, { featureId, version: null, json: null });
      }
    }
    if (metaConflict) conflicts.push(metaConflict);
    await this.whenIdle();
    if (put.length || remove.length) doc.applyExternal({ put, remove });
    this.cursor = last;
    if (conflicts.length) this.addConflicts(conflicts);
  }

  // ── Reopening with a draft ─────────────────────────────────────────────

  /**
   * Puts a draft saved on this device back into the drawing. A change whose
   * base is still the server's version waits to be sent; one the server moved
   * past is a conflict (the drawing shows the local copy until resolved).
   * A command that was on its way is sent first, with its own key.
   */
  async restore(draft: Draft): Promise<void> {
    if (draft.userId !== this.o.userId) return;
    const doc = this.o.doc;
    // Changes the lost command carried; once it is answered they are the server's, not a draft's.
    const carried = new Map<string, string | null>();
    if (draft.inflight) {
      try {
        for (const f of (draft.inflight.input as { features?: { op: string; id: string; entity?: unknown }[] }).features ?? [])
          carried.set(f.id, f.op === 'delete' ? null : JSON.stringify(f.entity));
        await this.o.api.command(draft.inflight);
        this.own.add(draft.inflight.requestId);
        const ids = (draft.inflight.input as { features?: { id: string }[] }).features?.map((f) => f.id) ?? [];
        const fresh = ids.length ? await this.o.api.featuresById(this.o.tenantId, this.o.projectId, ids) : { features: [] };
        const byId = new Map(fresh.features.map((f) => [f.id, f]));
        const good = this.checked(fresh.features.map((f) => ({ key: f.id, entity: f.entity })));
        const put: Entity[] = [];
        const remove: number[] = [];
        for (const id of ids) {
          const local = this.tracker.localOf(id);
          const rec = byId.get(id);
          const incoming = good.get(id);
          if (rec && incoming) {
            const lid = local ?? doc.allocateId();
            const e = { ...incoming, id: lid } as Entity;
            put.push(e);
            this.tracker.set(lid, { featureId: id, version: rec.version, json: entityJson(e) });
          } else if (!rec && local !== undefined) {
            remove.push(local);
            this.tracker.set(local, { featureId: id, version: null, json: null });
          }
        }
        doc.applyExternal({ put, remove });
      } catch (e) {
        if (!(e instanceof ApiFailure) || e.transient) {
          // Still no answer: keep the whole draft for the next attempt.
          this.inflight = null;
          await this.o.drafts.put(this.o.draftKey, draft);
          this.state.set('offline_pending');
          return;
        }
        // Refused for good (a conflict or a rule): its changes stay in the draft and are checked below.
        carried.clear();
      }
    }
    const put: Entity[] = [];
    const remove: number[] = [];
    const conflicts: SyncConflict[] = [];
    const touched: number[] = [];
    const moved: string[] = [];
    for (const [featureId, change] of Object.entries(draft.changes)) {
      if (carried.has(featureId) && carried.get(featureId) === (change.entity ? JSON.stringify(change.entity) : null)) continue;
      const local = this.tracker.localOf(featureId);
      const serverVersion = local === undefined ? null : (this.tracker.get(local)?.version ?? null);
      const lid = local ?? doc.allocateId();
      if (local === undefined) this.tracker.set(lid, { featureId, version: null, json: null });
      if (change.entity) put.push({ ...(change.entity as Entity), id: lid });
      else if (local !== undefined) remove.push(lid);
      touched.push(lid);
      if (change.base !== serverVersion) moved.push(featureId);
    }
    if (moved.length) {
      const fresh = await this.o.api.featuresById(this.o.tenantId, this.o.projectId, moved);
      const byId = new Map(fresh.features.map((f) => [f.id, f]));
      for (const id of moved) {
        const rec = byId.get(id) ?? null;
        conflicts.push({ featureId: id, localId: this.tracker.localOf(id) ?? null, reason: rec ? 'changed' : 'deleted', server: rec, actual: rec?.version ?? null });
      }
    }
    let meta: ExternalMeta | undefined;
    if (draft.meta && this.o.canEditMeta) {
      const p: ProjectPatch = draft.meta.patch;
      const cur = metaParts(doc);
      const read = readIncoming(
        {
          name: p.name ?? doc.name.value,
          settings: p.settings ?? doc.settings.toJSON(),
          origin: doc.origin,
          layers: p.layers ?? JSON.parse(cur.layers),
          activeLayer: p.activeLayer ?? doc.layers.active.value,
          styles: p.styles ?? doc.styles.value,
        },
        [],
      );
      if (read.ok) {
        const c = read.content;
        meta = { name: c.name, settings: c.settings, layers: c.layers, activeLayer: c.activeLayer, styles: c.styles };
        if (draft.meta.base !== this.metaVersion) conflicts.push({ featureId: '@project', localId: null, reason: 'project', server: null, actual: this.metaVersion });
      } else this.o.warn(`Cihazdaki proje bilgisi taslağı okunamadı: ${read.error}`);
    }
    // The draft is local work: it goes in without history, then counts as unsent.
    if (meta) doc.applyExternal({ meta });
    const good = this.checked(put.map((e) => ({ key: String(e.id), entity: e })));
    const checkedPut = put.filter((e) => good.has(String(e.id))).map((e) => ({ ...good.get(String(e.id))!, id: e.id }) as Entity);
    doc.applyExternal({ put: checkedPut, remove });
    for (const id of touched) this.dirty.add(id);
    if (meta) this.metaDirty = true;
    if (touched.length || meta) {
      doc.markUnsaved();
      this.changed();
    }
    if (conflicts.length) this.addConflicts(conflicts);
  }
}
