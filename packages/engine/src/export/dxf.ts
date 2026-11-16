// The format `dxf` (D54): the outline a plane cuts out of bodies as a DXF drawing in millimetres,
// in the form of release 12. DXF Reference, AutoCAD 2012 (Autodesk), "Writing a DXF File": no
// TABLES and no BLOCKS (a layer an entity names without a LAYER table is created by the reader),
// and entities as the example program of that chapter writes them: the type, the layer and the
// coordinates. What the reference does not state for a file of this release, the files rest on
// a reader for (design.md of 2g, "Known limits"): no handles and no subclass markers in a file that
// names `AC1009`, and a HEADER of three variables.
//
// - HEADER: `$ACADVER` AC1009 (R11 and R12, whose polyline is POLYLINE with VERTEX and SEQEND),
//   `$INSUNITS` 4 (millimetres), `$MEASUREMENT` 1 (metric).
// - ENTITIES, a loop after another in the order of the outline: a whole circle as CIRCLE (8 the
//   layer, 10, 20, 30 the centre, 40 the radius); any other loop as POLYLINE (8, 66 = 1, the dummy
//   point 10, 20, 30 = 0, 70 = 1 closed), a VERTEX per piece (8, 10, 20, 30, and for an arc piece 42
//   the bulge: the tangent of a quarter of the angle it turns by, negative clockwise) and SEQEND.
//   The first corner is not repeated: the flag closes the loop.
// - Outer loops on the layer OUTER, holes on HOLES.
// A group is two lines, the code and the value, ended by CR LF. The text is ASCII: nothing of the
// model is written but numbers.
import type { ExportFormatSpec } from './spec';
import { OUTLINE_OPTIONS, type Outline, outlineOf } from './outline';
import { decimals, plain } from './text';

declare module './spec' {
  interface ExportFormats {
    dxf: typeof OUTLINE_OPTIONS;
  }
}

export const DXF = {
  version: 'AC1009',
  insunits: 4,
  measurement: 1,
  layers: { outer: 'OUTER', hole: 'HOLES' },
} as const;

export function dxfText(outline: Outline): string {
  const lines: string[] = [];
  const group = (code: number, value: string | number): void => void lines.push(String(code), String(value));
  group(0, 'SECTION');
  group(2, 'HEADER');
  group(9, '$ACADVER');
  group(1, DXF.version);
  group(9, '$INSUNITS');
  group(70, DXF.insunits);
  group(9, '$MEASUREMENT');
  group(70, DXF.measurement);
  group(0, 'ENDSEC');
  group(0, 'SECTION');
  group(2, 'ENTITIES');
  for (const loop of outline.loops) {
    const layer = loop.hole ? DXF.layers.hole : DXF.layers.outer;
    if (loop.circle) {
      group(0, 'CIRCLE');
      group(8, layer);
      group(10, plain(loop.circle.center[0]));
      group(20, plain(loop.circle.center[1]));
      group(30, 0);
      group(40, plain(loop.circle.radius));
      continue;
    }
    group(0, 'POLYLINE');
    group(8, layer);
    group(66, 1);
    group(10, 0);
    group(20, 0);
    group(30, 0);
    group(70, 1);
    for (const piece of loop.pieces) {
      group(0, 'VERTEX');
      group(8, layer);
      group(10, plain(piece.at[0]));
      group(20, plain(piece.at[1]));
      group(30, 0);
      if (piece.turn !== 0) group(42, decimals(Math.tan(piece.turn / 4), 12));
    }
    group(0, 'SEQEND');
    group(8, layer);
  }
  group(0, 'ENDSEC');
  group(0, 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

export const dxf: ExportFormatSpec<typeof OUTLINE_OPTIONS> = {
  title: 'DXF (outline)',
  summary:
    'The outline a plane cuts out of bodies as a DXF drawing in millimetres, for laser cutting and drilling templates (the same cut as the query section). A whole circle is a CIRCLE with the centre and radius of its surface; every other loop is one closed POLYLINE with lines and arcs. ' +
    'Outer loops are on the layer OUTER, holes on the layer HOLES. The coordinates are the x and y of the plane, as the query section reports them. One file in the form of DXF release 12.',
  options: OUTLINE_OPTIONS,
  run: (context, options) => {
    const outline = outlineOf(context, options);
    const file = { path: 'outline.dxf', mediaType: 'image/vnd.dxf', bytes: new TextEncoder().encode(dxfText(outline)), about: outline.about };
    return { layout: 'file', files: [file], ...(outline.empty === undefined ? {} : { empty: outline.empty }) };
  },
};
