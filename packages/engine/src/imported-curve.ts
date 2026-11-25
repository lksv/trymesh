// The curves of an imported outline (D72) as data: the limits of an outline, the rule of one curve
// the validator of the kind holds them to, and their box. A leaf, so that the kind
// (references/outline.ts) and the import (import/outline-formats.ts) share the rule without one
// importing the other: whatever the import answers, the validator takes.
import { splineBox } from './spline';
import type { ImportedCurve, Vec2 } from './types';
import { LENGTH_TOLERANCE } from './util';

// - `curves`: the most curves of one outline (an import beyond it is `tooLarge`, an entry beyond it
//   an invalid command).
// - `control`: the most control points of all the splines of one outline together (a spline costs
//   by its samples, not by its count).
// - `splinePoints`: of one spline, the limit of a spline of the sketch (D70).
// - `localId`: the most characters of a local ID.
// - `note`: from this many curves on, the report of an import says what a change in the sketch costs.
// - `arc`, `arcMost`: how far the two ends of a stored arc may lie off one radius: `arc` mm per mm
//   of the largest coordinate of the arc (at least 1), and never more than `arcMost` mm, a tenth of
//   the tolerance of a join (the placement puts the end on the circle of its start, which moves it
//   by that difference).
// - `listed`, `listedPoints`: how many curves `get_sketch` lists of one outline (and above how many
//   `get_document` leaves the curves out), and how many positions those curves may hold together.
// - `bytes`, `read`, `readControl`, `readSpline`: what a reader takes before it refuses with
//   `tooLarge`, checked while it reads and before the weld: the bytes of the file, the curves read
//   from the layers asked for, the control points of all the spline curves it has made so far, and
//   the control points of one DXF `SPLINE`.
export const OUTLINE_LIMITS = {
  curves: 2000,
  control: 2000,
  splinePoints: 64,
  localId: 32,
  note: 500,
  arc: 1e-9,
  arcMost: 1e-7,
  listed: 50,
  listedPoints: 500,
  bytes: 8_000_000,
  read: 8000,
  readControl: 8000,
  readSpline: 2000,
} as const;

// The texts of the validator of the kind; `what` is the path of the entry or of the curve.
export const OUTLINE_REFUSALS = {
  count: (what: string, n: number): string => `${what}.curves: an outline has 1 to ${OUTLINE_LIMITS.curves} curves, not ${n}`,
  localId: (what: string, key: string): string => `${what}.curves: "${key}" is no local ID of a curve (letters, digits and underscores, at most ${OUTLINE_LIMITS.localId}, and no name every object has)`,
  control: (what: string, n: number): string => `${what}.curves: the splines of an outline have at most ${OUTLINE_LIMITS.control} control points together, not ${n}`,
  splinePoints: (what: string): string => `${what}: a spline has 3 to ${OUTLINE_LIMITS.splinePoints} control points, a closed one at least 4`,
  splineEnds: (what: string): string => `${what}: the ends of the spline are within the length tolerance and not one place: close it by its first point again`,
  noExtent: (what: string): string => `${what}: the spline has no extent`,
  points: (what: string): string => `${what}.points: a list of positions is expected`,
  expression: (what: string): string => `${what}: a position of a stored outline is a number; an expression goes into x, y or turn of the entry`,
  noLength: (what: string): string => `${what}: the line has no length`,
  noRadius: (what: string): string => `${what}: the radius is under the length tolerance`,
  arcEnds: (what: string, off: number, most: number): string => `${what}: the start and the end of the arc are ${off} mm off one radius about its centre (at most ${most}); move the centre onto the bisector of the two`,
  arcWhole: (what: string): string => `${what}: the start and the end of the arc are one place; a whole turn is a circle`,
  missingCurves: (what: string): string => `${what}.curves: the curves of the outline are expected (the tool import_outline reads them from a file)`,
};

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polygonLength = (points: readonly Vec2[]): number => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
// A spline of an outline is closed when its last control point is its first, exactly.
export const splineClosed = (points: readonly Vec2[]): boolean => {
  const [first, last] = [points[0], points[points.length - 1]];
  return first[0] === last[0] && first[1] === last[1];
};

