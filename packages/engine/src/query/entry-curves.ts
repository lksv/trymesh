// The query `entryCurves` (D72): the curves of one entry of a sketch with their places, a page at a
// time; what get_sketch lists only the first of (an imported outline of 2000 curves, the copies of
// a pattern). It reads the solved sketch, no body.
import type { SketchGeometry } from '../sketch';
import { splineBox, splineThrough } from '../spline';
import type { CurveShape, Id, Vec2 } from '../types';
import { ORIGIN, has } from '../util';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const ENTRY_CURVES_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  entry: { kind: 'text', title: 'Entry', summary: 'The ID of an entry of `external` of the sketch.' },
  kind: { kind: 'choice', options: ['line', 'arc', 'circle', 'spline'], title: 'Kind', summary: 'Only the curves of this kind.', optional: true },
  from: { kind: 'number', title: 'From', summary: 'How many curves to pass over, for the next page.', optional: true, spec: { title: 'Curves to pass over', unit: 'count', integer: true, min: { value: 0 }, default: 0 } },
  max: { kind: 'number', title: 'Most curves', summary: 'The most curves to list; `total` counts them all.', optional: true, spec: { title: 'Most curves to list', unit: 'count', integer: true, min: { value: 1 }, max: { value: 500 }, default: 100 } },
} as const satisfies ArgSpecs;

// A page ends when its curves hold this many positions together, but never before its first curve.
export const ENTRY_PAGE_POSITIONS = 2500;

// A curve at its place in the sketch (mm): a line by its ends, a circle by its centre and radius, an
// arc by its centre, its ends and its sweep (rad, counter-clockwise), a spline by where it runs
// (`through` and `box`, D70), by its control points in order (`control`: the point `<id>/<i>`
// stands at `control[i]`) and whether it is closed. `regions`: it bounds regions of the sketch.
export type ListedCurve = { id: Id; regions: boolean } & (
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2; sweep: number }
  | { type: 'spline'; through: Vec2[]; box: [number, number, number, number]; control: Vec2[]; closed: boolean }
);
// - `status`: `unavailable` when the sketch did not evaluate, `noEntry` when it has no such entry;
//   `curves` is then empty.
// - `total`: the curves of the entry of the kind asked for; `from`: the number passed over.
// - `next`: the `from` of the next page, `total` when the page reached the end. A curve without a
//   position yet (a copy whose point is not solved) is passed over and not listed, so `next` is not
//   always `from` plus the curves listed.
export interface EntryCurvesResult {
  status: 'ok' | 'unavailable' | 'noEntry';
  total: number;
  from: number;
  next: number;
  curves: ListedCurve[];
}

declare module './spec' {
  interface Queries {
    entryCurves: { spec: typeof ENTRY_CURVES_ARGS; result: EntryCurvesResult };
  }
}

// A curve of a solved sketch at its place, or undefined while a point of it has no position.
export function listedCurve(id: Id, shape: CurveShape, regions: boolean, geometry: SketchGeometry): ListedCurve | undefined {
  const at = (point: Id): Vec2 | undefined => (point === ORIGIN ? [0, 0] : has(geometry.points, point) ? [geometry.points[point].x, geometry.points[point].y] : undefined);
  switch (shape.type) {
    case 'line': {
      const [a, b] = [at(shape.a), at(shape.b)];
      return a && b ? { id, regions, type: 'line', a, b } : undefined;
    }
    case 'circle': {
      const center = at(shape.center);
      return center && has(geometry.radii, id) ? { id, regions, type: 'circle', center, radius: geometry.radii[id] } : undefined;
    }
    case 'arc': {
      const [center, start, end] = [at(shape.center), at(shape.start), at(shape.end)];
      if (!center || !start || !end) return undefined;
      const turn = Math.atan2(end[1] - center[1], end[0] - center[0]) - Math.atan2(start[1] - center[1], start[0] - center[0]);
      const sweep = ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      return { id, regions, type: 'arc', center, start, end, sweep };
    }
    case 'spline': {
      const control = shape.points.map(at);
      if (control.some((p) => p === undefined)) return undefined;
      const points = control as Vec2[];
      // a closed spline names its first point again as its last; `control` lists each once
      const closed = shape.points[0] === shape.points[shape.points.length - 1];
      return { id, regions, type: 'spline', through: splineThrough(points), box: splineBox(points), control: closed ? points.slice(0, -1) : points, closed };
    }
  }
}
const positions = (curve: ListedCurve): number => (curve.type === 'spline' ? curve.control.length + curve.through.length : curve.type === 'arc' ? 3 : curve.type === 'line' ? 2 : 1);

export const entryCurves: QuerySpec<typeof ENTRY_CURVES_ARGS, EntryCurvesResult> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'The curves of an entry of a sketch',
  summary:
    'The curves of one entry of `external` of a sketch at their places, a page at a time: of an imported outline (get_sketch lists its first curves only), of a projection, or the copies of a mirror or pattern. A spline comes with its control points (`control`: `<id>/<i>` stands at `control[i]`), which constraints and projections may name, and where it runs.',
  returns:
    '`status` (ok, unavailable, noEntry), `total` (the curves of the kind asked for), `from`, `next` (the `from` of the next page; `total` at the end), and `curves`, each with its `id`, `regions` and its place in mm in the sketch: a line `a`, `b`; a circle `center`, `radius`; an arc `center`, `start`, `end`, `sweep` (rad, counter-clockwise); a spline `through`, `box`, `control`, `closed`. A page ends at `max` curves or when they hold 2500 positions, but never before its first curve: ask again with `from: next` for the rest.',
  args: ENTRY_CURVES_ARGS,
  run: (context, { sketch, entry, kind, from, max }) => {
    const state = context.sketch(sketch);
    if (!state) return { status: 'unavailable', total: 0, from, next: from, curves: [] };
    if (!has(state.feature.external, entry)) return { status: 'noEntry', total: 0, from, next: from, curves: [] };
    const all = context.memo([state], `entryCurves ${entry} ${kind ?? ''}`, () => [...state.curves.values()].filter((curve) => (curve.id === entry || curve.id.startsWith(`${entry}/`)) && (kind === undefined || curve.shape.type === kind)));
    const curves: ListedCurve[] = [];
    let held = 0;
    let next = Math.min(from, all.length);
    for (; next < all.length; next++) {
      if (curves.length >= max) break;
      const curve = all[next];
      const listed = listedCurve(curve.id, curve.shape, curve.regions, state.geometry);
      if (!listed) continue;
      const count = positions(listed);
      if (curves.length > 0 && held + count > ENTRY_PAGE_POSITIONS) break;
      curves.push(listed);
      held += count;
    }
    return { status: 'ok', total: all.length, from, next, curves };
  },
};
