import type { AppContext } from '../../app/context';
import { DisposableStore } from '../../core/disposable';
import type { Vec2 } from '../../model/geometry';
import { defaultValues, isVisible, restoreValues, type ValidationIssue } from '../../processing/parameters';
import type { InputSummary, RunOutcome } from '../../processing/runner';
import type { ExecutionTarget, ParamDef, ProcessingTool } from '../../processing/types';
import { PickPointTool } from '../../tools/pickPointTool';
import { h, replaceChildren, type Child } from '../dom';
import { icon } from '../icons';
import { Dialog } from '../widgets/Dialog';
import { paramControl, type FieldEnv } from './paramFields';

/**
 * The dialog of one processing tool, generated from its definition: the
 * form on the left (Girdi, Ayarlar, Çıktı, Gelişmiş), what the tool does
 * and a live preview on the right, run status in the footer. It stays open
 * after a run so the user can adjust and run again, like QGIS.
 */

export const TARGET_LABEL: Record<ExecutionTarget, string> = {
  client: 'Bu tarayıcıda',
  worker: 'Arka planda (worker)',
  server: 'KentOS sunucusunda',
  postgis: 'PostGIS veritabanında',
};

export function openToolDialog(ctx: AppContext, toolId: string, values?: Record<string, unknown>): void {
  const tool = ctx.processing.registry.get(toolId);
  if (!tool) {
    ctx.log.error(`İşlem aracı bulunamadı: ${toolId}`);
    return;
  }
  new ToolDialog(ctx, tool, values);
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; fraction: number; label: string }
  /** `pick`: objects "Sonuçları seç" selects; `selected`: the run set the selection itself; `undo`: it edited the drawing. */
  | { kind: 'ok'; text: string; pick: readonly number[]; selected: boolean; undo: boolean }
  | { kind: 'error' | 'invalid'; text: string };

class ToolDialog {
  private readonly ctx: AppContext;
  private readonly tool: ProcessingTool;
  private values: Record<string, unknown>;
  private readonly touched = new Set<string>();
  /** After a run attempt every problem shows, not only the ones in fields the user touched. */
  private attempted = false;
  private advancedOpen = false;
  private issues: ValidationIssue[] = [];
  private inputs: Record<string, InputSummary> = {};
  private status: Status = { kind: 'idle' };

  private readonly d = new DisposableStore();
  private readonly dialog: Dialog;
  private readonly form = h('div', { class: 'ptool__form' });
  private readonly preview = h('div', { class: 'ptool__preview-value num' });
  private readonly statusEl = h('div', { class: 'ptool__status', role: 'status', 'aria-live': 'polite' });
  private readonly runBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;

