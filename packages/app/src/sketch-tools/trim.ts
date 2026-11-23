// The tool Trim (D65): a click on a curve removes the piece of it under the click, between the
// neighbouring curves that cross it; the piece is drawn dashed while the pointer moves over it.
import { trimPiece } from '@trymesh/engine';
import { polyline } from '../sketch-view';
import { ownCurve, runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const trim: SketchPlaceTool<undefined> = {
  label: 'Trim',
  hint: 'Click the piece of a curve to remove; the curves that cross the outline are cut there first. Crossings of an invalid profile are marked; Split crossings (the tool Split) cuts them all.',
  picks: 'curve',
  eligible: ownCurve,
  click: (host, _m, places, context) => {
    const place = anchor(places[places.length - 1]);
    if (place.snap?.kind !== 'curve') return host.say('Click the piece of a curve to remove.', true);
    runCut(host, context, 'trim', { curve: place.snap.id, at: place.at }, 'Trim', 'Trimmed');
  },
  draw: (_places, cursor, context) => {
    const place = anchor(cursor);
    if (place.snap?.kind !== 'curve') return [];
    const piece = trimPiece(context.tool, { curve: place.snap.id, at: place.at });
    return piece ? [polyline(piece)] : [];
  },
};
