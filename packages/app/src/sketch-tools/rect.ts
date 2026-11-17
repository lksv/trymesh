// The tool Rectangle: two opposite corners; the engine's sketch tool draws it.
import { rectangleCommands } from '../sketch-commands';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const rect: SketchPlaceTool<undefined> = {
  label: 'Obdélník',
  hint: 'Klikněte na dva protilehlé rohy.',
  clicks: 2,
  click: (host, m, places, context) => {
    drawn(host, m, rectangleCommands(m.id, context.tool, anchor(places[0]), anchor(places[1]), host.newId));
  },
  draw: ([first], { at }) => (first ? [[first, [at[0], first[1]], at, [first[0], at[1]], first]] : []),
};
