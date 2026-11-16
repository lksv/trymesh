// The picker of an axis (`AxisRef`): a base axis, or the normal of a sketch plane led through
// a point of the sketch. The form of a pattern and the form of a joint of the mechanism (D49) use
// it; what a change does to the axis is `changeAxis` of sketch-commands.ts. A linear pattern (D53)
// uses it for a direction: only the direction of the axis counts, so it has no row of the point
// (the reference keeps the point it has, `origin` for a new one).
import type { AxisRef, Id } from '@trymesh/engine';
import { h } from './dom';
import type { PanelHost } from './host';
import { type AxisChange, type AxisKind, axisKind } from './sketch-commands';

const AXES: Record<AxisKind, string> = { X: 'Axis X', Y: 'Axis Y', Z: 'Axis Z', sketchPoint: 'Through a point of a sketch' };
const DIRECTIONS: Record<AxisKind, string> = { ...AXES, sketchPoint: 'The normal of a sketch plane' };

// The rows of the picker. `sketches`: the sketches the axis may go through, in the order of the
// timeline; a sketch or a point that is not among them stays in its list marked as missing, so
// that it can be replaced. `noSketch`: the hint shown when there is no sketch to offer.
// `direction`: the picker of a direction, labelled so and without the row of the point.
export function axisRows(host: PanelHost, axis: AxisRef, sketches: Id[], set: (change: AxisChange) => void, noSketch: string, direction = false): HTMLElement[] {
  const labels = direction ? DIRECTIONS : AXES;
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const out: HTMLElement[] = [select(direction ? 'Direction' : 'Axis', (value) => set({ axis: value as AxisKind }), ...(Object.keys(labels) as AxisKind[]).map((kind) => option(kind, labels[kind], kind === axisKind(axis))))];
  if (axis.kind === 'sketchPoint' && direction) {
    out.push(
      select('Sketch', (value) => set({ sketch: value }), ...sketches.map((id) => option(id, host.nameOf(id), id === axis.sketch)), sketches.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)} (missing)`, true)),
      h('p', { className: 'hint' }, 'The direction is the normal of the sketch plane; for a sketch on a face it points out of the body.'),
    );
  } else if (axis.kind === 'sketchPoint') {
    const sketch = host.feature(axis.sketch);
    const points = sketch?.type === 'sketch' && sketches.includes(axis.sketch) ? ['origin', ...Object.keys(sketch.points), ...Object.entries(sketch.external).flatMap(([id, ref]) => (ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`]))] : [];
    out.push(
      select('Sketch', (value) => set({ sketch: value }), ...sketches.map((id) => option(id, host.nameOf(id), id === axis.sketch)), sketches.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)} (missing)`, true)),
      select('Point', (value) => set({ point: value }), ...points.map((id) => option(id, id === 'origin' ? 'origin of the sketch' : id, id === axis.point)), points.includes(axis.point) ? null : option(axis.point, `${axis.point} (missing)`, true)),
      h('p', { className: 'hint' }, 'The axis is the normal of the sketch plane through the point.'),
    );
  } else if (sketches.length === 0) out.push(h('p', { className: 'hint' }, noSketch));
  return out;
}
