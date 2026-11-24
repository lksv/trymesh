// The tool Trim (D65): a click on a curve removes the piece of it under the click, between the
// neighbouring curves that cross it; the piece is drawn dashed while the pointer moves over it.
// The curve a click means is asked of the engine (`curveUnder`): a span line lies exactly over the
// pieces of its line, and the picker takes the first of equally near curves.
import { curveUnder, trimPiece } from '@trymesh/engine';
import { h } from '../dom';
import { polyline } from '../sketch-view';
import { type CutOptions, bound, boundRows, chosenRepair, ownCurve, repairRow, runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const trim: SketchPlaceTool<CutOptions> = {
  label: 'Trim',
  hint: 'Click the piece of a curve to remove.',
  picks: 'curve',
  eligible: ownCurve,
  options: {
    initial: {},
    panel: (host, value, set) => [
      h('h2', {}, 'Trim'),
      ...boundRows(host, value, set),
      ...repairRow(host, value, set),
      h('p', { className: 'hint' }, 'Click the piece of a curve to remove: the part between the curves that cross it. The constraints stay with the pieces they describe, and the features that use the outline follow.'),
    ],
  },
  click: (host, _m, places, context, options) => {
    const place = anchor(places[places.length - 1]);
    if (place.snap?.kind !== 'curve') return host.say('Click the piece of a curve to remove.', true);
    runCut(host, context, 'trim', { at: place.at, curve: curveUnder(context.tool, place.at, place.snap.id), with: bound(context, options.with), repair: chosenRepair(context, options) }, 'Trim', 'Trimmed');
  },
  draw: (_places, cursor, context, options) => {
    const place = anchor(cursor);
    if (place.snap?.kind !== 'curve') return [];
    const piece = trimPiece(context.tool, { at: place.at, curve: curveUnder(context.tool, place.at, place.snap.id), with: bound(context, options.with), repair: chosenRepair(context, options) });
    return piece ? [polyline(piece)] : [];
  },
};
