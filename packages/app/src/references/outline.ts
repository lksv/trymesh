// The row of an imported outline (D72): the curves of a DXF or SVG file placed in the sketch.
import { type ImportedCurve, type SketchOutline, OUTLINE_PLACE, OUTLINE_TURN } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

const KINDS: [ImportedCurve['type'], string, string][] = [
  ['line', 'line', 'lines'],
  ['arc', 'arc', 'arcs'],
  ['circle', 'circle', 'circles'],
  ['spline', 'spline', 'splines'],
];

// "board.dxf: 4 lines, 4 arcs, 4 circles"
export function outlineCounts(ref: SketchOutline): string {
  const counts = new Map<ImportedCurve['type'], number>();
  for (const curve of Object.values(ref.curves)) counts.set(curve.type, (counts.get(curve.type) ?? 0) + 1);
  return KINDS.flatMap(([type, one, many]) => {
    const n = counts.get(type) ?? 0;
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  }).join(', ');
}

export const outline: ReferenceUi<SketchOutline> = {
  title: () => 'Outline',
  detail: (ref) => (ref.name ? `${ref.name}: ${outlineCounts(ref)}` : outlineCounts(ref)),
  tag: 'imported',
  // the place, each field a number or an expression, and what stands at it
  form: () => [
    { kind: 'number', path: 'x', title: 'X', spec: OUTLINE_PLACE },
    { kind: 'number', path: 'y', title: 'Y', spec: OUTLINE_PLACE },
    { kind: 'number', path: 'turn', title: 'Turn', spec: OUTLINE_TURN },
    {
      kind: 'choice',
      path: 'anchor',
      title: 'At (x, y)',
      options: [
        { value: 'origin', label: 'origin of the file' },
        { value: 'center', label: 'centre' },
      ],
      set: (input, value) => ({ ...(input as object), anchor: value }),
    },
  ],
  // the kind takes a partial update: the one field is sent
  flag: {
    label: 'regions',
    title: 'The curves of the outline bound regions of this sketch',
    get: (ref) => ref.regions,
    set: (_, on) => ({ type: 'outline', regions: on }) as unknown as SketchOutline,
  },
  inModel: true,
  file: { label: 'Replace file…', title: 'Read a revised file into this outline: its IDs are kept by kind and order, and the draft shows what stays, comes and goes before anything is sent' },
};
