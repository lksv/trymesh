// The tool Spline (D70): the control points one click after another; Enter draws the spline
// through them, a click on the first place again (with at least three kept) closes it, Escape drops
// them. A second place beyond the end of a line at the first place is moved onto the line's
// extension (the mode's inferred direction `extension`), and the batch holds it on the line, so the
// spline runs on smoothly from it.
import { PICK_REACH } from '../host';
import { SPLINE_TOOL_PROBLEMS, repeatsPlace, splineCommands } from '../sketch-commands';
import { dist, splineShape } from '../sketch-view';
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
    if (!closing) {
      // a point picked twice is refused at the click, and the places before it stay
      if (repeatsPlace(context.view, kept.map(anchor), anchor(last))) {
        host.say(SPLINE_TOOL_PROBLEMS.twice(places.length), true);
        return kept;
      }
      return places;
    }
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
    // the rule of the view (`splineShape`), once the control points are not all at one place
    if (control.length >= 3 && control.some((p) => p[0] !== control[0][0] || p[1] !== control[0][1])) {
      const shape = splineShape(control);
      if (shape.type === 'spline') out.push(shape.points);
    }
    return out;
  },
};
