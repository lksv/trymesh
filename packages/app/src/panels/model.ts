// The panel of the model: the plane a new sketch or plane waits for, the selected feature with
// its bodies, the selection in the view, and below them the open query and the parameters.
import { h } from '../dom';
import type { PanelHost } from '../host';
import { FEATURE_UI, uiOf } from '../features/index';
import { FEATURE_TYPES } from '../labels';
import { bodyForm, bodyRows, orphanRows } from './body';
import { type QueryPanel, queryPanel } from './query';
import { parametersPanel } from './parameters';

export function modelPanel(host: PanelHost, queries: QueryPanel): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (host.pending) {
    out.push(
      h('h2', {}, FEATURE_UI[host.pending].create?.plane?.header ?? ''),
      h('p', { className: 'hint' }, 'Klikněte v pohledu na rovinu nebo rovinnou stěnu, nebo zvolte základní rovinu:'),
      h('div', { className: 'buttons' }, ...(['XY', 'XZ', 'YZ'] as const).map((plane) => h('button', { textContent: plane, onclick: () => host.usePlane({ kind: 'base', plane }) }))),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Zrušit', onclick: () => host.cancelPending() })),
    );
    return out;
  }
  const f = host.feature(host.selectedFeature);
  if (f) {
    const result = host.engine.getState().evaluation.features[f.id];
    out.push(
      h('h2', {}, FEATURE_TYPES[f.type]),
      h('label', {}, 'Název', h('input', { value: f.name, onchange: (event: Event) => host.run({ type: 'renameFeature', id: f.id, name: (event.target as HTMLInputElement).value }) })),
      ...host.issues(result),
      h(
        'div',
        { className: 'buttons' },
        h('button', { textContent: 'Upravit', className: 'primary', onclick: () => host.edit(f.id) }),
        h('button', { textContent: f.suppressed ? 'Obnovit' : 'Potlačit', onclick: () => host.run({ type: 'setSuppressed', id: f.id, suppressed: !f.suppressed }) }),
        h('button', { textContent: 'Smazat', onclick: () => host.run({ type: 'removeFeature', id: f.id }, `Smazáno: ${f.name}. Závislé prvky zůstávají a hlásí chybu.`) }),
      ),
    );
    out.push(...uiOf(f.type).summary(host, f, result));
    // the bodies the feature created, each with its properties, volume, size and its own export;
    // the form of the properties when it created one
    out.push(...bodyRows(host, result?.bodies ?? []));
    if (result?.bodies.length === 1 && !(host.selected && host.selected.kind !== 'plane' && host.selected.body === result.bodies[0])) out.push(...bodyForm(host, result.bodies[0]));
  } else {
    out.push(h('h2', {}, 'Model'), h('p', { className: 'hint' }, 'Pravé tlačítko myši otáčí, kolečko přibližuje, prostřední tlačítko (nebo Shift + pravé) posouvá. Na touchpadu: Alt/Option + tažení otáčí, Alt + Shift + tažení posouvá, dva prsty přibližují. Prvek na časové ose se upravuje dvojklikem.'));
  }
  if (host.selected) {
    out.push(h('h2', {}, 'Výběr'), h('p', {}, host.describe(host.selected)));
    if (host.selected.kind !== 'plane') out.push(...bodyRows(host, [host.selected.body]), ...bodyForm(host, host.selected.body));
  }
  out.push(...orphanRows(host));
  out.push(...queryPanel(queries, host));
  out.push(...parametersPanel(host));
  return out;
}

// ---------------------------------------------------------------- collisions
