// The panel of the model: the plane a new sketch or plane waits for, the selected feature with
// its bodies, the selection in the view, and below them the open query or export, the stored
// meshes, the stored documents, the parameters and the mechanism.
import { h } from '../dom';
import type { PanelHost } from '../host';
import { FEATURE_UI, uiOf } from '../features/index';
import { FEATURE_TYPES } from '../labels';
import { bodyForm, bodyRows, orphanRows } from './body';
import { type MechanismPanel, mechanismPanel } from './mechanism';
import { exportPanel } from './export';
import { documentsPanel } from './documents';
import { meshesPanel } from './meshes';
import { type QueryPanel, queryPanel } from './query';
import { parametersPanel } from './parameters';

export function modelPanel(host: PanelHost, queries: QueryPanel, mechanism: MechanismPanel): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (host.pending) {
    out.push(
      h('h2', {}, FEATURE_UI[host.pending].create?.plane?.header ?? ''),
      h('p', { className: 'hint' }, 'Click a plane or a planar face in the view, or choose a base plane:'),
      h('div', { className: 'buttons' }, ...(['XY', 'XZ', 'YZ'] as const).map((plane) => h('button', { textContent: plane, onclick: () => host.usePlane({ kind: 'base', plane }) }))),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Cancel', onclick: () => host.cancelPending() })),
    );
    return out;
  }
  const f = host.feature(host.selectedFeature);
  if (f) {
    const result = host.engine.getState().evaluation.features[f.id];
    out.push(
      h('h2', {}, FEATURE_TYPES[f.type]),
      h('label', {}, 'Feature name', h('input', { value: f.name, onchange: (event: Event) => host.run({ type: 'renameFeature', id: f.id, name: (event.target as HTMLInputElement).value }) })),
      ...host.issues(result),
      h(
        'div',
        { className: 'buttons' },
        h('button', { textContent: 'Edit feature', className: 'primary', onclick: () => host.edit(f.id) }),
        h('button', { textContent: f.suppressed ? 'Unsuppress' : 'Suppress', onclick: () => host.run({ type: 'setSuppressed', id: f.id, suppressed: !f.suppressed }) }),
        h('button', { textContent: 'Delete', onclick: () => host.run({ type: 'removeFeature', id: f.id }, `Deleted: ${f.name}. Dependent features stay and report an error.`) }),
      ),
    );
    out.push(...uiOf(f.type).summary(host, f, result));
    // the bodies the feature created, each with its properties, volume, size and its own export;
    // the form of the properties when it created one
    out.push(...bodyRows(host, result?.bodies ?? []));
    if (result?.bodies.length === 1 && !(host.selected && host.selected.kind !== 'plane' && host.selected.body === result.bodies[0])) out.push(...bodyForm(host, result.bodies[0]));
  } else {
    out.push(h('h2', {}, 'Model'), h('p', { className: 'hint' }, 'The right mouse button orbits, the wheel zooms, the middle button (or Shift + right) pans. On a touchpad: Alt/Option + drag orbits, Alt + Shift + drag pans, two fingers zoom. A feature on the timeline is edited by a double click.'));
  }
  if (host.selected) {
    out.push(h('h2', {}, 'Selection'), h('p', {}, host.describe(host.selected)));
    if (host.selected.kind !== 'plane') out.push(...bodyRows(host, [host.selected.body]), ...bodyForm(host, host.selected.body));
  }
  out.push(...orphanRows(host));
  out.push(...queryPanel(queries, host), ...exportPanel(queries, host));
  out.push(...meshesPanel(host));
  out.push(...documentsPanel(host));
  out.push(...parametersPanel(host));
  out.push(...mechanismPanel(host, mechanism));
  return out;
}

// ---------------------------------------------------------------- collisions
