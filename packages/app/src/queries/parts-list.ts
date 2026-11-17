// The view of the query `partsList` (D57): what to print and what to buy. Asked as soon as its form
// opens. Three groups under their headings, *To print*, *To buy* and *Hardware*, a row per row of
// the answer ("M3x6 screw × 4", with the material, a patch of the colour, the mass of one and of
// all, and what the row comes from); then the sums, the hole features without a label and the
// auxiliary bodies, each only when there is something to say. A picked row of bodies draws its
// bodies in the colour of a selection; a picked row of hardware paints the bores and heads of its
// hole features in the bodies that are parts, the faces the count was taken from (looked up in the
// state the answer is of, not computed).
import type { HardwareRow, PartRow, PartsList } from '@trymesh/engine';
import { h } from '../dom';
import { featureNameIn } from '../issue-text';
import { COLOR } from '../draw';
import type { QueryView, ViewPanel } from './index';

// Rows are counted through the three groups, in this order.
const allRows = (result: PartsList): (PartRow | HardwareRow)[] => [...result.printed, ...result.bought, ...result.hardware];
const count = (number: number, one: string, many = `${one}s`): string => `${number} ${number === 1 ? one : many}`;
// A patch of the colour of the bodies of a row.
function patch(color: string): HTMLElement {
  const element = h('span', { className: 'swatch', title: color });
  element.style.background = color;
  return element;
}
// The hole features of a row by their names, with the holes of each.
// An inserted hole feature (D62) by the insertion and its name there.
const holesText = (holes: HardwareRow['holes'], panel: ViewPanel<'partsList'>): string => holes.map((hole) => `${featureNameIn(panel.state.document, hole.feature) ?? hole.feature} (${hole.count})`).join(', ');
// A mass is shown to four significant digits: the view compares parts, the file has six.
const grams = (value: number, panel: ViewPanel<'partsList'>): string => panel.number(Number(value.toPrecision(4)), 'g');

export const partsListView: QueryView<'partsList'> = {
  immediate: true,
  answer(result, _args, panel) {
    const weighs = (r: PartRow): string =>
      r.mass === undefined ? (r.noMass === 'inError' ? 'the mass cannot be evaluated' : 'no mass: set a material or a mass') : r.count === 1 ? grams(r.mass, panel) : `${grams(r.mass, panel)} each, ${grams(r.totalMass ?? 0, panel)}`;
    const source = (r: PartRow): string | undefined => (r.copyOf === undefined ? undefined : `${r.differs ? 'differs from' : r.mirrored ? 'mirror image of' : 'copy of'} ${panel.bodyName(r.copyOf)}`);
    const line = (index: number, title: string, text: string, detail: string, swatch?: string): HTMLElement => {
      const picked = panel.picked === index;
      return h(
        'div',
        { className: `row ${picked ? 'selected' : ''}`, title, onclick: () => panel.pick(picked ? undefined : index) },
        swatch === undefined ? null : patch(swatch),
        h('span', { className: 'name', textContent: text }),
        h('small', {}, detail),
      );
    };
    let index = 0;
    const bodies = (heading: string, rows: PartRow[]): HTMLElement[] =>
      rows.length === 0
        ? []
        : [
            h('h3', {}, heading),
            ...rows.map((r) => line(index++, `Highlight the bodies: ${r.bodies.map((body) => panel.bodyName(body)).join(', ')}`, `${r.name} × ${r.count}`, [r.material, weighs(r), source(r)].filter((part) => part !== undefined).join(' · '), r.color)),
          ];
    const out = [...bodies('To print', result.printed), ...bodies('To buy', result.bought)];
    if (result.hardware.length) out.push(h('h3', {}, 'Hardware'), ...result.hardware.map((r) => line(index++, 'Paint the holes the count was taken from', `${r.label} × ${r.count}`, holesText(r.holes, panel))));
    const { printed, bought } = result.totals;
    const without = (number: number): string => (number ? `, not counting ${count(number, 'body', 'bodies')} without a mass` : '');
    const hints = [
      ...(allRows(result).length === 0 ? ['The model has no part and no labelled hole to list.'] : []),
      `To print: ${count(printed.count, 'body', 'bodies')}, ${grams(printed.mass, panel)}${without(printed.withoutMass)}. To buy: ${count(bought.count, 'body', 'bodies')}, ${grams(bought.mass, panel)}${without(bought.withoutMass)}.`,
      ...(result.unlabelled ? [`Holes without a label: ${holesText(result.unlabelled, panel)}. Label a hole with the piece that goes into it.`] : []),
      ...(result.auxiliary ? [`No parts (auxiliary): ${result.auxiliary.map((body) => panel.bodyName(body)).join(', ')}.`] : []),
    ];
    return [...out, ...hints.map((text) => h('p', { className: 'hint' }, text))];
  },
  scene(result, _args, panel: ViewPanel<'partsList'>) {
    const picked = panel.picked === undefined ? undefined : allRows(result)[panel.picked];
    if (!picked) return {};
    if (!('label' in picked)) return { bodies: picked.bodies.map((body) => ({ body, color: COLOR.select })) };
    // the faces the count was taken from: the bores and heads of the hole features of the row, in
    // the bodies of the state that are parts
    const features = new Set(picked.holes.map((hole) => hole.feature));
    const { bodies, faceNames, bodyProperties } = panel.state.evaluation;
    return {
      faces: Object.entries(bodies)
        .filter(([body]) => bodyProperties[body]?.use !== 'auxiliary')
        .flatMap(([body, shape]) =>
          shape.faces
            .map((face) => faceNames[face.id])
            .filter((name) => features.has(name.feature) && (name.role === 'holeBore' || name.role === 'holeHead'))
            .map((face) => ({ body, face, color: COLOR.select, opacity: 0.6 })),
        ),
    };
  },
  note(result) {
    const { printed, bought, hardware } = result.totals;
    return { text: `Parts list: ${printed.count} to print, ${bought.count} to buy, ${count(hardware.count, 'piece')} of hardware.${allRows(result).length ? ' Pick a row to see it.' : ''}`, error: false };
  },
};
