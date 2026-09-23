import type { Command } from '../core/commands';
import type { CadDocument } from '../model/document';
import type { Bounds } from '../model/geometry';
import type { Selection } from '../model/selection';
import { BUILTIN_TOOLS } from '../processing/builtin';
import { ProcessingRegistry } from '../processing/registry';
import { ProcessingRunner } from '../processing/runner';
import type { AppContext } from './context';
import { persistedSignals } from './state';

/**
 * İşlem araçları in the app: the registry with the built-in tools, the
 * runner bound to this document, and each tool's last values (a user
 * preference kept in this browser, `kentos.processing.v1`).
 */
export interface ProcessingService {
  readonly registry: ProcessingRegistry;
  readonly runner: ProcessingRunner;
  /** Values of the tool's last run in this browser, if any. */
  lastValues(toolId: string): Record<string, unknown> | undefined;
  remember(toolId: string, values: Record<string, unknown>): void;
}

interface ProcessingMemory {
  lastValues: Record<string, Record<string, unknown>>;
}

export function createProcessing(doc: CadDocument, selection: Selection, visibleBounds: () => Bounds | null): ProcessingService {
  const registry = new ProcessingRegistry();
  for (const t of BUILTIN_TOOLS) registry.register(t);
  const runner = new ProcessingRunner({ doc, selectedIds: () => [...selection.ids.value], visibleBounds });
  const memory = persistedSignals<ProcessingMemory>('kentos.processing.v1', { lastValues: {} });
  return {
    registry,
    runner,
    lastValues: (id) => memory.lastValues.value[id],
    remember: (id, values) => memory.lastValues.set({ ...memory.lastValues.value, [id]: JSON.parse(JSON.stringify(values)) }),
  };
}

export const processingCommandId = (toolId: string) => `processing.run.${toolId}`;

/** One command per tool (menus, command line) plus the toolbox and history. */
export function registerProcessingCommands(ctx: AppContext, hooks: { open(toolId: string, values?: Record<string, unknown>): void; show(tab: 'tools' | 'history'): void }): void {
  const cat = 'İşlemler';
  const list: Command[] = [
    { id: 'processing.toolbox', title: 'İşlem araç kutusu', category: cat, icon: 'processing', aliases: ['ISLEMLER', 'PROCESSING'], description: 'Toplu işlem araçlarını sağ panelde listeler.', run: () => hooks.show('tools') },
    // Harita menüsündeki eski komut, aynı işi yapan işlem aracını açar.
    { id: 'map.edgeLengths', title: 'Kenar ölçülerini yaz…', category: 'Harita', icon: 'dimension', aliases: ['KENAR', 'KENAROLCU'], description: 'Parsel ve çizgilerin kenar uzunluklarını yazar (işlem aracı).', run: () => hooks.open('annotation.edgeLengths') },
    { id: 'processing.history', title: 'İşlem geçmişi', category: cat, icon: 'history', description: 'Bu oturumda çalıştırılan işlemler; yeniden çalıştırılabilir.', run: () => hooks.show('history') },
    ...ctx.processing.registry.list().map(
      (t): Command => ({
        id: processingCommandId(t.id),
        title: `${t.label}…`,
        category: cat,
        icon: t.icon,
        description: t.description,
        aliases: t.aliases ? [...t.aliases] : undefined,
        run: () => hooks.open(t.id),
      }),
    ),
  ];
  for (const c of list) ctx.commands.register(c);
}
