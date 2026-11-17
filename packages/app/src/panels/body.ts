// The properties of a body in the model panel (D48): the line of a body with what its properties
// say, the form of a selected body (every change is one command), and the entries of properties
// whose body is gone.
import { type BodyPropertiesPatch, type BodyUse, DATA_CATALOGS, DENSITY, type Expr, type Id, MASS, type NumberSpec, bodyFileName, bodyPropertiesWithoutBody } from '@trymesh/engine';
import { download, fmt, h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField, valueText } from '../fields';
import type { PanelHost } from '../host';

export const USES: Record<BodyUse, string> = { part: 'Printed part', reference: 'Reference part (not printed)', auxiliary: 'Auxiliary (no mass, not printed)' };
const USE_MARK: Record<BodyUse, string> = { part: '', reference: ' [reference]', auxiliary: ' [auxiliary]' };
const own = <T extends object>(record: T, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

// A line per body: name, material and mass from its properties, a mark of a reference or an
// auxiliary body, volume, size of its box, and the export of that body alone, whatever its use.
// The file is named by the body ID (a copy of a pattern: `planets%2F1.stl`).
export function bodyRows(host: PanelHost, ids: Id[]): HTMLElement[] {
  const { bodies, bodyProperties } = host.view().evaluation;
  return ids
    .filter((id) => own(bodies, id))
    .map((id) => {
      const { volume, bounds } = bodies[id];
      const properties = own(bodyProperties, id) ? bodyProperties[id] : undefined;
      const size = bounds.max.map((high, axis) => fmt(high - bounds.min[axis])).join(' × ');
      const exportable = own(host.engine.getState().evaluation.bodies, id);
      const material = properties?.material ? `${properties.material}, ` : '';
      const mass = properties?.mass !== undefined ? `${valueText(properties.mass, 'g', 4)}, ` : '';
      return h(
        'p',
        { className: 'hint body' },
        `${host.bodyName(id)}${USE_MARK[properties?.use ?? 'part']}: ${material}${mass}${fmt(volume)} mm³, ${size} mm `,
        h('button', { className: 'link', textContent: 'Export STL', disabled: !exportable, title: 'This body alone, whatever its use, as it is at the end of the timeline', onclick: () => download(`${bodyFileName(id)}.stl`, new Uint8Array(host.engine.exportMesh('stl', [id])), 'model/stl') }),
      );
    });
}

// The form of the properties of one body. What the entry of the body does not state shows what it
// has anyway (inherited from the body it was copied from, or the default) as a placeholder.
export function bodyForm(host: PanelHost, id: Id): HTMLElement[] {
  const { document: doc, evaluation } = host.engine.getState();
  if (!own(evaluation.bodyProperties, id)) return [];
  const result = evaluation.bodyProperties[id];
  const entry = own(doc.bodyProperties, id) ? doc.bodyProperties[id] : {};
  const set = (patch: BodyPropertiesPatch, done?: string): boolean => host.run({ type: 'setBodyProperties', body: id, patch }, done);
  const text = (label: string, field: 'name' | 'material', placeholder: string): HTMLElement => {
    // without a value of its own: what the body has anyway (the name of its feature, an inherited material)
    const input = h('input', { value: entry[field] ?? '', placeholder: entry[field] === undefined ? placeholder : '', onchange: () => !set({ [field]: input.value.trim() === '' ? null : input.value.trim() }) && host.refresh() });
    return h('label', {}, label, input);
  };
  const names = doc.parameters.map((p) => p.name);
  const number = (label: string, field: 'density' | 'mass', spec: NumberSpec): HTMLElement => {
    const stated = entry[field] === undefined ? undefined : (entry.expressions?.[field] ?? entry[field]);
    const shown = result[field];
    const input = h('input', {
      value: stated === undefined ? '' : fieldText(stated as number | Expr, spec.unit),
      // what the body has without a value of its own: inherited, or worked out from the density
      placeholder: stated === undefined && shown !== undefined ? valueText(shown, spec.unit, 4) : '',
      oninput: () => {
        const parsed = parseField(input.value, spec.unit);
        markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
      },
      onchange: () => !set({ [field]: parseField(input.value, spec.unit) ?? null }) && host.refresh(),
    });
    const note = typeof stated === 'string' ? h('small', { className: 'computed' }, result.fieldErrors?.[field] ? 'error' : shown === undefined ? '' : `= ${valueText(shown, spec.unit, 4)}`) : null;
    return h('label', {}, `${label} (${spec.unit})`, h('span', { className: 'field' }, input, note));
  };
  const rows = DATA_CATALOGS.materials.rows;
  const material = h(
    'select',
    { onchange: () => material.value !== '' && host.run({ type: 'setBodyMaterial', body: id, material: material.value }, `Material ${material.value} with the density of its data sheet.`) },
    h('option', { value: '', textContent: '—', selected: !(entry.material !== undefined && own(rows, entry.material)) }),
    ...Object.entries(rows).map(([key, row]) => h('option', { value: key, textContent: `${key} (${row.density} g/cm³)`, selected: entry.material === key, title: row.source.replace(/ \([^()]*https?:[^()]*\)/g, '') })),
  );
  // Without a use of its own a copy has the use of its source, which the result of the source says
  // (its own or what it inherits in turn); a body copied from none has the default.
  const source = result.from !== undefined && own(evaluation.bodyProperties, result.from) ? evaluation.bodyProperties[result.from] : undefined;
  const inheritedUse = result.from === undefined ? `Default: ${USES.part}` : source ? `As its source: ${USES[source.use]}` : 'As its source';
  const use = h(
    'select',
    { onchange: () => set({ use: use.value === '' ? null : (use.value as BodyUse) }) },
    h('option', { value: '', textContent: inheritedUse, selected: entry.use === undefined }),
    ...(Object.keys(USES) as BodyUse[]).map((key) => h('option', { value: key, textContent: USES[key], selected: entry.use === key })),
  );
  const color = h('input', { type: 'color', value: result.color ?? '#aab7c6', onchange: () => set({ color: color.value }) });
  return [
    h('h2', {}, `Properties of ${result.name}`),
    ...(result.from !== undefined ? [h('p', { className: 'hint' }, `Made from ${host.bodyName(result.from)} (a copy, or a part split off): what is left empty is taken from it.`)] : []),
    text('Name', 'name', result.name),
    h('label', {}, 'Use', use),
    h('label', {}, 'Material from the catalog', material),
    text('Material', 'material', result.material ?? ''),
    number('Density', 'density', DENSITY),
    number('Mass', 'mass', MASS),
    h('label', {}, 'Colour', h('span', { className: 'field' }, color, entry.color !== undefined ? h('button', { className: 'link', textContent: 'Default', onclick: () => set({ color: null }) }) : null)),
    ...Object.entries(result.fieldErrors ?? {}).map(([field, error]) => h('p', { className: 'issue error' }, `${field === 'mass' ? 'Mass' : 'Density'}: ${error.message}`)),
    ...(own(doc.bodyProperties, id) ? [h('div', { className: 'buttons' }, h('button', { textContent: 'Clear the properties', onclick: () => host.run({ type: 'removeBodyProperties', body: id }) }))] : []),
  ];
}

// Entries of properties whose body the model does not have (the feature was removed or
// suppressed, the count of a pattern dropped), each with a button that removes it. A body made
// again under the ID would take the entry over.
export function orphanRows(host: PanelHost): HTMLElement[] {
  const { document: doc, evaluation } = host.engine.getState();
  const gone = bodyPropertiesWithoutBody(doc.bodyProperties, evaluation.bodyProperties);
  if (gone.length === 0) return [];
  return [
    h('h2', {}, 'Properties without a body'),
    h('p', { className: 'hint' }, 'These bodies are not in the model now. A body made again under the same ID takes its properties over.'),
    ...gone.map((id) => h('p', { className: 'hint body' }, `${id}: ${[doc.bodyProperties[id].name, doc.bodyProperties[id].use, doc.bodyProperties[id].material].filter((part) => part !== undefined).join(', ') || 'properties'} `, h('button', { className: 'link', textContent: 'Remove', onclick: () => host.run({ type: 'removeBodyProperties', body: id }, `The properties of ${id} removed.`) }))),
  ];
}
