// The row of an imported outline (D72): the curves of a DXF or SVG file placed in the sketch.
import type { ImportedCurve, SketchOutline } from '@trymesh/engine';
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
};
