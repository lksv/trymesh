// The tool Polygon: the centre and a vertex; the engine's sketch tool draws it. Its options are the
// number of sides and whether the drawn size gets a dimension.
import { MAX_POLYGON_SIDES, type Vec2 } from '@trymesh/engine';
import { h } from '../dom';
import { DEFAULT_POLYGON, type PolygonOptions, polygonCommands, polygonSizeKind } from '../sketch-commands';
import { polyline } from '../sketch-view';
import { type SketchPlaceTool, anchor, drawn } from './spec';

export const polygon: SketchPlaceTool<PolygonOptions> = {
  label: 'Polygon',
  hint: 'Click the centre and then a vertex; the number of sides is set in the panel.',
  clicks: 2,
  click: (host, m, places, context, options) => {
    drawn(host, m, polygonCommands(m.id, context.tool, anchor(places[0]), anchor(places[1]), options, host.newId));
  },
  draw: ([first], { at }, _context, options) => {
    if (!first) return [];
    // the circumscribed circle and the polygon with its first vertex at the cursor
    const [radius, direction, sides] = [Math.hypot(at[0] - first[0], at[1] - first[1]), Math.atan2(at[1] - first[1], at[0] - first[0]), options.sides];
    return [
      polyline({ type: 'circle', center: first, radius }),
      Array.from({ length: sides + 1 }, (_, i): Vec2 => [first[0] + radius * Math.cos(direction + (2 * Math.PI * i) / sides), first[1] + radius * Math.sin(direction + (2 * Math.PI * i) / sides)]),
    ];
  },
  // The options, shown while the tool is active: the number of sides and whether the drawn size
  // gets a dimension (rounded to 0.01 mm, like a dimension added by hand).
  options: {
    initial: DEFAULT_POLYGON,
    panel: (host, value, store) => {
      const set = (change: Partial<PolygonOptions>) => {
        store({ ...value, ...change });
        host.renderPanel();
        host.renderScene();
      };
      const sides = h('input', {
        type: 'number',
        min: '3',
        max: String(MAX_POLYGON_SIDES),
        step: '1',
        value: String(value.sides),
        onchange: () => {
          const count = Number(sides.value);
          // a number outside the range of the tool leaves the count as it was
          set(Number.isInteger(count) && count >= 3 && count <= MAX_POLYGON_SIDES ? { sides: count } : {});
        },
      });
      const kind = polygonSizeKind(value);
      const option = (choice: PolygonOptions['sizeKind'], label: string, disabled = false) => h('option', { value: choice, textContent: label, selected: kind === choice, disabled });
      const size = h(
        'select',
        { onchange: () => set({ sizeKind: size.value as PolygonOptions['sizeKind'] }) },
        option('none', 'No dimension'),
        option('circumscribed', 'Diameter of the circumscribed circle'),
        option('acrossFlats', 'Size across flats (even number of sides)', value.sides % 2 === 1),
      );
      return [
        h('h2', {}, 'Polygon'),
        h('label', {}, `Sides (3 to ${MAX_POLYGON_SIDES})`, sides),
        h('label', {}, 'Dimension of the size', size),
        h('p', { className: 'hint' }, 'Click the centre, then a vertex. The polygon is a construction circle with the vertices on it and sides of the same length; a dimension takes the size as drawn and is edited in the list of constraints. Draw it turned as it should be: a constraint on a side then holds it, but one that has to turn it far can leave it folded.'),
      ];
    },
  },
};
