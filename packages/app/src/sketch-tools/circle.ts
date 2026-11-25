// The tool Circle: the centre and a point of the rim.
import { circleCommands } from '../sketch-commands';
import { polyline } from '../sketch-view';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const circle: SketchPlaceTool<undefined> = {
  label: 'Circle',
  hint: 'Click the centre and then a point of the rim.',
  clicks: 2,
  click: (host, m, places, context) => {
    drawn(host, m, circleCommands(m.id, context.view, anchor(places[0]), anchor(places[1]), host.newId));
  },
  draw: ([first], { at }) => (first ? [polyline({ type: 'circle', center: first, radius: Math.hypot(at[0] - first[0], at[1] - first[1]) })] : []),
};
