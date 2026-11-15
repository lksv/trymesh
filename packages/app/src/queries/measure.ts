// The view of the query `measure` (D39): the numbers with their units, the two entities
// highlighted, and the two points of the smallest distance joined by a line with its length.
import { h } from '../dom';
import { COLOR } from '../draw';
import type { QueryView } from './index';

const coarse = (value: number): number => Math.round(value * 1000) / 1000 + 0;

export const measureView: QueryView<'measure'> = {
  answer(result, _args, panel) {
    const row = (name: string, value: string, title = ''): HTMLElement => h('p', { className: 'answer', title }, `${name}: ${value}`);
    return [
      // a distance between two faces that look away from each other is the thickness of a wall
      ...(result.distance === undefined ? [] : [row(result.facing === 'away' ? 'Thickness' : result.facing === 'towards' ? 'Gap' : 'Distance', panel.number(result.distance, 'mm'), 'Exact: between the planes, the axes, the lines, the centres or the points of the two')]),
      ...(result.angle === undefined ? [] : [row('Angle', panel.number(result.angle, 'rad'), 'Exact: two faces by their normals out of the bodies; a face and an axis by the axis; two axes without a sense')]),
      // a number measured on the mesh is not known to more than a thousandth of a millimetre
      row('Smallest distance', `${panel.number(coarse(result.smallest.distance), 'mm')} ± ${panel.number(coarse(result.smallest.accuracy), 'mm')}`, 'Measured on the mesh between the two as they are on the bodies; round faces are polygons'),
      ...(result.distance === undefined ? [h('p', { className: 'hint' }, 'This pair has no exact distance: one of the two has no exact form, or they are not parallel.')] : []),
    ];
  },
  scene(result, args, panel) {
    const { from, to, distance } = result.smallest;
    const faces = [args.from, args.to].flatMap((ref) => (ref.kind === 'face' ? [{ body: ref.body, face: ref.face, color: COLOR.hover, opacity: 0.4 }] : []));
    const middle: [number, number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    return {
      faces,
      lines: [{ segments: [...from, ...to], color: COLOR.select, width: 2, onTop: true }],
      points: [{ positions: [...from, ...to], color: COLOR.select, size: 8 }],
      labels: [{ at: middle, text: panel.number(coarse(distance), 'mm'), tone: 'reference' }],
    };
  },
};
