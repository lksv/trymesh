// The panel of the model: the plane a new sketch or plane waits for, the selected feature with
// its bodies, the selection in the view, and below them the open query and the parameters.
import { type Id, bodyFileName } from '@trymesh/engine';
import { download, fmt, h } from '../dom';
import type { PanelHost } from '../host';
import { FEATURE_UI, uiOf } from '../features/index';
import { FEATURE_TYPES } from '../labels';
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
    // the bodies the feature created, each with its volume, size and its own export
    out.push(...bodyRows(host, result?.bodies ?? []));
  } else {
    out.push(h('h2', {}, 'Model'), h('p', { className: 'hint' }, 'Pravé tlačítko myši otáčí, kolečko přibližuje, prostřední tlačítko (nebo Shift + pravé) posouvá. Na touchpadu: Alt/Option + tažení otáčí, Alt + Shift + tažení posouvá, dva prsty přibližují. Prvek na časové ose se upravuje dvojklikem.'));
  }
  if (host.selected) {
    out.push(h('h2', {}, 'Výběr'), h('p', {}, host.describe(host.selected)));
    if (host.selected.kind !== 'plane') out.push(...bodyRows(host, [host.selected.body]));
  }
  out.push(...queryPanel(queries, host));
  out.push(...parametersPanel(host));
  return out;
}

// A line per body: name, volume, size of its box, and the export of that body alone. The file
// is named by the body ID (a copy of a pattern: `planets%2F1.stl`).
function bodyRows(host: PanelHost, ids: Id[]): HTMLElement[] {
  const bodies = host.view().evaluation.bodies;
  return ids
    .filter((id) => Object.prototype.hasOwnProperty.call(bodies, id))
    .map((id) => {
      const { volume, bounds } = bodies[id];
      const size = bounds.max.map((high, axis) => fmt(high - bounds.min[axis])).join(' × ');
      const exportable = Object.prototype.hasOwnProperty.call(host.engine.getState().evaluation.bodies, id);
      return h(
        'p',
        { className: 'hint body' },
        `${host.bodyName(id)}: ${fmt(volume)} mm³, ${size} mm `,
        h('button', { className: 'link', textContent: 'Export STL', disabled: !exportable, title: 'This body alone, as it is at the end of the timeline', onclick: () => download(`${bodyFileName(id)}.stl`, new Uint8Array(host.engine.exportMesh('stl', [id])), 'model/stl') }),
      );
    });
}

// ---------------------------------------------------------------- collisions
