// The view of the query `print` (D42): a row per body and orientation with what decides between
// orientations (the overhang, the height, the area on the bed, whether it fits the bed and
// whether a face named to lie on the bed does). A picked row paints the faces on the bed and the
// overhanging faces of that orientation on the model as it stands, lists the overhanging faces
// with their areas and the heights they start at, and says what the lists leave out. The view
// does not turn the model onto a bed: the faces are the answer, and they are where the design
// would be changed.
import type { Id, PrintOrientation, PrintReport, QueryArgs } from '@trymesh/engine';
import { h } from '../dom';
import { COLOR } from '../draw';
import type { QueryView, ViewPanel } from './index';

type Way = QueryArgs<'print'>['orientations'][number];
interface Row {
  body: Id;
  way: number; // the index of the orientation in the argument
  orientation: PrintOrientation;
}
// Rows are counted through all bodies, in the order of the answer.
const rowsOf = (result: PrintReport): Row[] => result.bodies.flatMap(({ body, orientations }) => orientations.map((orientation, way) => ({ body, way, orientation })));
const count = (number: number, one: string, many = `${one}s`): string => `${number} ${number === 1 ? one : many}`;
// A number summed over a mesh is shown to a hundredth: the rest is the polygon of a round face.
const coarse = (value: number): number => Math.round(value * 100) / 100 + 0;
const CONTACT = { color: COLOR.hover, name: 'blue' };
const OVERHANG = { color: COLOR.clash, name: 'red' };

// An orientation as its argument says it: the face that lies on the bed, or the direction that
// is up (the unit vector of the answer, to two places). A face is named only on the row of the
// body it belongs to: for another body it gives the direction and nothing lies on it.
function wayText(body: Id, way: Way | undefined, orientation: PrintOrientation, panel: ViewPanel<'print'>): string {
  const turn = typeof way?.turn === 'number' && way.turn !== 0 ? `, turned ${panel.number(way.turn, 'rad')}` : '';
  if (way && 'onBed' in way.by && way.by.onBed && way.by.onBed.body === body) return `on ${panel.faceLabel(way.by.onBed.face)}${turn}`;
  return `up ${orientation.up.map((part) => Math.round(part * 100) / 100 + 0).join(', ')}${turn}`;
}

export const printView: QueryView<'print'> = {
  answer(result, args, panel) {
    const area = (value: number): string => panel.number(coarse(value), 'mm2');
    const length = (value: number): string => panel.number(coarse(value), 'mm');
    const row = ({ body, way, orientation }: Row, index: number): HTMLElement[] => {
      const picked = panel.picked === index;
      const { size, contact, overhang } = orientation;
      const line = h(
        'div',
        { className: `row ${picked ? 'selected' : ''}`, title: 'Paint the faces on the bed and the overhanging faces of this orientation, and list the overhangs', onclick: () => panel.pick(picked ? undefined : index) },
        h('span', { className: 'name', textContent: `${panel.bodyName(body)} · ${wayText(body, args.orientations[way], orientation, panel)}` }),
        h('small', {}, overhang.count ? `overhang ${area(overhang.area)}` : 'no overhang'),
      );
      const summary = h(
        'p',
        { className: 'hint' },
        `Height ${length(size[2])}; ${contact.count ? `${area(contact.area)} on the bed on ${count(contact.count, 'face')}` : 'nothing flat on the bed'}${overhang.count ? `; overhang on ${count(overhang.count, 'face')}` : ''}.`,
      );
      const warnings = [
        ...(orientation.fits === false ? [`Does not fit the bed: ${length(size[0])} × ${length(size[1])} × ${length(size[2])}.`] : []),
        ...(orientation.onBed === false ? ['The face named does not lie on the bed: something of the body reaches below it.'] : []),
      ].map((text) => h('p', { className: 'issue warning' }, text));
      if (!picked) return [line, summary, ...warnings];
      // what the lists leave out and why, per list: the view replaces the tree, so nothing else says it
      const listable = overhang.count - overhang.small;
      const left = [
        ...(contact.faces.length < contact.count ? [`${contact.faces.length} of ${count(contact.count, 'face')} on the bed painted`] : []),
        ...(overhang.faces.length < listable ? [`${overhang.faces.length} of ${count(listable, 'overhanging face')} listed`] : []),
        ...(overhang.small ? [`${count(overhang.small, 'overhang')} below the smallest area listed`] : []),
      ];
      const painted = [...(contact.faces.length ? [`on the bed ${CONTACT.name}`] : []), ...(overhang.faces.length ? [`overhanging ${OVERHANG.name}`] : [])];
      const details = h(
        'div',
        { className: 'tree' },
        // these faces look down in this orientation: from above the model hides them
        painted.length ? h('p', { className: 'hint' }, `Painted in the view: ${painted.join(', ')}. They look away from what is up, so they may be on the far side of the model.`) : null,
        ...overhang.faces.map((entry) => h('p', { className: 'answer' }, `${panel.faceLabel(entry.face)}: ${area(entry.area)}, ${coarse(entry.from) > 0 ? `from ${length(entry.from)} above the bed` : 'from the bed'}`)),
        left.length ? h('p', { className: 'hint' }, `${left.join('; ')}.`) : null,
      );
      return [line, summary, ...warnings, ...(painted.length || left.length ? [details] : [])];
    };
    return [
      ...(result.bodies.length === 0 ? [h('p', { className: 'hint' }, 'The model has no body to print.')] : []),
      ...rowsOf(result).flatMap(row),
      ...(result.truncated ? [h('p', { className: 'hint' }, `Listed: ${result.truncated.shown} of ${count(result.truncated.total, 'face')} on the bed or overhanging by the smallest area listed or more. Raise "Most faces" to see the rest.`)] : []),
      // the threads the meshes do not carry (D76)
      ...(result.cosmeticThreads ? [h('p', { className: 'hint' }, `Cosmetic threads, not in the mesh and not judged here: ${result.cosmeticThreads.map((entry) => `${panel.bodyName(entry.body)} (${entry.threads})`).join(', ')}. Tap or cut them after printing.`)] : []),
    ];
  },
  scene(result, _args, panel) {
    const picked = panel.picked === undefined ? undefined : rowsOf(result)[panel.picked];
    if (!picked) return {};
    const paint = (faces: PrintOrientation['contact']['faces'], color: number) => faces.map(({ face }) => ({ body: picked.body, face, color, opacity: 0.6 }));
    return { faces: [...paint(picked.orientation.contact.faces, CONTACT.color), ...paint(picked.orientation.overhang.faces, OVERHANG.color)] };
  },
  note(result) {
    const rows = rowsOf(result);
    const misfits = rows.filter((row) => row.orientation.fits === false).length;
    const ways = result.bodies[0]?.orientations.length ?? 0;
    return { text: `Print check: ${count(result.bodies.length, 'body', 'bodies')} in ${count(ways, 'orientation')}.${misfits ? ` ${misfits} of ${rows.length} do not fit the bed.` : ''}${rows.length ? ' Pick a row to see its faces.' : ''}`, error: false };
  },
};
