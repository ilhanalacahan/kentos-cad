import { CommandRegistry } from '../core/commands';
import { Keymap } from '../core/keymap';
import { createSampleProject } from '../model/sampleProject';
import { Selection } from '../model/selection';
import { TOOL_CATALOG } from '../tools/catalog';
import { ToolManager } from '../tools/ToolManager';
import { openAboutDialog, openShortcutsDialog } from '../ui/dialogs';
import { openAppSettings, type AppSettingsSection } from '../ui/settings/AppSettingsDialog';
import { openProjectSettings, type ProjectSettingsSection } from '../ui/settings/ProjectSettingsDialog';
import { AppShell } from '../ui/shell/AppShell';
import { ViewportController } from '../viewport/ViewportController';
import { Clipboard } from './clipboard';
import { registerCoreCommands } from './commands';
import type { AppContext } from './context';
import { registerDefaultKeybindings } from './keybindings';
import { Formatter } from './format';
import { applyUiScale } from './commands';
import { createPreferences, createUiState, DraftingSettings, MessageLog } from './state';

/**
 * Composition root: builds services, wires them into one AppContext and
 * mounts the shell. Nothing else in the app constructs services.
 */
export async function createApp(root: HTMLElement): Promise<AppContext> {
  const commands = new CommandRegistry();
  const keymap = new Keymap(commands);
  const ui = createUiState();
  const prefs = createPreferences();
  const doc = createSampleProject(prefs.defaultSrid.value);
  // Theme and type scale before any service reads CSS tokens (canvas palette).
  document.documentElement.dataset.theme = ui.theme.value;
  applyUiScale(prefs.uiScale.value);

  // Services that need the context are attached right after it exists.
  const ctx = {
    commands,
    keymap,
    doc,
    selection: new Selection(),
    settings: new DraftingSettings(),
    log: new MessageLog(),
    ui,
    prefs,
    format: new Formatter(doc.settings),
    clipboard: new Clipboard(),
  } as AppContext & { tools: ToolManager; view: ViewportController };
  ctx.tools = new ToolManager(ctx);
  ctx.view = new ViewportController(ctx);
  TOOL_CATALOG.forEach((d) => ctx.tools.register(d));

  let shell: AppShell | null = null;
  registerCoreCommands(ctx, {
    openShortcuts: () => openShortcutsDialog(ctx),
    openAbout: () => openAboutDialog(ctx),
    openAppSettings: (section) => openAppSettings(ctx, section as AppSettingsSection | undefined),
    openProjectSettings: (section) => openProjectSettings(ctx, section as ProjectSettingsSection | undefined),
    focusCommandLine: () => shell?.bottom.commandLine.focus(),
  });
  registerDefaultKeybindings(ctx);
  commands.events.on('missing', ({ id }) => ctx.log.error(`Komut bulunamadı: ${id}`));

  shell = new AppShell(ctx);
  root.replaceChildren(shell.el);
  keymap.attach(window);

  ctx.tools.activate('select');
  await ctx.view.mount(shell.viewportHost);

  // Drop selection entries whose entities disappeared (undo, erase).
  doc.events.on('changed', () => ctx.selection.retain((id) => !!doc.get(id)));

  ctx.log.info(`${doc.name.value} açıldı: ${doc.size} nesne, ${doc.layers.leaves().length} katman.`);
  return ctx;
}
