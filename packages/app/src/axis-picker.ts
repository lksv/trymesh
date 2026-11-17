// The picker of an axis (`AxisRef`): a base axis, the normal of a sketch plane led through
// a point of the sketch, or a line of a sketch (D58: an own line, construction or not, or
// a projected one; the kind is offered while a sketch has a line). The form of a pattern and the form of a joint of the mechanism (D49) use
// it; what a change does to the axis is `changeAxis` of sketch-commands.ts. A linear pattern (D53)
// uses it for a direction: only the direction of the axis counts, so it has no row of the point
// (the reference keeps the point it has, `origin` for a new one). A grid has two directions, so the
// picker of a direction takes the labels of its controls: no two controls of a form share a label.
import type { AxisRef, Id } from '@trymesh/engine';
import { h } from './dom';
import type { PanelHost } from './host';
import { type AxisChange, type AxisKind, axisKind, lineIds } from './sketch-commands';

const AXES: Record<AxisKind, string> = { X: 'Axis X', Y: 'Axis Y', Z: 'Axis Z', sketchPoint: 'Through a point of a sketch', sketchLine: 'Along a line of a sketch' };
const DIRECTIONS: Record<AxisKind, string> = { ...AXES, sketchPoint: 'The normal of a sketch plane' };
// The labels of the picker of a direction: its select, the select of its sketch, the button that
// repairs a point that is gone.
export interface DirectionLabels {
  direction: string;
  sketch: string;
  origin: string;
}
export const FIRST_DIRECTION: DirectionLabels = { direction: 'Direction', sketch: 'Sketch', origin: 'Use the origin of the sketch' };
export const SECOND_DIRECTION: DirectionLabels = { direction: 'Second direction', sketch: 'Sketch of the second direction', origin: 'Use the origin of the sketch of the second direction' };

// The rows of the picker. `sketches`: the sketches the axis may go through, in the order of the
// timeline; a sketch or a point that is not among them stays in its list marked as missing, so
// that it can be replaced. `noSketch`: the hint shown when there is no sketch to offer (empty:
// none, for a second picker of the same form).
// `direction`: the picker of a direction, with these labels and without the row of the point.
export function axisRows(host: PanelHost, axis: AxisRef, sketches: Id[], set: (change: AxisChange) => void, noSketch: string, direction?: DirectionLabels): HTMLElement[] {
  const labels = direction ? DIRECTIONS : AXES;
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const linesOf = (id: Id): Id[] => {
    const f = host.feature(id);
    return f?.type === 'sketch' ? lineIds(f) : [];
  };
  const withLines = sketches.filter((id) => linesOf(id).length > 0);
  const kinds = (Object.keys(labels) as AxisKind[]).filter((kind) => kind !== 'sketchLine' || withLines.length > 0 || axis.kind === 'sketchLine');
  const out: HTMLElement[] = [select(direction ? direction.direction : 'Axis', (value) => set({ axis: value as AxisKind }), ...kinds.map((kind) => option(kind, labels[kind], kind === axisKind(axis))))];
  if (axis.kind === 'sketchLine') {
    const own = host.feature(axis.sketch);
    const lines = sketches.includes(axis.sketch) ? linesOf(axis.sketch) : [];
    const label = (id: Id): string => (own?.type === 'sketch' && own.curves[id]?.construction ? `${id} (construction)` : own?.type === 'sketch' && own.external[id] ? `${id} (projected)` : id);
    out.push(
      select(direction ? direction.sketch : 'Sketch', (value) => set({ sketch: value }), ...withLines.map((id) => option(id, host.nameOf(id), id === axis.sketch)), withLines.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)}${sketches.includes(axis.sketch) ? '' : ' (missing)'}`, true)),
      select(direction ? `Line of the ${direction.direction.toLowerCase()}` : 'Line', (value) => set({ line: value }), ...lines.map((id) => option(id, label(id), id === axis.line)), lines.includes(axis.line) ? null : option(axis.line, `${axis.line} (missing)`, true)),
      h('p', { className: 'hint' }, direction ? 'The direction runs along the line, from its point a to its point b.' : 'The axis runs along the line, from its point a to its point b; a positive angle turns by the right-hand rule about it.'),
    );
    return out;
  }
  const sketch = axis.kind === 'sketchPoint' ? host.feature(axis.sketch) : undefined;
  const points = axis.kind === 'sketchPoint' && sketch?.type === 'sketch' && sketches.includes(axis.sketch) ? ['origin', ...Object.keys(sketch.points), ...Object.entries(sketch.external).flatMap(([id, ref]) => (ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`]))] : [];
  if (axis.kind === 'sketchPoint' && direction) {
    // The point does not matter for a direction, but the engine checks it: a point that is gone
    // (removed, or given through MCP) is offered to be replaced by the origin of the sketch.
    const gone = points.length > 0 && !points.includes(axis.point);
    out.push(
      select(direction.sketch, (value) => set({ sketch: value }), ...sketches.map((id) => option(id, host.nameOf(id), id === axis.sketch)), sketches.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)} (missing)`, true)),
      ...(gone
        ? [h('p', { className: 'issue warning' }, `The point ${axis.point} of the reference is no longer in the sketch.`), h('div', { className: 'buttons' }, h('button', { textContent: direction.origin, onclick: () => set({ point: 'origin' }) }))]
        : []),
      h('p', { className: 'hint' }, 'The direction is the normal of the sketch plane; for a sketch on a face it points out of the body.'),
    );
  } else if (axis.kind === 'sketchPoint') {
    out.push(
      select('Sketch', (value) => set({ sketch: value }), ...sketches.map((id) => option(id, host.nameOf(id), id === axis.sketch)), sketches.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)} (missing)`, true)),
      select('Point', (value) => set({ point: value }), ...points.map((id) => option(id, id === 'origin' ? 'origin of the sketch' : id, id === axis.point)), points.includes(axis.point) ? null : option(axis.point, `${axis.point} (missing)`, true)),
      h('p', { className: 'hint' }, 'The axis is the normal of the sketch plane through the point.'),
    );
  } else if (sketches.length === 0 && noSketch) out.push(h('p', { className: 'hint' }, noSketch));
  return out;
}
