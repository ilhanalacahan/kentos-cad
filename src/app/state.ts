import { Signal } from '../core/signal';
import type { LineType } from '../model/layers';

/** Drafting aids toggled from the status bar (F3/F7/F8/F10). */
export class DraftingSettings {
  readonly snap = new Signal(true);
  readonly grid = new Signal(true);
  readonly ortho = new Signal(false);
  readonly polar = new Signal(false);
  /** Current properties for new entities; null = katmana göre. */
  readonly color = new Signal<string | null>(null);
  readonly lineType = new Signal<LineType | null>(null);
  readonly lineWeight = new Signal<number | null>(null);
}

export type LogLevel = 'command' | 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  text: string;
}

export class MessageLog {
  readonly entries = new Signal<readonly LogEntry[]>([]);
  private seq = 0;

  push(level: LogLevel, text: string): void {
    const next = [...this.entries.value, { id: ++this.seq, time: new Date(), level, text }];
    this.entries.set(next.length > 500 ? next.slice(-500) : next);
  }

  command = (t: string) => this.push('command', t);
  info = (t: string) => this.push('info', t);
  success = (t: string) => this.push('success', t);
  warn = (t: string) => this.push('warn', t);
  error = (t: string) => this.push('error', t);

  clear(): void {
    this.entries.set([]);
  }
}

export type Theme = 'dark' | 'light';
export type BottomTab = 'history' | 'coords' | 'messages';

export interface UiLayoutData {
  theme: Theme;
  rightVisible: boolean;
  dockWidth: number;
  /** Share of the right dock height given to the layer tree. */
  layersFraction: number;
  bottomExpanded: boolean;
  bottomHeight: number;
  bottomTab: BottomTab;
  toolboxVisible: boolean;
  toolboxDocked: boolean;
  toolboxX: number;
  toolboxY: number;
  toolboxColumns: 1 | 2;
}

const DEFAULTS: UiLayoutData = {
  theme: 'dark',
  rightVisible: true,
  dockWidth: 312,
  layersFraction: 0.5,
  bottomExpanded: false,
  bottomHeight: 190,
  bottomTab: 'history',
  toolboxVisible: true,
  toolboxDocked: false,
  toolboxX: 12,
  toolboxY: 12,
  toolboxColumns: 2,
};

export type Signals<T> = { readonly [K in keyof T]: Signal<T[K]> };

/**
 * One signal per field, persisted to localStorage under `key`. Storage may be
 * unavailable (private mode) or hold stale fields; unknown keys are dropped
 * and missing ones fall back to defaults.
 */
export function persistedSignals<T extends object>(key: string, defaults: T): Signals<T> {
  let saved: Partial<T> = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    /* ignore */
  }
  const state = Object.fromEntries(
    Object.entries(defaults).map(([k, v]) => [k, new Signal(k in saved ? (saved as Record<string, unknown>)[k] : v)]),
  ) as unknown as Signals<T>;
  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const snapshot = Object.fromEntries(Object.entries(state).map(([k, s]) => [k, (s as Signal<unknown>).value]));
      try {
        localStorage.setItem(key, JSON.stringify(snapshot));
      } catch {
        /* ignore */
      }
    }, 250);
  };
  for (const s of Object.values(state)) (s as Signal<unknown>).subscribe(save);
  return state;
}

/** Workspace layout (panel sizes, toolbox position, theme). */
export const createUiState = () => persistedSignals<UiLayoutData>('kentos.ui.v1', DEFAULTS);
export type UiState = Signals<UiLayoutData>;

// ── Application preferences (Uygulama ayarları) ──────────────────────
// User-scoped, stored in this browser, valid for every project. Anything a
// colleague opening the same project must also see belongs in
// model/projectSettings.ts instead.

export type UiScale = 'standard' | 'large' | 'xlarge';
export type CrosshairSize = 'small' | 'medium' | 'full';

export interface PreferencesData {
  /** EPSG code used for new projects. TUREF / TM36 by default. */
  defaultSrid: number;
  /** Object snap and pick apertures in CSS px. */
  snapAperture: number;
  pickAperture: number;
  snapEndpoint: boolean;
  snapMidpoint: boolean;
  snapCenter: boolean;
  snapNode: boolean;
  snapIntersection: boolean;
  snapPerpendicular: boolean;
  snapNearest: boolean;
  snapTangent: boolean;
  /** Polar tracking step in degrees (F10 toggles tracking). */
  polarIncrement: number;
  crosshair: CrosshairSize;
  uiScale: UiScale;
  rendererPreference: 'webgl2' | 'webgpu';
  /** Render at device pixel ratio; off trades sharpness for fill rate. */
  hiDpi: boolean;
}

export const PREFERENCE_DEFAULTS: PreferencesData = {
  defaultSrid: 5256,
  snapAperture: 11,
  pickAperture: 5,
  snapEndpoint: true,
  snapMidpoint: true,
  snapCenter: true,
  snapNode: true,
  snapIntersection: true,
  snapPerpendicular: true,
  snapNearest: false,
  snapTangent: true,
  polarIncrement: 45,
  crosshair: 'medium',
  uiScale: 'standard',
  rendererPreference: 'webgl2',
  hiDpi: true,
};

export const createPreferences = () => persistedSignals<PreferencesData>('kentos.prefs.v1', PREFERENCE_DEFAULTS);
export type Preferences = Signals<PreferencesData>;

/** Plain snapshot, used by the settings dialog as an editable draft. */
export function snapshot<T extends object>(s: Signals<T>): T {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, (v as Signal<unknown>).value])) as T;
}