  constructor(ctx: AppContext, tool: ProcessingTool, values?: Record<string, unknown>) {
    this.ctx = ctx;
    this.tool = tool;
    const runner = ctx.processing.runner;
    this.values = restoreValues(tool, values ?? ctx.processing.lastValues(tool.id), runner.defaults());
    this.advancedOpen = tool.parameters.some((p) => p.advanced && values && p.name in values && JSON.stringify(values[p.name]) !== JSON.stringify(defaultValues(tool, runner.defaults())[p.name]));

    const reset = h('button', { class: 'btn btn--ghost', type: 'button', title: 'Bütün alanları varsayılan değerlerine döndürür' }, 'Varsayılanlar');
    this.closeBtn = h('button', { class: 'btn', type: 'button' }, 'Kapat');
    this.runBtn = h('button', { class: 'btn btn--primary ptool__run', type: 'button' }, icon('play', 14), 'Çalıştır');
    reset.addEventListener('click', () => {
      this.values = defaultValues(tool, runner.defaults());
      this.touched.clear();
      this.attempted = false;
      this.status = { kind: 'idle' };
      this.render();
    });
    this.closeBtn.addEventListener('click', () => (this.status.kind === 'running' ? runner.cancel() : this.dialog.close()));
    this.runBtn.addEventListener('click', () => void this.run());

    this.dialog = new Dialog({
      title: tool.label,
      width: 940,
      className: 'dialog--ptool',
      content: [h('div', { class: 'ptool' }, h('div', { class: 'ptool__main' }, this.form), this.side())],
      footer: [reset, this.statusEl, this.closeBtn, this.runBtn],
      onClose: () => this.d.dispose(),
    });
    // Enter in a text field runs the tool; Ctrl+Enter runs from anywhere.
    this.form.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && (e.ctrlKey || (t.tagName === 'INPUT' && !e.shiftKey))) {
        e.preventDefault();
        void this.run();
      }
    });
    this.d.add(
      runner.running.subscribe((r) => {
        if (!r || r.toolId !== tool.id || this.status.kind !== 'running') return;
        this.status = { kind: 'running', fraction: r.fraction, label: r.label };
        this.renderStatus();
      }),
    );
    this.render();
    // Start where the user most likely acts: the first text or number field.
    queueMicrotask(() => this.form.querySelector<HTMLElement>('input, .seg [aria-checked="true"]')?.focus());
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private render(): void {
    const runner = this.ctx.processing.runner;
    this.issues = runner.validate(this.tool, this.values);
    this.inputs = runner.describeInputs(this.tool, this.values);

    // Keep keyboard focus on the same control across the rebuild.
    const active = document.activeElement as HTMLElement | null;
    const row = active && this.form.contains(active) ? active.closest<HTMLElement>('[data-param]') : null;
    const focusName = row?.dataset.param;
    const focusIndex = row ? focusables(row).indexOf(active!) : -1;

    const shown = this.tool.parameters.filter((p) => isVisible(p, this.values));
    const input = shown.filter((p) => !p.advanced && p.type === 'features');
    const output = shown.filter((p) => !p.advanced && p.type === 'layer');
    const main = shown.filter((p) => !p.advanced && p.type !== 'features' && p.type !== 'layer');
    const advanced = shown.filter((p) => p.advanced);
    const advancedIssue = advanced.some((p) => this.issueOf(p.name));

    const toggle = h(
      'button',
      { class: 'pgroup__toggle', type: 'button', 'aria-expanded': String(this.advancedOpen || advancedIssue) },
      icon(this.advancedOpen || advancedIssue ? 'chevronDown' : 'chevronRight', 14),
      'Gelişmiş ayarlar',
      h('span', { class: 'pgroup__count' }, String(advanced.length)),
    );
    toggle.addEventListener('click', () => {
      this.advancedOpen = !this.advancedOpen;
      this.render();
    });

    replaceChildren(
      this.form,
      input.length ? this.group('Girdi', input) : null,
      main.length ? this.group('Ayarlar', main) : null,
      output.length ? this.group('Çıktı', output) : null,
      advanced.length ? h('section', { class: 'pgroup pgroup--advanced' }, toggle, this.advancedOpen || advancedIssue ? h('div', { class: 'pgroup__rows' }, advanced.map((p) => this.row(p))) : null) : null,
    );

    if (focusName) {
      const again = this.form.querySelector<HTMLElement>(`[data-param="${CSS.escape(focusName)}"]`);
      const list = again ? focusables(again) : [];
      (list[Math.max(0, Math.min(focusIndex, list.length - 1))] as HTMLElement | undefined)?.focus();
    }
    this.renderPreview();
    this.renderStatus();
  }

  private group(title: string, params: ParamDef[]): HTMLElement {
    return h('section', { class: 'pgroup' }, h('div', { class: 'pgroup__title' }, title), h('div', { class: 'pgroup__rows' }, params.map((p) => this.row(p))));
  }

  private row(def: ParamDef): HTMLElement {
    const env: FieldEnv = {
      ctx: this.ctx,
      describe: (name) => this.inputs[name],
      previewExpression: (name) => this.ctx.processing.runner.previewExpression(this.tool, this.values, name),
      pickPoint: (name) => this.pickPoint(name),
    };
    const control = paramControl(def, this.values[def.name], (v, rebuild) => this.set(def.name, v, rebuild), env);
    const stacked = def.type === 'features' || def.type === 'expression';
    return h(
      'div',
      { class: `prow${stacked ? ' prow--stacked' : ''}`, 'data-param': def.name },
      h(
        'div',
        { class: 'prow__text' },
        h('div', { class: 'prow__label' }, def.label, def.optional ? h('span', { class: 'prow__opt' }, 'isteğe bağlı') : null),
        def.description ? h('div', { class: 'prow__desc' }, def.description) : null,
      ),
      h('div', { class: 'prow__control' }, control, h('div', { class: 'prow__issue', role: 'alert' })),
    );
  }

  /** Issue shown under a field: live for touched fields, all of them after a run attempt. */
  private issueOf(name: string): ValidationIssue | undefined {
    if (!this.attempted && !this.touched.has(name)) return undefined;
    return this.issues.find((i) => i.param === name);
  }

  private renderIssues(): void {
    for (const row of this.form.querySelectorAll<HTMLElement>('[data-param]')) {
      const issue = this.issueOf(row.dataset.param!);
      row.toggleAttribute('data-invalid', !!issue);
      const slot = row.querySelector('.prow__issue')!;
      if (issue) replaceChildren(slot, icon('error', 14), h('span', null, issue.message));
      else slot.replaceChildren();
    }
  }

  private renderPreview(): void {
    const valid = !this.issues.some((i) => i.param);
    const text = valid ? this.tool.preview?.(this.values as never) : null;
    this.preview.textContent = text ?? (valid ? '' : 'Önizleme için alanları düzeltin.');
    this.preview.toggleAttribute('data-muted', !text);
    this.renderIssues();
  }

  private renderStatus(): void {
    const s = this.status;
    const running = s.kind === 'running';
    this.runBtn.disabled = running;
    replaceChildren(this.runBtn, icon('play', 14), running ? 'Çalışıyor…' : 'Çalıştır');
    this.closeBtn.textContent = running ? 'Durdur' : 'Kapat';
    const toolIssue = this.attempted ? this.issues.find((i) => !i.param) : undefined;
    const fieldIssues = this.attempted ? this.issues.filter((i) => i.param).length : 0;
    let content: Child[] = [];
    if (running) {
      content = [h('div', { class: 'ptool__progress' }, h('span', { style: `width:${Math.round(s.fraction * 100)}%` })), h('span', { class: 'ptool__status-text' }, s.label || 'Çalışıyor…')];
    } else if (s.kind === 'ok') {
      // A selection result is already applied: offer to look at it; otherwise to select what changed.
      const show = s.selected || s.pick.length ? h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, s.selected ? 'Seçime yakınlaştır' : 'Sonuçları seç') : null;
      show?.addEventListener('click', () => {
        if (!s.selected) this.ctx.selection.set(s.pick);
        this.dialog.close();
        if (this.ctx.selection.size) this.ctx.view.zoomToSelection();
      });
      const undo = s.undo ? h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Geri al') : null;
      undo?.addEventListener('click', () => {
        this.ctx.commands.execute('edit.undo');
        this.status = { kind: 'idle' };
        this.render();
      });
      content = [icon('success', 16), h('span', { class: 'ptool__status-text', title: s.text }, s.text), show, undo];
    } else if (fieldIssues || toolIssue || s.kind === 'invalid') {
      const text = toolIssue?.message ?? (fieldIssues ? `Çalıştırmadan önce ${fieldIssues} alanı düzeltin.` : s.kind === 'invalid' ? s.text : '');
      content = [icon('warning', 16), h('span', { class: 'ptool__status-text', title: text }, text)];
    } else if (s.kind === 'error') {
      content = [icon('error', 16), h('span', { class: 'ptool__status-text', title: s.text }, s.text)];
    }
    this.statusEl.dataset.kind = running ? 'running' : s.kind === 'ok' ? 'ok' : content.length ? (s.kind === 'error' ? 'error' : 'warn') : 'idle';
    replaceChildren(this.statusEl, content);
  }

  private side(): HTMLElement {
    const { registry, runner } = this.ctx.processing;
    const cat = registry.category(this.tool.category);
    const chosen = runner.executorFor(this.tool)?.target;
    const help = (this.tool.help ?? '').split(/\n\s*\n/).filter(Boolean);
    return h(
      'aside',
      { class: 'ptool__side' },
      h('div', { class: 'ptool__crumb' }, icon(cat?.icon ?? 'processing', 14), registry.categoryPath(this.tool.category)),
      h('div', { class: 'ptool__heading' }, h('span', { class: 'ptool__icon' }, icon(this.tool.icon ?? 'processing', 20)), h('p', { class: 'ptool__about' }, this.tool.description)),
      help.map((p) => h('p', { class: 'ptool__help' }, p)),
      this.tool.preview ? h('div', { class: 'ptool__preview' }, h('div', { class: 'ptool__side-title' }, 'Önizleme'), this.preview) : null,
      h(
        'div',
        { class: 'ptool__facts' },
        h('div', { class: 'ptool__side-title' }, 'Nerede çalışır'),
        h(
          'ul',
          { class: 'ptool__targets' },
          this.tool.targets.map((t) =>
            h(
              'li',
              { 'data-state': t === chosen ? 'active' : 'planned' },
              h('span', { class: 'ptool__dot' }),
              TARGET_LABEL[t],
              h('span', { class: 'ptool__target-note' }, t === chosen ? 'bu çalıştırmada' : t === 'client' ? '' : 'yakında'),
            ),
          ),
        ),
        this.tool.aliases?.length ? h('div', { class: 'ptool__side-title' }, 'Komut satırından') : null,
        this.tool.aliases?.length ? h('div', { class: 'ptool__aliases' }, this.tool.aliases.map((a) => h('code', null, a))) : null,
      ),
    );
  }

  // ── Editing and running ──────────────────────────────────────────────

  private set(name: string, value: unknown, rebuild = true): void {
    this.values = { ...this.values, [name]: value };
    this.touched.add(name);
    if (this.status.kind === 'ok' || this.status.kind === 'error' || this.status.kind === 'invalid') this.status = { kind: 'idle' };
    if (rebuild) {
      this.render();
      return;
    }
    // Typing: keep the field, refresh only what depends on it.
    this.issues = this.ctx.processing.runner.validate(this.tool, this.values);
    this.renderPreview();
    this.renderStatus();
  }

  /** Hides the dialog while the user shows a point, then opens it again with the point filled in. */
  private pickPoint(name: string): void {
    const def = this.tool.parameters.find((p) => p.name === name)!;
    const values = this.values;
    const reopen = (p: Vec2 | null) => queueMicrotask(() => openToolDialog(this.ctx, this.tool.id, p ? { ...values, [name]: p } : values));
    this.dialog.close();
    this.ctx.tools.run(new PickPointTool(this.ctx, def.label, reopen), `${this.tool.label}: ${def.label}`);
  }

  private async run(): Promise<void> {
    if (this.status.kind === 'running') return;
    const { runner } = this.ctx.processing;
    this.attempted = true;
    this.issues = runner.validate(this.tool, this.values);
    if (this.issues.length) {
      this.advancedOpen ||= this.issues.some((i) => this.tool.parameters.find((p) => p.name === i.param)?.advanced);
      this.render();
      this.focusFirstIssue();
      return;
    }
    this.ctx.processing.remember(this.tool.id, this.values);
    this.status = { kind: 'running', fraction: 0, label: '' };
    this.renderStatus();
    const log = (level: 'info' | 'warn', m: string) => (level === 'warn' ? this.ctx.log.warn(m) : this.ctx.log.info(m));
    const out: RunOutcome = await runner.run(this.tool, this.values, log);
    switch (out.status) {
      case 'ok': {
        const ch = out.result.changes;
        const edited = out.added.length > 0 || !!ch?.update?.length || !!ch?.remove?.length;
        this.status = { kind: 'ok', text: out.record.summary, pick: out.added.length ? out.added : out.touched, selected: !!out.result.select, undo: edited };
        this.ctx.log.success(`${this.tool.label}: ${out.record.summary}`);
        this.attempted = false;
        break;
      }
      case 'invalid':
        this.issues = out.issues;
        this.status = { kind: 'invalid', text: out.issues[0]?.message ?? '' };
        break;
      default:
        this.status = { kind: 'error', text: out.message };
        this.ctx.log.warn(out.message);
    }
    this.ctx.view.requestRender();
    if (out.status === 'invalid') {
      // Stopped before running (e.g. nothing selected): show it on the field.
      this.renderIssues();
      this.renderStatus();
      this.focusFirstIssue();
      return;
    }
    this.render();
    this.runBtn.focus();
  }

  private focusFirstIssue(): void {
    const row = this.form.querySelector<HTMLElement>('[data-invalid]');
    row?.scrollIntoView({ block: 'nearest' });
    (row ? focusables(row)[0] : null)?.focus();
  }
}

const focusables = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex="0"]')];