// How far the ends of a stored arc may lie off one radius, by the size of its coordinates.
export function arcTolerance(curve: Extract<ImportedCurve, { type: 'arc' }>): number {
  const scale = Math.max(1, ...[curve.center, curve.start, curve.end].flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
  return Math.min(OUTLINE_LIMITS.arc * scale, OUTLINE_LIMITS.arcMost);
}

// What the validator refuses of one curve whose positions are finite numbers, or undefined. The
// rule is that a curve has an extent: a line at least the length tolerance long, a radius at least
// the tolerance, an arc with its ends on one radius and not one place, a spline of 3 to 64 points
// whose control polygon is at least the tolerance long, closed only by its first point again.
export function curveProblem(curve: ImportedCurve, what: string): string | undefined {
  switch (curve.type) {
    case 'line':
      return distance(curve.a, curve.b) < LENGTH_TOLERANCE ? OUTLINE_REFUSALS.noLength(what) : undefined;
    case 'circle':
      return !(curve.radius >= LENGTH_TOLERANCE) ? OUTLINE_REFUSALS.noRadius(what) : undefined;
    case 'arc': {
      const [rs, re] = [distance(curve.start, curve.center), distance(curve.end, curve.center)];
      if (rs < LENGTH_TOLERANCE) return OUTLINE_REFUSALS.noRadius(what);
      if (curve.start[0] === curve.end[0] && curve.start[1] === curve.end[1]) return OUTLINE_REFUSALS.arcWhole(what);
      const most = arcTolerance(curve);
      return Math.abs(rs - re) > most ? OUTLINE_REFUSALS.arcEnds(what, Math.abs(rs - re), most) : undefined;
    }
    case 'spline': {
      const n = curve.points.length;
      if (n < 3 || n > OUTLINE_LIMITS.splinePoints) return OUTLINE_REFUSALS.splinePoints(what);
      const closed = splineClosed(curve.points);
      if (closed && n < 4) return OUTLINE_REFUSALS.splinePoints(what);
      if (!closed && distance(curve.points[0], curve.points[n - 1]) < LENGTH_TOLERANCE) return OUTLINE_REFUSALS.splineEnds(what);
      return polygonLength(curve.points) < LENGTH_TOLERANCE ? OUTLINE_REFUSALS.noExtent(what) : undefined;
    }
  }
}

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

// The box of a list of curves: the ends of a line, a circle whole, an arc with the points of its
// circle furthest along x and y that it passes, a spline by the box of its curve. Undefined for no
// curve.
export function outlineBox(curves: Iterable<ImportedCurve>): { min: Vec2; max: Vec2 } | undefined {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  const reach = (x: number, y: number): void => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  };
  for (const curve of curves) {
    switch (curve.type) {
      case 'line':
        reach(...curve.a);
        reach(...curve.b);
        break;
      case 'circle':
        reach(curve.center[0] - curve.radius, curve.center[1] - curve.radius);
        reach(curve.center[0] + curve.radius, curve.center[1] + curve.radius);
        break;
      case 'arc': {
        reach(...curve.start);
        reach(...curve.end);
        const r = distance(curve.start, curve.center);
        const from = Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0]);
        const sweep = positive(Math.atan2(curve.end[1] - curve.center[1], curve.end[0] - curve.center[0]) - from) || TAU;
        for (let quarter = 0; quarter < 4; quarter++) {
          const angle = (quarter * Math.PI) / 2;
          if (positive(angle - from) <= sweep) reach(curve.center[0] + r * Math.cos(angle), curve.center[1] + r * Math.sin(angle));
        }
        break;
      }
      case 'spline': {
        const [x0, y0, x1, y1] = splineBox(curve.points);
        reach(x0, y0);
        reach(x1, y1);
        break;
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}
