import type { AppContext } from '../../app/context';
import { ENTITY_KIND_LABEL } from '../../model/entities';
import type { Vec2 } from '../../model/geometry';
import { scopesOf } from '../../processing/parameters';
import type { InputSummary } from '../../processing/runner';
import type { FeaturesValue, LayerValue, ParamDef } from '../../processing/types';
import { h } from '../dom';
import { icon } from '../icons';
import { colorSwatch } from '../layers/swatch';
import { segmented, textField, toggleSwitch } from '../widgets/controls';
import { Dropdown } from '../widgets/Dropdown';
import type { MenuItem } from '../widgets/PopupMenu';

/**
 * One control per parameter type, generated from the definition. Typing
 * updates the value without rebuilding the form (focus stays); choices
 * that can show or hide other parameters ask for a rebuild.
 */

export interface FieldEnv {
  readonly ctx: AppContext;
  /** What a features parameter resolves to now ("12 kapalı alan; seçili nesneler"). */
  describe(name: string): InputSummary | undefined;
  /** Hides the dialog and asks for a point on the drawing. */
  pickPoint(name: string): void;
}

/** `set(value, rebuild)`: rebuild the form when the change can alter which parameters show. */
export type Setter = (value: unknown, rebuild?: boolean) => void;

const SCOPE_SHORT = { selection: 'Seçili', visible: 'Görünen', all: 'Tümü', layer: 'Katman' } as const;

export function paramControl(def: ParamDef, value: unknown, set: Setter, env: FieldEnv): HTMLElement {
  switch (def.type) {
    case 'features':
      return featuresField(def, value as FeaturesValue, set, env);
    case 'number':
      return numberField(def, value as number, set);
    case 'string': {
      const input = textField({ label: def.label, value: String(value ?? ''), placeholder: def.placeholder, onChange: (v) => set(v, false) });
      if (def.maxLength) input.maxLength = def.maxLength;
      input.classList.add('pfield__text');
      if (def.maxLength && def.maxLength <= 2) input.classList.add('pfield__text--short');
      return input;
    }
    case 'boolean':
      return toggleSwitch({ label: def.label, checked: !!value, onChange: (v) => set(v, true) });
    case 'enum': {
      const short = def.options.length <= 3 && def.options.every((o) => o.label.length <= 22);
      if (short) return segmented({ label: def.label, options: def.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })), value: String(value), onChange: (v) => set(v, true) });
      const dd = new Dropdown({
        ariaLabel: def.label,
        className: 'pfield__dropdown',
        items: () => def.options.map((o): MenuItem => ({ label: o.label, hint: o.hint, radio: true, checked: o.value === value, run: () => set(o.value, true) })),
      });
      dd.set(h('span', { class: 'dropdown__text' }, def.options.find((o) => o.value === value)?.label ?? ''));
      return dd.el;
    }
    case 'layer':
      return layerField(def, value as LayerValue, set, env);
    case 'point':
      return pointField(def, value as Vec2 | null, env);
  }
}

function numberField(def: Extract<ParamDef, { type: 'number' }>, value: number, set: Setter): HTMLElement {
  const input = h('input', { class: 'field pfield__num num', value: Number.isFinite(value) ? String(value) : '', inputmode: 'decimal', 'aria-label': def.label, spellcheck: 'false' });
  input.addEventListener('input', () => {
    const n = Number(input.value.replace(',', '.'));
    const ok = input.value.trim() !== '' && Number.isFinite(n);
    input.toggleAttribute('data-invalid', !ok);
    set(ok ? n : NaN, false);
  });
  return h('div', { class: 'pfield__numwrap' }, input, def.unit ? h('span', { class: 'pfield__unit' }, def.unit) : null);
}

