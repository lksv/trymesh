// The tool Arc: the centre, the start and the end, counter-clockwise.
import { arcCommands } from '../sketch-commands';
import { polyline } from '../sketch-view';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const arc: SketchPlaceTool<undefined> = {
  label: 'Arc',
  hint: 'Click the centre, the start and the end (counterclockwise).',
  clicks: 3,
  click: (host, m, places, context) => {
    drawn(host, m, arcCommands(m.id, context.view, anchor(places[0]), anchor(places[1]), anchor(places[2]), host.newId));
  },
  draw: ([first, second], { at }) => {
    if (!first) return [];
    const start = second ?? at;
    const out = [polyline({ type: 'line', a: first, b: start })];
    if (second) {
      const from = Math.atan2(start[1] - first[1], start[0] - first[0]);
      const sweep = (Math.atan2(at[1] - first[1], at[0] - first[0]) - from + 4 * Math.PI) % (2 * Math.PI);
      out.push(polyline({ type: 'arc', center: first, radius: Math.hypot(start[0] - first[0], start[1] - first[1]), from, sweep: sweep || 2 * Math.PI }));
    }
    return out;
  },
};
