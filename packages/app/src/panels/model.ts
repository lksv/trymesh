// The panel of the model: the plane a new sketch or plane waits for, the selected feature with
// its bodies, the selection in the view, and below them the collisions and the parameters.
import { GENERATORS, type Id, type Unit, bodyFileName } from '@trymesh/engine';
import { download, fmt, h } from '../dom';
import { valueText } from '../fields';
import type { PanelHost } from '../host';
import { FEATURE_TYPES, OPERATIONS, SIDES, factsText } from '../labels';
import { type Collisions, collisionsPanel } from './collisions';
import { parametersPanel } from './parameters';

export function modelPanel(host: PanelHost, collisions: Collisions): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (host.pending) {
    out.push(
      h('h2', {}, host.pending === 'sketch' ? 'Nová skica' : 'Nová rovina'),
      h('p', { className: 'hint' }, 'Klikněte v pohledu na rovinu nebo rovinnou stěnu, nebo zvolte základní rovinu:'),
      h('div', { className: 'buttons' }, ...(['XY', 'XZ', 'YZ'] as const).map((plane) => h('button', { textContent: plane, onclick: () => host.usePlane({ kind: 'base', plane }) }))),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Zrušit', onclick: () => host.cancelPending() })),
    );
    return out;
  }
  const f = host.feature(host.selectedFeature);
  if (f) {
    const result = host.engine.getState().evaluation.features[f.id];
    const ref = host.planeRefOf(host.selected);
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
    if (f.type === 'sketch') {
      out.push(
        h('button', { textContent: 'Přenést skicu na vybranou rovinu', disabled: !ref, title: 'Nejdřív vyberte v pohledu rovinu nebo rovinnou stěnu', onclick: () => ref && host.run({ type: 'setSketchPlane', sketch: f.id, plane: ref }, 'Rovina skici změněna.') }),
      );
    }
    const shown = (path: string, value: number): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${fmt(value)}` : fmt(value));
    if (f.type === 'extrude') {
      const start = f.extent.type === 'distance' && (f.extent.start !== 0 || f.expressions?.['extent/start']) ? `, start ${shown('extent/start', f.extent.start)} mm` : '';
      const extent = f.extent.type === 'distance' ? `distance ${shown('extent/distance', f.extent.distance)} mm${start}` : `through all (${SIDES[f.extent.side].toLowerCase()})`;
      const targets = f.targets?.length ? `, bodies: ${f.targets.map((id) => host.bodyName(id)).join(', ')}` : '';
      const profile = f.profile.type === 'regions' ? `regions: ${f.profile.regions.length}` : `${GENERATORS[f.profile.generator].title.toLowerCase()} over ${Object.values(f.profile.operands).join(', ')}`;
      out.push(h('p', { className: 'hint' }, `${OPERATIONS[f.operation]}, ${extent}, ${profile}${targets}.`));
      const facts = factsText(f, host.view().evaluation.features[f.id]);
      if (facts) out.push(h('p', { className: 'hint' }, facts));
    }
    if (f.type === 'plane') out.push(h('p', { className: 'hint' }, `Posun ${shown('offset', f.offset)} mm.`));
    if (f.type === 'pattern') {
      const { axis, count, span } = f.transform;
      const field = (path: string, value: number, unit: Unit): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${valueText(value, unit)}` : valueText(value, unit));
      const source = f.source.type === 'features' ? `features: ${f.source.features.map((id) => host.nameOf(id)).join(', ')}` : `body: ${host.bodyName(f.source.body)}`;
      const around = axis.kind === 'base' ? `axis ${axis.axis}` : `the point ${axis.point} of ${host.nameOf(axis.sketch)}`;
      const extent = span.type === 'full' ? 'the full circle' : `an angle of ${field('transform/span/angle', span.angle, 'rad')}`;
      out.push(h('p', { className: 'hint' }, `Count ${field('transform/count', count, 'count')} with the original, around ${around}, ${extent}; ${source}.`));
    }
    // the bodies the feature created, each with its volume, size and its own export
    out.push(...bodyRows(host, result?.bodies ?? []));
  } else {
    out.push(h('h2', {}, 'Model'), h('p', { className: 'hint' }, 'Pravé tlačítko myši otáčí, kolečko přibližuje, prostřední tlačítko (nebo Shift + pravé) posouvá. Na touchpadu: Alt/Option + tažení otáčí, Alt + Shift + tažení posouvá, dva prsty přibližují. Prvek na časové ose se upravuje dvojklikem.'));
  }
  if (host.selected) {
    out.push(h('h2', {}, 'Výběr'), h('p', {}, host.describe(host.selected)));
    if (host.selected.kind !== 'plane') out.push(...bodyRows(host, [host.selected.body]));
  }
  out.push(...collisionsPanel(collisions, host));
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
