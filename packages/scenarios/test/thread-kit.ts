// Helpers for the tests of threads (D76) against the real adapters: a thread as a command, a point
// fixed in a sketch, boxes, rods, plain holes, prisms over a polygon, the threads of a feature.
import type { AxisRef, Command, EdgeName, EngineState, Expr, FaceName, Id, Input, PlaneRef, ThreadFeature, ThreadResult } from '@trymesh/engine';
import { XY, addSketch, batch, circle, constrain, rectLoop, rectangle } from './kit';

type ThreadFields = Omit<Input<ThreadFeature>, 'id' | 'name' | 'suppressed' | 'type'>;
// A thread as a command, in the input form.
export const thread = (id: Id, rest: ThreadFields, index?: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'thread', ...rest } as Input<ThreadFeature>, ...(index === undefined ? {} : { index }) });
// An M6 thread with the defaults on the faces given, cosmetic, right-hand, from the end the axis points to.
export const m6 = (body: Id, faces: FaceName[], more: Partial<ThreadFields> = {}): ThreadFields => ({ body, faces, modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'backward', ...more });

// A point of a sketch fixed at (x, y).
export const point = (sketch: Id, id: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch, id, x, y },
  constrain(sketch, `${id}Fix`, { type: 'fixed', point: id, x, y }),
];
export const bore = (hole: Id, point: Id, copy?: { pattern: Id; index: number }[]): FaceName => ({ feature: hole, role: 'holeBore', point, ...(copy ? { copy } : {}) });
export const top = (feature: Id): FaceName => ({ feature, role: 'endCap' });

type Op = 'new' | 'add' | 'cut';
const extrudeOf = (id: Id, sketch: Id, loop: Id[], z0: number, z1: number, operation: Op, target?: Id): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [...loop].sort() }] }, extent: { type: 'distance', start: z0, distance: z1 - z0 }, operation, ...(target ? { targets: [target] } : {}) },
});
// A box `x0..x1 × y0..y1 × z0..z1` as an extrusion of a rectangle in its own sketch on XY.
export const box = (id: Id, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, operation: Op = 'new', target?: Id): Command =>
  batch(addSketch(`${id}S`, XY), rectangle(`${id}S`, `${id}r`, x0, y0, x1 - x0, y1 - y0, null), extrudeOf(id, `${id}S`, rectLoop(`${id}r`), z0, z1, operation, target));
// A rod about an axis parallel to Z at (x, y), from z0 to z1, as an extrusion of a circle.
export const rod = (id: Id, x: number, y: number, radius: number, z0: number, z1: number, operation: Op = 'new', target?: Id): Command =>
  batch(addSketch(`${id}S`, XY), circle(`${id}S`, `${id}c`, x, y, radius), extrudeOf(id, `${id}S`, [`${id}c`], z0, z1, operation, target));
