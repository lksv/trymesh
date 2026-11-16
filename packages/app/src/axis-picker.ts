// The picker of an axis (`AxisRef`): a base axis, or the normal of a sketch plane led through
// a point of the sketch. The form of a pattern and the form of a joint of the mechanism (D49) use
// it; what a change does to the axis is `changeAxis` of sketch-commands.ts.
import type { AxisRef, Id } from '@trymesh/engine';
import { h } from './dom';
import type { PanelHost } from './host';
import { type AxisChange, type AxisKind, axisKind } from './sketch-commands';

const AXES: Record<AxisKind, string> = { X: 'Axis X', Y: 'Axis Y', Z: 'Axis Z', sketchPoint: 'Through a point of a sketch' };

// The rows of the picker. `sketches`: the sketches the axis may go through, in the order of the
// timeline; a sketch or a point that is not among them stays in its list marked as missing, so
// that it can be replaced. `noSketch`: the hint shown when there is no sketch to offer.
export function axisRows(host: PanelHost, axis: AxisRef, sketches: Id[], set: (change: AxisChange) => void, noSketch: string): HTMLElement[] {
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const out: HTMLElement[] = [select('Axis', (value) => set({ axis: value as AxisKind }), ...(Object.keys(AXES) as AxisKind[]).map((kind) => option(kind, AXES[kind], kind === axisKind(axis))))];
  if (axis.kind === 'sketchPoint') {
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