function featuresField(def: Extract<ParamDef, { type: 'features' }>, value: FeaturesValue, set: Setter, env: FieldEnv): HTMLElement {
  const scopes = scopesOf(def);
  const layers = env.ctx.doc.layers;
  const seg = segmented({
    label: def.label,
    options: scopes.map((s) => ({ value: s, label: SCOPE_SHORT[s] })),
    value: value.scope === 'ids' ? scopes[0] : value.scope,
    onChange: (s) => set(s === 'layer' ? { scope: 'layer', layerId: layers.active.value } : { scope: s }, true),
  });
  const parts: HTMLElement[] = [seg];
  if (value.scope === 'layer') {
    const dd = new Dropdown({
      ariaLabel: `${def.label}: katman`,
      className: 'pfield__dropdown',
      items: () =>
        layers.leaves().map((l): MenuItem => ({ label: layers.path(l.id), swatch: colorSwatch(l.style.color, env.ctx.view.palette), radio: true, checked: l.id === value.layerId, run: () => set({ scope: 'layer', layerId: l.id }, true) })),
    });
    dd.set(h('span', { class: 'dropdown__text' }, layers.get(value.layerId)?.name ?? '—'));
    parts.push(dd.el);
  }
  const found = env.describe(def.name);
  const empty = !found?.count;
  parts.push(h('div', { class: 'pfield__count', 'data-empty': empty ? '' : null }, icon(empty ? 'warning' : 'check', 14), h('span', null, found?.description ?? '')));
  if (def.kinds) parts.push(h('div', { class: 'pfield__kinds' }, `Uygun nesneler: ${def.kinds.map((k) => ENTITY_KIND_LABEL[k].toLocaleLowerCase('tr-TR')).join(', ')}`));
  return h('div', { class: 'pfield__stack' }, parts);
}

function layerField(def: Extract<ParamDef, { type: 'layer' }>, value: LayerValue, set: Setter, env: FieldEnv): HTMLElement {
  const layers = env.ctx.doc.layers;
  const suggested = (() => {
    const d = typeof def.default === 'function' ? null : def.default;
    return d && 'newName' in d ? d.newName : 'Yeni katman';
  })();
  const isNew = 'newName' in value;
  const dd = new Dropdown({
    ariaLabel: def.label,
    className: 'pfield__dropdown',
    items: () => [
      { kind: 'header', label: 'Yeni katman' },
      { label: `Yeni: ${isNew ? value.newName : suggested}`, icon: 'layerAdd', radio: true, checked: isNew, run: () => set({ newName: isNew ? value.newName : suggested }, true) },
      { kind: 'header', label: 'Mevcut katmanlar' },
      ...layers.leaves().map(
        (l): MenuItem => ({
          label: layers.path(l.id),
          swatch: colorSwatch(l.style.color, env.ctx.view.palette),
          radio: true,
          checked: !isNew && value.layerId === l.id,
          disabled: layers.isLocked(l.id),
          hint: layers.isLocked(l.id) ? 'kilitli' : undefined,
          run: () => set({ layerId: l.id }, true),
        }),
      ),
    ],
  });
  if (isNew) {
    const existing = layers.leaves().some((l) => l.name.toLocaleLowerCase('tr-TR') === value.newName.trim().toLocaleLowerCase('tr-TR'));
    dd.set(h('span', { class: 'dropdown__text' }, existing ? `${value.newName} (mevcut)` : `${value.newName} (yeni)`));
    const name = textField({ label: `${def.label}: yeni katman adı`, value: value.newName, onChange: (v) => set({ newName: v }, false) });
    name.classList.add('pfield__text');
    return h('div', { class: 'pfield__stack' }, dd.el, name);
  }
  dd.set(h('span', { class: 'dropdown__text' }, layers.get(value.layerId)?.name ?? '—'));
  return dd.el;
}

function pointField(def: Extract<ParamDef, { type: 'point' }>, value: Vec2 | null, env: FieldEnv): HTMLElement {
  const pick = h('button', { class: 'btn pfield__pick', type: 'button' }, icon('snap', 14), value ? 'Yeniden göster' : 'Haritadan göster');
  pick.addEventListener('click', () => env.pickPoint(def.name));
  return h('div', { class: 'pfield__point' }, h('span', { class: `pfield__coord${value ? ' num' : ''}` }, value ? env.ctx.format.point(value) : 'Henüz gösterilmedi'), pick);
}
