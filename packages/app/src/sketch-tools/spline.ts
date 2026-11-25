// The tool Spline (D70): the control points one click after another; Enter draws the spline
// through them, a click on the first place again (with at least three kept) closes it, Escape drops
// them. A second place beyond the end of a line at the first place is moved onto the line's
// extension (the mode's inferred direction `extension`), and the batch holds it on the line, so the
// spline runs on smoothly from it.
import { splinePolyline } from '@trymesh/engine';
import { PICK_REACH } from '../host';
import { splineCommands } from '../sketch-commands';
import { VIEW_TOLERANCE, dist } from '../sketch-view';
import { type Place, type SketchPlaceTool, anchor, drawn, placePosition } from './spec';

export const spline: SketchPlaceTool<undefined> = {
  label: 'Spline',
  hint: 'Click the control points; Enter ends the spline, a click on the first point closes it, Esc drops it. Start at the end of a line and click on its extension to run on smoothly from it.',
  infer: 'extension',
  click: (host, m, places, context) => {
    const kept = places.slice(0, -1);
    const last = places[places.length - 1];
    // the closing click is told by position: the first place is seldom a point of the sketch yet
    const closing = kept.length >= 3 && dist(placePosition(context.view, last), placePosition(context.view, kept[0])) <= PICK_REACH * host.pixelSize();
    if (!closing) return places;
    const batch = splineCommands(m.id, context.view, kept.map(anchor), true, host.newId);
    if ('problem' in batch) {
      host.say(batch.problem, true);
      return kept;
    }
    drawn(host, m, batch.commands);
  },
  finish: (host, m, places, context): Place[] | void => {
    const batch = splineCommands(m.id, context.view, places.map(anchor), false, host.newId);
    if ('problem' in batch) {
      host.say(batch.problem, true);
      return places;
    }
    drawn(host, m, batch.commands);
  },
  draw: (places, cursor) => {
    const control = [...places, cursor.at];
    if (control.length < 2) return [];
    const out = [control];
    if (control.length >= 3) {
      const size = Math.max(...control.map((p) => dist(p, control[0])));
      if (size > 0) out.push(splinePolyline(control, VIEW_TOLERANCE * size));
    }
    return out;
  },
};
