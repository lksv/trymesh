// The tool Extend (D65): a click on a line or an arc moves its end nearest to the click to the next
// curve its extension meets; the extension is drawn dashed while the pointer is over the curve.
import { type Vec2, curveUnder, extendEnd, extendReach } from '@trymesh/engine';
import { h } from '../dom';
import { type CutOptions, bound, boundRows, chosenRepair, repairRow, runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const extend: SketchPlaceTool<CutOptions> = {
  label: 'Extend',
  hint: 'Click a line or an arc near the end to extend.',
  picks: 'curve',
  eligible: (curve, context) => curve in context.feature.curves && context.feature.curves[curve].type !== 'circle',
  options: {
    initial: {},
    panel: (host, value, set) => [
      h('h2', {}, 'Extend'),
      ...boundRows(host, value, set),
      ...repairRow(host, value, set),
      h('p', { className: 'hint' }, 'Click a line or an arc near the end to extend: the end moves along the curve to the next curve it meets.'),
    ],
  },
  click: (host, _m, places, context, options) => {
    const place = anchor(places[places.length - 1]);
    // as for trim: the picker may have taken the span line that lies over the piece meant
    const curve = place.snap?.kind === 'curve' ? curveUnder(context.tool, place.at, place.snap.id) : undefined;
    const end = curve ? extendEnd(context.tool, curve, place.at) : undefined;
    if (!curve || !end) return host.say('Click a line or an arc near the end to extend.', true);
    runCut(host, context, 'extend', { curve, end, with: bound(context, options.with), repair: chosenRepair(context, options) }, 'Extend', 'Extended');
  },
  draw: (_places, cursor, context, options) => {
    const place = anchor(cursor);
    if (place.snap?.kind !== 'curve') return [];
    const curve = curveUnder(context.tool, place.at, place.snap.id);
    const end = curve ? extendEnd(context.tool, curve, place.at) : undefined;
    const reach = curve && end ? extendReach(context.tool, { curve, end, with: bound(context, options.with), repair: chosenRepair(context, options) }) : undefined;
    const shape = curve ? context.feature.curves[curve] : undefined;
    if (!end || !reach || !shape) return [];
    const from = context.view.points.get((shape as unknown as Record<string, string>)[end])?.at;
    if (!from) return [];
    if (shape.type !== 'arc') return [[from, reach]];
    // the extension of an arc: along its circle from the end to the place it reaches
    const center = context.view.points.get(shape.center)?.at;
    if (!center) return [[from, reach]];
    const radius = Math.hypot(from[0] - center[0], from[1] - center[1]);
    const [a, b] = [Math.atan2(from[1] - center[1], from[0] - center[0]), Math.atan2(reach[1] - center[1], reach[0] - center[0])];
    const turn = end === 'end' ? (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : -((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 32)));
    return [Array.from({ length: steps + 1 }, (_, i): Vec2 => [center[0] + radius * Math.cos(a + (turn * i) / steps), center[1] + radius * Math.sin(a + (turn * i) / steps)])];
  },
};
