// The tool Point: a point at the click, tied to what the click snapped to.
import { pointCommands } from '../sketch-commands';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const point: SketchPlaceTool<undefined> = {
  label: 'Point',
  hint: 'Click the place of the point.',
  click: (host, m, places, context) => {
    drawn(host, m, pointCommands(m.id, context.view, anchor(places[places.length - 1]), host.newId));
  },
};
