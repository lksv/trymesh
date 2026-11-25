// The tool Line: a chain of lines. A free end goes on as the start of the next line until the
// chain ends on an existing point or by Escape; a second click nearly horizontal or vertical from
// the first adds that constraint.
import { lineCommands } from '../sketch-commands';
import { polyline } from '../sketch-view';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const line: SketchPlaceTool<undefined> = {
  label: 'Line',
  hint: 'Click the ends of the lines; Esc or joining an existing point ends the chain.',
  clicks: 2,
  infer: true,
  click: (host, m, places, context) => {
    const [from, to] = places.map(anchor);
    const made = lineCommands(m.id, context.view, from, to, host.newId, m.infer === 'extension' ? undefined : m.infer);
    // řetěz pokračuje z konce, dokud se nenapojí na existující bod
    if (made && drawn(host, m, made.commands) && to.snap?.kind !== 'point') return [{ at: to.at, snap: { kind: 'point', id: made.end } }];
  },
  draw: ([first], cursor) => (first ? [polyline({ type: 'line', a: first, b: cursor.at })] : []),
};