// The side of a rod.
export const rodSide = (id: Id): FaceName => ({ feature: id, role: 'side', curve: `${id}c` });
// A prism over a polygon of a sketch on `plane` (fixed points, lines `${id}L<i>`), extruded from
// `start` by `distance` along the normal of the plane.
export function prism(id: Id, plane: PlaneRef, corners: [number, number][], start: number, distance: number, operation: Op = 'new', target?: Id): Command {
  const sketch = `${id}S`;
  const lines = corners.map((_, i) => `${id}L${i}`);
  return batch(
    { ...addSketch(sketch, XY) },
    { type: 'setSketchPlane', sketch, plane },
    ...corners.flatMap(([x, y], i) => point(sketch, `${id}P${i}`, x, y)),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: lines[i], curve: { type: 'line', a: `${id}P${i}`, b: `${id}P${(i + 1) % corners.length}` } })),
    { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [...lines].sort() }] }, extent: { type: 'distance', start, distance }, operation, ...(target ? { targets: [target] } : {}) } },
  );
}
// A plain hole of `diameter` at the points of a sketch on `plane` (XY by default), through all.
export function hole(id: Id, points: [Id, number, number][], diameter: number | Expr, target: Id, side: 'forward' | 'backward' = 'forward', plane: PlaneRef = XY, shape?: Record<string, unknown>): Command {
  return batch(addSketch(`${id}S`, XY), { type: 'setSketchPlane', sketch: `${id}S`, plane }, ...points.flatMap(([p, x, y]) => point(`${id}S`, p, x, y)), {
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'hole', sketch: `${id}S`, points: points.map(([p]) => p), shape: (shape ?? { type: 'plain', diameter }) as never, extent: { type: 'throughAll', side }, targets: [target] },
  });
}
// A blind plain hole from the plane z = 0 of XY, `depth` deep upwards (from `start`).
export function blindHole(id: Id, x: number, y: number, diameter: number, start: number, depth: number, target: Id): Command {
  return batch(addSketch(`${id}S`, XY), ...point(`${id}S`, 'p', x, y), {
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'hole', sketch: `${id}S`, points: ['p'], shape: { type: 'plain', diameter }, extent: { type: 'distance', start, distance: depth }, targets: [target] },
  });
}
export const chamfer = (id: Id, body: Id, edges: EdgeName[], distance: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'chamfer', body, edges, distance } });
export const fillet = (id: Id, body: Id, edges: EdgeName[], radius: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'fillet', body, edges, radius } });
export const combine = (id: Id, operation: 'union' | 'difference' | 'intersection', target: Id, tools: Id[], keepTools = false): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'combine', operation, target, tools, keepTools } });
export const split = (id: Id, body: Id, plane: PlaneRef, side: 'forward' | 'backward' = 'forward'): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'split', body, plane, side } });
export const plane = (id: Id, base: 'XY' | 'XZ' | 'YZ', offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: base }, offset } });
export const bodyPattern = (id: Id, body: Id, transform: Record<string, unknown>): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source: { type: 'body', body }, transform } as never });
export const featurePattern = (id: Id, features: Id[], transform: Record<string, unknown>): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source: { type: 'features', features }, transform } as never });
export const mirrorIn = (plane: 'XY' | 'XZ' | 'YZ') => ({ type: 'mirror', plane: { kind: 'base', plane } });
export const turnAbout = (axis: AxisRef, count: number) => ({ type: 'circular', axis, count, span: { type: 'full' } });
export const along = (axis: 'X' | 'Y' | 'Z', count: number, spacing: number) => ({ type: 'linear', direction: { kind: 'base', axis }, count, span: { type: 'spacing', spacing } });

export const threadsOf = (state: EngineState, feature: Id): ThreadResult[] => state.evaluation.threads.filter((t) => t.feature === feature);
export const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const statusOf = (state: EngineState, feature: Id): string => {
  const result = state.evaluation.features[feature];
  return result.status === 'error' ? `error:${result.error?.code}` : result.status === 'warning' ? `warning:${result.warnings.map((w) => w.code).join('+')}` : result.status;
};
export const messageOf = (state: EngineState, feature: Id): string => state.evaluation.features[feature].error?.message ?? '';
// A point of the helix of a thread: the middle of the crest at the angle θ, start `k` (D76, the datum).
export function helixPoint(t: ThreadResult, theta: number, k = 0): number[] {
  const turn = t.hand === 'left' ? -1 : 1;
  const s = (turn * t.pitch * t.starts * theta) / (2 * Math.PI) + k * t.pitch;
  const side = [t.axis[1] * t.zero[2] - t.axis[2] * t.zero[1], t.axis[2] * t.zero[0] - t.axis[0] * t.zero[2], t.axis[0] * t.zero[1] - t.axis[1] * t.zero[0]];
  return [0, 1, 2].map((i) => t.origin[i] + s * t.axis[i] + (t.diameter / 2) * (Math.cos(theta) * t.zero[i] + Math.sin(theta) * side[i]));
}
// How far a point lies from the helix of a thread along its axis (the nearest of its starts and
// turns) and across it (from the nominal radius).
export function offHelix(t: ThreadResult, q: readonly number[]): { along: number; across: number } {
  const turn = t.hand === 'left' ? -1 : 1;
  const side = [t.axis[1] * t.zero[2] - t.axis[2] * t.zero[1], t.axis[2] * t.zero[0] - t.axis[0] * t.zero[2], t.axis[0] * t.zero[1] - t.axis[1] * t.zero[0]];
  const d = [0, 1, 2].map((i) => q[i] - t.origin[i]);
  const s = dot(d, t.axis);
  const flat = [0, 1, 2].map((i) => d[i] - s * t.axis[i]);
  const theta = Math.atan2(dot(flat, side), dot(flat, t.zero));
  const r = (((s - (turn * t.pitch * t.starts * theta) / (2 * Math.PI)) % t.pitch) + t.pitch) % t.pitch;
  return { along: Math.min(r, t.pitch - r), across: Math.abs(Math.hypot(...flat) - t.diameter / 2) };
}
