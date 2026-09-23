import type { CommandRegistry } from '../core/commands';
import type { Keymap } from '../core/keymap';
import type { CadDocument } from '../model/document';
import type { Selection } from '../model/selection';
import type { ToolManager } from '../tools/ToolManager';
import type { ViewportController } from '../viewport/ViewportController';
import type { Clipboard } from './clipboard';
import type { Formatter } from './format';
import type { ProcessingService } from './processing';
import type { DraftingSettings, MessageLog, Preferences, UiState } from './state';

/**
 * The single dependency every feature module receives. Modules talk to each
 * other only through these services — never by importing each other's UI.
 */
export interface AppContext {
  readonly commands: CommandRegistry;
  readonly keymap: Keymap;
  readonly doc: CadDocument;
  readonly selection: Selection;
  readonly settings: DraftingSettings;
  readonly log: MessageLog;
  readonly ui: UiState;
  /** Persisted user preferences (Ayarlar). */
  readonly prefs: Preferences;
  /** Units/precision-aware number formatting. */
  readonly format: Formatter;
  readonly tools: ToolManager;
  readonly view: ViewportController;
  /** Copied entities (session only). */
  readonly clipboard: Clipboard;
  /** İşlem araçları: registry, runner, last values (see docs/PROCESSING.md). */
  readonly processing: ProcessingService;
}
