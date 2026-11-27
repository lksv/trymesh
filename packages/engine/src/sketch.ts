// Sketch: the input of the solver and the stamp, reference dimensions, detection of profiles and
// regions. The rules are in docs/architecture/sketch.md, sections "Sketch" and "Solving the
// sketch", and docs/architecture/naming.md, section "Profiles and regions".
import type { GeometrySource, ResolvedReference } from './references/spec';
import { AXES_GEOMETRY, constraintOperands, isDimension } from './sketch-content';
import { bezierStartCurvature, splineBeziers, splinePolyline } from './spline';
import type { Constraint, Curve, CurveShape, Id, Point2, RegionRef, SketchFeature, SketchResult, SolveInput, StoredValue, Vec2 } from './types';
import { AXIS_REACH, LENGTH_TOLERANCE, ORIGIN, ORIGIN_AXES, cross2, dist2, dot2, fingerprint, has, isOriginAxis, len2, stableStringify, sub2, unreachable } from './util';

// The positions used: own points, the origin and the points of projected geometry; the radii of
// circles including projected ones.
export interface SketchGeometry {
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
}

// ---------------------------------------------------------------- the curves of a sketch (D64, part 2)

// A curve of a sketch as the profile, the sides of a profile and the wall read it: its shape over
// IDs of points (positions in `SketchGeometry.points`, the radius of a circle in `radii`), where it
// comes from, and whether it forms regions (an own curve when it is not a construction curve; an
// entry's curve when its kind says so, `EntryGeometry.regions`).
export interface SketchCurve {
  id: Id;
  shape: CurveShape;
  source: GeometrySource;
  regions: boolean;
}

// The axes of the origin as curves of the list (D71): reference geometry that forms no regions.
// Made here once; `sketchCurves` and `solvedCurves` append them, and nothing else does.
export const AXIS_CURVES: readonly SketchCurve[] = ORIGIN_AXES.map((id) => ({ id, shape: AXES_GEOMETRY.curves[id], source: 'reference', regions: false }));

const ownCurves = (feature: SketchFeature): SketchCurve[] =>
  Object.entries(feature.curves).map(([id, c]) => {
    const { construction, ...shape } = c;
    return { id, shape: shape as CurveShape, source: 'own', regions: construction !== true };
  });

// The curves of a sketch: the own ones, then those of the resolved entries of `external`, then the
// two axes of the origin, in every sketch whatever its constraints (once, also when the solver had
// them under the key `origin`). The order does not matter to a reader: the profile sorts the curves
// that form regions by ID.
export function sketchCurves(feature: SketchFeature, references: Record<Id, ResolvedReference>): SketchCurve[] {
  const out = ownCurves(feature);
  for (const [key, reference] of Object.entries(references)) {
    if (key === ORIGIN) continue;
    const { curves, regions } = reference.geometry;
    for (const [id, shape] of Object.entries(curves)) out.push({ id, shape, source: 'reference', regions: regions.includes(id) });
  }
  out.push(...AXIS_CURVES);
  return out;
}

// The curves and the positions of a solved sketch as the state of the recompute holds them
// (`SketchState.curves` and `geometry`), for a reader that has only the sketch and its result (the
// sketch tools, the app's view; 6e's `toolBase` is built on it).
// - The curves: the own curves of the sketch given, the curves of `result.curves` whatever their
//   source, and the two axes of the origin.
// - The positions: those of the result, the far points of the axes, and for a point (or the radius
//   of a circle) of the sketch that the result does not have, the one the sketch holds. A tool
//   gives the sketch after its batch with the result from before it, so what the batch added is
//   found there.
// - Without a result (the sketch did not evaluate): the own curves and the axes over the positions
//   of the sketch.
export interface SolvedCurves {
  curves: Map<Id, SketchCurve>;
  geometry: SketchGeometry;
}
export function solvedCurves(sketch: SketchFeature, result: SketchResult | undefined): SolvedCurves {
  const curves = new Map(ownCurves(sketch).map((curve) => [curve.id, curve]));
  for (const [id, curve] of Object.entries(result?.curves ?? {})) curves.set(id, { id, shape: curve.shape, source: curve.source, regions: curve.regions });
  for (const curve of AXIS_CURVES) curves.set(curve.id, curve);
  const points: Record<Id, Point2> = { [ORIGIN]: { x: 0, y: 0 }, ...sketch.points, ...result?.points, ...AXES_GEOMETRY.points };
  const radii: Record<Id, number> = { ...sketch.radii, ...result?.radii };
  return { curves, geometry: { points, radii } };
}

// The two ends a reader that takes a line as the stretch between them uses: for an axis of the
// origin the points at ∓AXIS_REACH along it (an axis is a whole line, though its curve in the list
// is the millimetre from `origin` to its far point), for any other line the positions of its `a`
// and `b`; undefined when the curve is no line or a point of it has no position. The snap of a
// sketch tool, the contact search of the tools that cut (6e) and the app's hit test read a line
// through it; a reader of the direction or the carrier of a line (the solver, `measure`, the axis
// of a feature) reads `a` and `b` as for any line. The shape made so has no vertex at its ends:
// they are no points of the sketch.
export function lineExtent(curve: SketchCurve, geometry: SketchGeometry): { a: Point2; b: Point2 } | undefined {
  if (curve.shape.type !== 'line') return undefined;
  if (isOriginAxis(curve.id)) return curve.id === 'origin/x' ? { a: { x: -AXIS_REACH, y: 0 }, b: { x: AXIS_REACH, y: 0 } } : { a: { x: 0, y: -AXIS_REACH }, b: { x: 0, y: AXIS_REACH } };
  const [a, b] = [geometry.points[curve.shape.a], geometry.points[curve.shape.b]];
  return a && b ? { a, b } : undefined;
}

// The pairs of points that may join: the operands of every `coincident` of the sketch. (The pairs
// an entry declares and the points of entries with the same join key come after them, D64; no kind
// of today has any.)
export function joinPairs(feature: SketchFeature, _references: Record<Id, ResolvedReference>): [Id, Id][] {
  return Object.values(feature.constraints).flatMap((c): [Id, Id][] => (c.type === 'coincident' ? [[c.a, c.b]] : []));
}

// Joining of points: the same point, or a pair (constraint coincident) that is satisfied in the
// positions used. Transitive, it goes through the origin and projected points too. The answer is
// the vertex of a point: the point with the smallest ID of those it is joined with. The profile of
// a sketch and the chain of a wall (recompute/outline.ts) join points by this rule.
export function joinsOf(pairs: readonly [Id, Id][], geometry: SketchGeometry): (id: Id) => Id {
  const parent = new Map<Id, Id>(Object.keys(geometry.points).map((id) => [id, id]));
  const find = (id: Id): Id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as Id;
    return root;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    if (dist2(xy(geometry.points[a]), xy(geometry.points[b])) > LENGTH_TOLERANCE) continue;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  return find;
}

// The joins of the own content: the coincident pairs (the fillet's corner, and the tests).
export const pointJoins = (sketch: SketchFeature, geometry: SketchGeometry): ((id: Id) => Id) => joinsOf(joinPairs(sketch, {}), geometry);

// One end of a curve as a reader gives it: the key of its vertex and its position.
export interface CurveEnd {
  key: string;
  p: Vec2;
}
// A curve with its positions: the one function that the profile, the side of a profile
// (`curveOf` of recompute/profile.ts) and the wall read a curve through. `end` reads the position
// of an end (the profile and the wall at the joined vertex, the side raw), `centre` the position of
// a centre (raw everywhere); undefined when a point or the radius of a circle has no position.
// An arc runs counter-clockwise from `a` at the angle `start` by `sweep` in (0, 2π]. A spline
// (D70) has its ends read as a line's and its control points between them raw, as a centre is:
// `control[0]` is `a.p` and the last is `b.p`.
export type PlacedCurve =
  | { type: 'line'; a: CurveEnd; b: CurveEnd }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; a: CurveEnd; b: CurveEnd; center: Vec2; radius: number; start: number; sweep: number }
  | { type: 'spline'; a: CurveEnd; b: CurveEnd; control: Vec2[] };
export function placedCurve(curve: SketchCurve, radii: Record<Id, number>, end: (id: Id) => CurveEnd | undefined, centre: (id: Id) => Vec2 | undefined): PlacedCurve | undefined {
  const shape = curve.shape;
  switch (shape.type) {
    case 'line': {
      const [a, b] = [end(shape.a), end(shape.b)];
      return a && b ? { type: 'line', a, b } : undefined;
    }
    case 'circle': {
      const center = centre(shape.center);
      const radius = has(radii, curve.id) ? radii[curve.id] : undefined;
      return center && radius !== undefined ? { type: 'circle', center, radius } : undefined;
    }
    case 'arc': {
      const [a, b, center] = [end(shape.start), end(shape.end), centre(shape.center)];
      if (!a || !b || !center) return undefined;
      const start = Math.atan2(a.p[1] - center[1], a.p[0] - center[0]);
      const sweep = positive(Math.atan2(b.p[1] - center[1], b.p[0] - center[0]) - start) || TAU;
      return { type: 'arc', a, b, center, radius: dist2(a.p, center), start, sweep };
    }
    case 'spline': {
      const n = shape.points.length;
      const [a, b] = [end(shape.points[0]), end(shape.points[n - 1])];
      const inner = shape.points.slice(1, n - 1).map(centre);
      if (!a || !b || inner.some((p) => p === undefined)) return undefined;
      return { type: 'spline', a, b, control: [a.p, ...(inner as Vec2[]), b.p] };
    }
    default:
      return unreachable(shape, 'curve');
  }
}

// The two points a curve names at its ends: a line's `a`, `b`; an arc's `start`, `end`; a spline's
// first and last control point (one point twice when it is closed); a circle has none.
export function curveEnds(shape: CurveShape): [Id, Id] | undefined {
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'arc':
      return [shape.start, shape.end];
    case 'spline':
      return [shape.points[0], shape.points[shape.points.length - 1]];
    case 'circle':
      return undefined;
    default:
      return unreachable(shape, 'curve');
  }
}

// ---------------------------------------------------------------- the input of the solver

export interface SolverSetup {
  input: SolveInput; // without dragging
  stamp: string; // fingerprint of the inputs: curves, driving constraints, values of projected geometry
  skipped: Id[]; // constraints left out because their projected geometry has no valid values
}

// `references`: the resolved entries of `external` (fresh or frozen values and their geometry,
// references/index.ts), and the axes of the origin under the key `origin` when a constraint names
// one (no value). Their points and curves enter the input in the order of the keys, and every point
// and circle of them is fixed in that order; the stamp holds the values of the entries by entry ID
// (the axes reach it only through the curves of the input).
export function solverSetup(sketch: SketchFeature, references: Record<Id, ResolvedReference>): SolverSetup {
  const points: Record<Id, Point2> = { [ORIGIN]: { x: 0, y: 0 }, ...sketch.points };
  const radii: Record<Id, number> = { ...sketch.radii };
  const curves: Record<Id, Curve> = {};
  const fixed: Id[] = [ORIGIN];
  for (const [id, c] of Object.entries(sketch.curves)) {
    const { construction: _construction, ...shape } = c;
    curves[id] = shape as Curve;
  }
  for (const id of Object.keys(references).sort()) {
    // of an entry whose input is narrowed (an outline, D72), what the constraints name
    const geometry = references[id].solver ?? references[id].geometry;
    Object.assign(points, geometry.points);
    Object.assign(radii, geometry.radii);
    Object.assign(curves, geometry.curves);
    fixed.push(...Object.keys(geometry.points), ...Object.keys(geometry.curves).filter((curve) => geometry.curves[curve].type === 'circle'));
  }
  const constraints: Record<Id, Constraint> = {};
  const skipped: Id[] = [];
  for (const [id, c] of Object.entries(sketch.constraints)) {
    const available = constraintOperands(c).every((operand) => has(points, operand) || has(curves, operand));
    if (!available) skipped.push(id);
    else if (!isDimension(c) || c.driving) constraints[id] = c; // the engine computes reference dimensions
  }
  const used: Record<Id, StoredValue> = {};
  for (const id of Object.keys(sketch.external)) {
    const value = has(references, id) ? references[id].value : undefined;
    if (value) used[id] = value;
  }
  const stamp = fingerprint(stableStringify({ curves, constraints, external: used }));
  return { input: { points, radii, curves, constraints, fixed }, stamp, skipped: skipped.sort() };
}

// The sketch's own solved variables from the positions the solver returned.
export function ownVariables(sketch: SketchFeature, geometry: SketchGeometry): SketchGeometry {
  const points: Record<Id, Point2> = {};
  const radii: Record<Id, number> = {};
  for (const id of Object.keys(sketch.points)) points[id] = geometry.points[id];
  for (const id of Object.keys(sketch.radii)) radii[id] = geometry.radii[id];
  return { points, radii };
}

// ---------------------------------------------------------------- reference dimensions

const xy = (p: Point2): Vec2 => [p.x, p.y];

// The values of reference dimensions (driving: false) from the positions used. A dimension whose
// operand is missing is left out.
export function measure(sketch: SketchFeature, curves: Record<Id, Curve>, geometry: SketchGeometry): Record<Id, number> {
  const out: Record<Id, number> = {};
  const point = (id: Id): Vec2 | undefined => (has(geometry.points, id) ? xy(geometry.points[id]) : undefined);
  const line = (id: Id): [Vec2, Vec2] | undefined => {
    const c = curves[id];
    if (!c || c.type !== 'line') return undefined;
    const [a, b] = [point(c.a), point(c.b)];
    return a && b ? [a, b] : undefined;
  };
  for (const [id, c] of Object.entries(sketch.constraints)) {
    if (!isDimension(c) || c.driving) continue;
    let value: number | undefined;
    if (c.type === 'distance' || c.type === 'horizontalDistance' || c.type === 'verticalDistance') {
      const [a, b] = [point(c.a), point(c.b)];
      if (a && b) value = c.type === 'distance' ? dist2(a, b) : c.type === 'horizontalDistance' ? b[0] - a[0] : b[1] - a[1];
    } else if (c.type === 'distancePointLine') {
      const [p, l] = [point(c.point), line(c.line)];
      if (p && l) value = Math.abs(cross2(sub2(l[1], l[0]), sub2(p, l[0]))) / dist2(l[0], l[1]);
    } else if (c.type === 'distanceLineLine') {
      // from the point a of the line a to the line b, as the solver holds it (D75)
      const [a, b] = [line(c.a), line(c.b)];
      if (a && b) value = Math.abs(cross2(sub2(b[1], b[0]), sub2(a[0], b[0]))) / dist2(b[0], b[1]);
    } else if (c.type === 'distanceLineCircle') {
      // the distance of the centre from the line less the radius: negative while the circle crosses the line
      const [l, round] = [line(c.line), curves[c.curve]];
      const center = round?.type === 'circle' || round?.type === 'arc' ? point(round.center) : undefined;
      const start = round?.type === 'arc' ? point(round.start) : undefined;
      const radius = round?.type === 'circle' ? geometry.radii[c.curve] : center && start ? dist2(center, start) : undefined;
      if (l && center && radius !== undefined) value = Math.abs(cross2(sub2(l[1], l[0]), sub2(center, l[0]))) / dist2(l[0], l[1]) - radius;
    } else if (c.type === 'angle') {
      const [a, b] = [line(c.a), line(c.b)];
      if (a && b) {
        const [da, db] = [sub2(a[1], a[0]), sub2(b[1], b[0])];
        value = Math.atan2(cross2(da, db), dot2(da, db)); // from direction a to direction b, counterclockwise
      }
    } else if (c.type === 'radius' || c.type === 'diameter') {
      const curve = curves[c.curve];
      let radius: number | undefined;
      if (curve) {
        switch (curve.type) {
          case 'circle':
            radius = geometry.radii[c.curve];
            break;
          case 'arc': {
            const [center, start] = [point(curve.center), point(curve.start)];
            if (center && start) radius = dist2(center, start);
            break;
          }
          case 'line':
          case 'spline': // a spline is never an operand (D70)
            break; // a line has no radius
          default:
            unreachable(curve, 'curve');
        }
      }
      if (radius !== undefined) value = c.type === 'radius' ? radius : 2 * radius;
    }
    if (value !== undefined && Number.isFinite(value)) out[id] = value;
  }
  return out;
}

// ---------------------------------------------------------------- profiles and regions

// A closed polyline in the coordinates of the sketch. Point i has the key keys[i]; the edge from
// point i to point i + 1 comes from the curve curves[i]. An outer loop goes counterclockwise, a
// hole clockwise.
// `exact`: the curves the polyline was divided from, in the order and direction the loop passes
// them (the loops of a sketch and of a moved outline have them; a generated loop has none).
// `sampled`: the curves of the loop that have no exact form, the splines (D70), in the order the
// loop passes them; a loop with one has no `exact`.
export interface Loop {
  xy: number[];
  keys: string[];
  curves: Id[];
  exact?: OutlineCurve[];
  sampled?: Id[];
}
// One curve of a closed loop as the loop passes it; the material is on the left of the travel.
// - `key` is what `Loop.curves` holds for its edges (the ID of the sketch curve for a region);
//   `forward` says that the loop passes the curve in its own direction (a line from `a` to `b`, an
//   arc and a circle counter-clockwise).
// - A line and an arc go `from` a point `to` a point; `ends` are the keys of the two vertices, by
//   which curves are chained. An arc starts at the angle `start` and turns by `sweep`, which is
//   signed: positive is counter-clockwise.
// - A circle is a loop by itself.
export type OutlineCurve = { key: string; forward: boolean } & (
  | { type: 'line'; from: Vec2; to: Vec2; ends: [string, string] }
  | { type: 'arc'; from: Vec2; to: Vec2; ends: [string, string]; center: Vec2; radius: number; start: number; sweep: number }
  | { type: 'circle'; center: Vec2; radius: number; ccw: boolean }
);
export interface Region {
  ref: RegionRef;
  outer: Loop;
  holes: Loop[];
}
export interface Profile {
  valid: boolean; // false = curves cross or touch outside joined points
  regions: Region[];
}

type Shape =
  | { id: Id; kind: 'line'; a: string; b: string; pa: Vec2; pb: Vec2 }
  | { id: Id; kind: 'arc'; a: string; b: string; pa: Vec2; pb: Vec2; c: Vec2; r: number; start: number; sweep: number }
  | { id: Id; kind: 'circle'; c: Vec2; r: number }
  | SplineShape;
type Open = Exclude<Shape, { kind: 'circle' }>;
// A spline (D70): its polyline `pts` from `pa` to `pb` at the chord tolerance, computed once per
// curve from `control` (the first and last control points are the ends at their vertices), and
// `along`, the length of the polyline up to each of its points. The profile and the contact search
// test it piece by piece, each piece as a line.
interface SplineShape {
  id: Id;
  kind: 'spline';
  a: string;
  b: string;
  pa: Vec2;
  pb: Vec2;
  control: Vec2[];
  pts: Vec2[];
  along: number[];
}
// A shape that is not a spline: what the exact tests of a pair read.
type Exact = Exclude<Shape, SplineShape>;
function splineShape(id: Id, a: CurveEnd, b: CurveEnd, control: Vec2[], chordTolerance: number): SplineShape {
  const pts = splinePolyline(control, chordTolerance);
  const along = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + dist2(pts[k - 1], pts[k]));
  return { id, kind: 'spline', a: a.key, b: b.key, pa: a.p, pb: b.p, control, pts, along };
}
// A piece of the polyline of a spline as a line shape; its ends are no vertices of anything.
const pieceOf = (s: SplineShape, k: number): LineShape => ({ id: s.id, kind: 'line', a: '\u0000piece', b: '\u0000piece', pa: s.pts[k], pb: s.pts[k + 1] });

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

// The distance of a point from a curve.
function distanceTo(p: Vec2, s: Shape): number {
  switch (s.kind) {
    case 'spline': {
      let best = Infinity;
      for (let k = 0; k + 1 < s.pts.length; k++) best = Math.min(best, pointToSegment(p[0], p[1], s.pts[k][0], s.pts[k][1], s.pts[k + 1][0], s.pts[k + 1][1]));
      return best;
    }
    case 'line': {
      const d = sub2(s.pb, s.pa);
      const t = Math.min(1, Math.max(0, dot2(sub2(p, s.pa), d) / dot2(d, d)));
      return dist2(p, [s.pa[0] + d[0] * t, s.pa[1] + d[1] * t]);
    }
    case 'circle':
      return Math.abs(dist2(p, s.c) - s.r);
    case 'arc': {
      const radial = Math.abs(dist2(p, s.c) - s.r);
      const angle = positive(Math.atan2(p[1] - s.c[1], p[0] - s.c[0]) - s.start);
      return angle <= s.sweep ? radial : Math.min(dist2(p, s.pa), dist2(p, s.pb));
    }
    default:
      return unreachable(s, 'shape');
  }
}

const midpoint = (s: Open): Vec2 => {
  switch (s.kind) {
    case 'line':
      return [(s.pa[0] + s.pb[0]) / 2, (s.pa[1] + s.pb[1]) / 2];
    case 'arc': {
      const angle = s.start + s.sweep / 2;
      return [s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle)];
    }
    case 'spline': {
      // the point at half the length of the polyline
      const half = s.along[s.along.length - 1] / 2;
      let k = 0;
      while (k + 2 < s.along.length && s.along[k + 1] < half) k++;
      const length = s.along[k + 1] - s.along[k];
      const t = length > 0 ? (half - s.along[k]) / length : 0;
      return [s.pts[k][0] + (s.pts[k + 1][0] - s.pts[k][0]) * t, s.pts[k][1] + (s.pts[k + 1][1] - s.pts[k][1]) * t];
    }
    default:
      return unreachable(s, 'shape');
  }
};

// A shape with a centre and a radius (a circle or an arc), or undefined for a line.
type Round = Exclude<Shape, { kind: 'line' } | SplineShape>;
function roundOf(s: Shape): Round | undefined {
  switch (s.kind) {
    case 'line':
    case 'spline':
      return undefined;
    case 'circle':
    case 'arc':
      return s;
    default:
      return unreachable(s, 'shape');
  }
}

// Intersections and points of contact of carrier curves (line, circle), with a tolerance for
// tangency.
// A spline has no carrier: its pieces are tested as lines (`piecePairs`) before this is asked.
function carrierContacts(A: Shape, B: Shape, tol: number): Vec2[] {
  const noCarrier = (): never => {
    throw new Error('a spline has no carrier; its pieces are tested as lines');
  };
  switch (A.kind) {
    case 'line':
      switch (B.kind) {
        case 'line':
          return lineContacts(A, B);
        case 'circle':
        case 'arc':
          return lineRoundContacts(A, B, tol);
        case 'spline':
          return noCarrier();
        default:
          return unreachable(B, 'shape');
      }
    case 'circle':
    case 'arc':
      switch (B.kind) {
        case 'line':
          return lineRoundContacts(B, A, tol);
        case 'circle':
        case 'arc':
          return roundContacts(A, B, tol);
        case 'spline':
          return noCarrier();
        default:
          return unreachable(B, 'shape');
      }
    case 'spline':
      return noCarrier();
    default:
      return unreachable(A, 'shape');
  }
}
type LineShape = Extract<Shape, { kind: 'line' }>;
function lineContacts(A: LineShape, B: LineShape): Vec2[] {
  const [da, db] = [sub2(A.pb, A.pa), sub2(B.pb, B.pa)];
  const denominator = cross2(da, db);
  if (Math.abs(denominator) <= 1e-12 * len2(da) * len2(db)) return []; // parallel: checking the end points is enough
  const t = cross2(sub2(B.pa, A.pa), db) / denominator;
  return [[A.pa[0] + da[0] * t, A.pa[1] + da[1] * t]];
}
function lineRoundContacts(line: LineShape, round: Round, tol: number): Vec2[] {
  const d = sub2(line.pb, line.pa);
  const length = len2(d);
  const along = dot2(sub2(round.c, line.pa), d) / length;
  const foot: Vec2 = [line.pa[0] + (d[0] * along) / length, line.pa[1] + (d[1] * along) / length];
  const distance = dist2(foot, round.c);
  if (distance > round.r + tol) return [];
  if (distance >= round.r - tol) return [foot];
  const half = Math.sqrt(round.r * round.r - distance * distance) / length;
  return [
    [foot[0] + d[0] * half, foot[1] + d[1] * half],
    [foot[0] - d[0] * half, foot[1] - d[1] * half],
  ];
}
function roundContacts(P: Round, Q: Round, tol: number): Vec2[] {
  const delta = sub2(Q.c, P.c);
  const D = len2(delta);
  if (D > P.r + Q.r + tol || D < Math.abs(P.r - Q.r) - tol) return [];
  if (D <= tol) return []; // concentric with the same radius: handled separately
  const u: Vec2 = [delta[0] / D, delta[1] / D];
  if (D >= P.r + Q.r - tol) return [[P.c[0] + u[0] * P.r, P.c[1] + u[1] * P.r]]; // outer contact
  if (D <= Math.abs(P.r - Q.r) + tol) {
    const sign = P.r > Q.r ? 1 : -1; // inner contact
    return [[P.c[0] + u[0] * P.r * sign, P.c[1] + u[1] * P.r * sign]];
  }
  const along = (D * D + P.r * P.r - Q.r * Q.r) / (2 * D);
  const half = Math.sqrt(Math.max(0, P.r * P.r - along * along));
  const foot: Vec2 = [P.c[0] + u[0] * along, P.c[1] + u[1] * along];
  return [
    [foot[0] - u[1] * half, foot[1] + u[0] * half],
    [foot[0] + u[1] * half, foot[1] - u[0] * half],
  ];
}

// ---------------------------------------------------------------- the broad phase (D68)

// A box `[minX, minY, maxX, maxY]` that holds every point of a shape a pair test reads.
export type Box = [number, number, number, number];

// The box of a shape as `compatible` reads it: a line its two ends; a circle its centre and radius;
// an arc its two ends as given, the point where it ends on the circle of its first end, and the
// ends of that circle's diameters along x and y that it passes. The two ends alone are not enough,
// nor is the whole circle: the profile reads an arc as the circle of its first end between two
// angles, and in a sketch that is drawn and not solved the second end lies off that circle (a point
// within the tolerance of the arc is near the circle between the angles, or near one of its ends).
function shapeBox(s: Shape): Box {
  switch (s.kind) {
    case 'line': {
      // A line of no length has no distance to anything (`distanceTo` divides by its length), so
      // `compatible` refuses it with every shape: its box is no box, and it is paired with all.
      const d = sub2(s.pb, s.pa);
      if (dot2(d, d) === 0) return [NaN, NaN, NaN, NaN];
      return [Math.min(s.pa[0], s.pb[0]), Math.min(s.pa[1], s.pb[1]), Math.max(s.pa[0], s.pb[0]), Math.max(s.pa[1], s.pb[1])];
    }
    case 'circle':
      return [s.c[0] - s.r, s.c[1] - s.r, s.c[0] + s.r, s.c[1] + s.r];
    case 'arc': {
      const end: Vec2 = [s.c[0] + s.r * Math.cos(s.start + s.sweep), s.c[1] + s.r * Math.sin(s.start + s.sweep)];
      const points: Vec2[] = [s.pa, s.pb, end];
      for (let k = 0; k < 4; k++) {
        const angle = (k * Math.PI) / 2;
        // inclusive, so that rounding at the end of the sweep never loses a quarter point
        if (positive(angle - s.start) <= s.sweep + 1e-9) points.push([s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle)]);
      }
      return boxOf(points);
    }
    case 'spline':
      // the box of its control points, which holds the curve and every polyline of it (D70)
      return boxOf(s.control);
    default:
      return unreachable(s, 'shape');
  }
}
const boxOf = (points: readonly Vec2[]): Box => {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  return box;
};

// The pairs (i, j), i < j, of boxes that overlap once each is widened by `tolerance`, found by
// sorting the boxes along x and sweeping, in the order of the double loop over i and then j that
// they replace (`touchingCurves` answers with the first pair that fails, so the order matters). A
// box with a coordinate that is not finite is paired with every other, as the double loop would.
// Exact as a filter of `compatible`: it rejects a pair only for two rounds on one circle (their boxes
// coincide) or for a point within the tolerance of both shapes (which lies in both widened boxes).
export function nearPairs(boxes: readonly Box[], tolerance: number): [number, number][] {
  const reach = 2 * tolerance;
  const finite = (b: Box): boolean => b.every(Number.isFinite);
  const order = boxes.map((_, i) => i).filter((i) => finite(boxes[i]));
  order.sort((p, q) => boxes[p][0] - boxes[q][0] || p - q);
  const pairs: [number, number][] = [];
  for (let k = 0; k < order.length; k++) {
    const a = boxes[order[k]];
    for (let m = k + 1; m < order.length; m++) {
      const b = boxes[order[m]];
      if (b[0] > a[2] + reach) break;
      if (b[1] > a[3] + reach || b[3] < a[1] - reach) continue;
      pairs.push(order[k] < order[m] ? [order[k], order[m]] : [order[m], order[k]]);
    }
  }
  boxes.forEach((box, i) => {
    if (finite(box)) return;
    boxes.forEach((_, j) => i !== j && (finite(boxes[j]) || i < j) && pairs.push(i < j ? [i, j] : [j, i]));
  });
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

// How the profile finds the pairs to test and whether it asks a face for a hole only when the hole's
// sample lies in the face's box. The engine reads `BROAD_PHASE`; the test of the broad phase compares
// it with the double loop over every pair and every face (packages/engine/test/profile-broad.test.ts).
export interface BroadPhase {
  pairs(boxes: readonly Box[], tolerance: number): [number, number][];
  faceBoxes: boolean;
}
export const BROAD_PHASE: BroadPhase = { pairs: nearPairs, faceBoxes: true };

// The reach of a vertex two curves share: a contact within it is a contact at the vertex (a tangent
// join of a fillet lies within the tolerance for a while from its vertex).
const vertexReach = (A: Exact, B: Exact, tol: number): number => {
  const curved = [A, B].flatMap((s) => roundOf(s) ?? []);
  return 10 * tol + (curved.length ? Math.sqrt(8 * Math.max(...curved.map((s) => s.r)) * tol) : 0);
};

// The vertices two curves share, at their positions in A.
function sharedVertices(A: Shape, B: Shape): { key: string; at: Vec2 }[] {
  if (A.kind === 'circle' || B.kind === 'circle') return [];
  const out: { key: string; at: Vec2 }[] = [];
  for (const [key, at] of [[A.a, A.pa], [A.b, A.pb]] as [string, Vec2][]) if ((key === B.a || key === B.b) && !out.some((v) => v.key === key)) out.push({ key, at });
  return out;
}

// The pairs a test of two curves reads when one of them is a spline (D70): each piece of a spline as
// a line, against the other curve or against each piece of the other spline, where the boxes of the
// two meet (widened by the tolerance). With each pair the vertices of the two curves that excuse a
// contact of it: a vertex the curves share excuses a contact of a piece only when the piece starts
// within the reach of the vertex along the polyline, from the end of the spline that is the vertex.
// So the first pieces of a spline are excused beside its neighbour however short they are, and
// a spline that leaves the vertex, goes round and comes back to cross the neighbour is not.
function piecePairs(A: Shape, B: Shape, tol: number): { P: Exact; Q: Exact; shared: Vec2[] }[] {
  const shared = sharedVertices(A, B);
  const parts = (s: Shape): { shape: Exact; k: number }[] => (s.kind === 'spline' ? s.pts.slice(1).map((_, k) => ({ shape: pieceOf(s, k), k })) : [{ shape: s, k: -1 }]);
  const near = (s: Shape, k: number, key: string, reach: number): boolean => {
    if (s.kind !== 'spline') return true;
    const total = s.along[s.along.length - 1];
    return (s.a === key && s.along[k] <= reach) || (s.b === key && total - s.along[k + 1] <= reach);
  };
  const [partsA, partsB] = [parts(A), parts(B)];
  const out: { P: Exact; Q: Exact; shared: Vec2[] }[] = [];
  for (const [i, j] of boxPairs(
    partsA.map((part) => shapeBox(part.shape)),
    partsB.map((part) => shapeBox(part.shape)),
    2 * tol,
  )) {
    const [pa, pb] = [partsA[i], partsB[j]];
    const reach = vertexReach(pa.shape, pb.shape, tol);
    out.push({ P: pa.shape, Q: pb.shape, shared: shared.filter((v) => near(A, pa.k, v.key, reach) && near(B, pb.k, v.key, reach)).map((v) => v.at) });
  }
  return out;
}

// The pairs (i, j) of a box of the first list and a box of the second whose distance on each axis
// is at most `gap`, in the order of the double loop over i and then j (`compatible` stops at the
// first pair that fails). Found by sorting the boxes of both along the longer side of the box of
// all of them and sweeping, so two splines of many pieces are not tested piece against every piece
// (the review of 6d, F4). A box with a coordinate that is not finite is paired with every box of the
// other list, as the double loop would.
function boxPairs(first: readonly Box[], second: readonly Box[], gap: number): [number, number][] {
  const finite = (b: Box): boolean => b.every(Number.isFinite);
  const entries: { box: Box; side: 0 | 1; index: number }[] = [];
  const pairs: [number, number][] = [];
  first.forEach((box, index) => (finite(box) ? entries.push({ box, side: 0, index }) : second.forEach((_, j) => pairs.push([index, j]))));
  second.forEach((box, index) => (finite(box) ? entries.push({ box, side: 1, index }) : first.forEach((other, i) => finite(other) && pairs.push([i, index]))));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { box } of entries) [x0, y0, x1, y1] = [Math.min(x0, box[0]), Math.min(y0, box[1]), Math.max(x1, box[2]), Math.max(y1, box[3])];
  const [lo, hi] = x1 - x0 >= y1 - y0 ? [0, 2] : [1, 3]; // the axis of the sweep
  const [crossLo, crossHi] = [1 - lo, 3 - lo];
  entries.sort((p, q) => p.box[lo] - q.box[lo]);
  for (let k = 0; k < entries.length; k++) {
    const a = entries[k];
    for (let m = k + 1; m < entries.length; m++) {
      const b = entries[m];
      if (b.box[lo] > a.box[hi] + gap) break;
      if (a.side === b.side || b.box[crossLo] > a.box[crossHi] + gap || a.box[crossLo] > b.box[crossHi] + gap) continue;
      pairs.push(a.side === 0 ? [a.index, b.index] : [b.index, a.index]);
    }
  }
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

// May two curves in a profile meet? They may touch only in joined points.
function compatible(A: Shape, B: Shape, tol: number): boolean {
  if (A.kind === 'spline' || B.kind === 'spline') return piecePairs(A, B, tol).every(({ P, Q, shared }) => compatibleAt(P, Q, tol, shared));
  return compatibleAt(A, B, tol, sharedVertices(A, B).map((v) => v.at));
}
// The test of two exact shapes, with the positions of the vertices that excuse a contact near them.
function compatibleAt(A: Exact, B: Exact, tol: number, shared: Vec2[]): boolean {
  const curved = [A, B].flatMap((s) => roundOf(s) ?? []);
  // Concentric circles or arcs with the same radius lie on each other.
  if (curved.length === 2 && dist2(curved[0].c, curved[1].c) <= tol && Math.abs(curved[0].r - curved[1].r) <= tol) {
    if (A.kind === 'circle' || B.kind === 'circle') return false;
  }
  // Common vertices (`shared`). At a tangent joint (a fillet) the curves lie within the tolerance
  // some way from the vertex too, so a contact counts as a contact at the vertex up to a distance
  // given by the radius.
  const reach = vertexReach(A, B, tol);
  const candidates: Vec2[] = carrierContacts(A, B, tol);
  for (const s of [A, B]) if (s.kind !== 'circle') candidates.push(s.pa, s.pb, midpoint(s));
  for (const p of candidates) {
    if (distanceTo(p, A) > tol || distanceTo(p, B) > tol) continue;
    if (!shared.some((v) => dist2(p, v) <= reach)) return false;
  }
  return true;
}

// How far apart along its polyline two places of a spline must be for a contact of the two to be
// a touch of the curve with itself, in length tolerances: twice the reach of a vertex (D70).
export const SPLINE_SELF_REACH = 20;

// Where a spline crosses or touches itself, or undefined. A touch is a candidate point of one piece
// (an end, its middle, or a crossing with the other piece) within the length tolerance of another
// piece, where the two places are farther than `SPLINE_SELF_REACH` tolerances from each other along
// the polyline (the shorter way round a closed spline). The candidates are those `compatible` has
// for two lines, so a spline is valid where the chain of its pieces is; the reach along the curve is
// what a chain lacks. The answer is the candidate of a touch of the first piece along the curve that
// has one.
export function splineSelfContact(pts: readonly Vec2[], closed: boolean): Vec2 | undefined {
  const tol = LENGTH_TOLERANCE;
  const n = pts.length - 1;
  const along = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + dist2(pts[k - 1], pts[k]));
  const total = along[n];
  // the place of a point along piece k (its foot on the piece)
  const placeOn = (p: Vec2, k: number): number => {
    const [a, b] = [pts[k], pts[k + 1]];
    const d = sub2(b, a);
    const length2 = dot2(d, d);
    const t = length2 > 0 ? Math.min(1, Math.max(0, dot2(sub2(p, a), d) / length2)) : 0;
    return along[k] + t * Math.sqrt(length2);
  };
  const apart = (x: number, y: number): number => {
    const gap = Math.abs(x - y);
    return closed ? Math.min(gap, total - gap) : gap;
  };
  const order = Array.from({ length: n }, (_, k) => k).sort((p, q) => Math.min(pts[p][0], pts[p + 1][0]) - Math.min(pts[q][0], pts[q + 1][0]));
  let found: { k: number; at: Vec2 } | undefined;
  for (let x = 0; x < order.length; x++) {
    const i = order[x];
    const maxX = Math.max(pts[i][0], pts[i + 1][0]);
    for (let y = x + 1; y < order.length; y++) {
      const j = order[y];
      if (Math.min(pts[j][0], pts[j + 1][0]) > maxX + tol) break;
      if (Math.max(pts[j][1], pts[j + 1][1]) < Math.min(pts[i][1], pts[i + 1][1]) - tol || Math.min(pts[j][1], pts[j + 1][1]) > Math.max(pts[i][1], pts[i + 1][1]) + tol) continue;
      const [P, Q] = [{ id: '', kind: 'line', a: '', b: '', pa: pts[i], pb: pts[i + 1] } as LineShape, { id: '', kind: 'line', a: '', b: '', pa: pts[j], pb: pts[j + 1] } as LineShape];
      const candidates = [...lineContacts(P, Q), P.pa, P.pb, midpoint(P), Q.pa, Q.pb, midpoint(Q)];
      for (const c of candidates) {
        if (distanceTo(c, P) > tol || distanceTo(c, Q) > tol) continue;
        if (apart(placeOn(c, i), placeOn(c, j)) <= SPLINE_SELF_REACH * tol) continue;
        const first = Math.min(i, j);
        if (!found || first < found.k) found = { k: first, at: c };
        break;
      }
    }
  }
  return found?.at;
}

// ---------------------------------------------------------------- contacts as points to cut at (D65)

// Where two curves meet as points a cut can be made at: what the tools trim, extend and split read
// (sketch-cut.ts) and the query `sketchContacts`. It is built from the same carrier contacts, ends,
// tolerance and reach around a shared vertex as `compatible`, which keeps its own code; the middles
// `compatible` also tries are only a probe for an overlap, never a place to cut. Each point has
// a kind:
// - `crossing`: the carriers cross there, away from the ends of both;
// - `touch`: the carriers are tangent there (one carrier contact of a line and a round curve, or of
//   two round curves), away from the ends of both;
// - `end`: an end of one curve lies on the other away from its ends (a T). A tangent line ends on
//   a circle only to the precision of a double root (measured: 3e-5 mm from the touch of the
//   carriers), so a touch within the reach of such an end is that end's contact, marked tangent,
//   and not a second point beside it;
// - `overlap`: of two lines on one line or two arcs on one circle that share a stretch, an end of
//   one that lies strictly inside the other.
// No point of any kind lies within the reach of a vertex the two share. Each place once, an end of
// either curve before a computed point at the same place.
// - `ends`: ends of the two at one place (within the tolerance) that are not one vertex, as the
//   indices of the end of each (0 the start, 1 the end): the profile rejects them and a cut cannot
//   repair them; joining them can.
// - `lying`: the two lie on each other along a stretch (an overlap, a duplicate) or are two curves
//   of one circle of which one is a circle: the profile rejects them whatever is cut.
export type ContactKind = 'crossing' | 'touch' | 'end' | 'overlap';
export interface ContactPoint {
  at: Vec2;
  kind: ContactKind;
  tangent: boolean; // the carriers are tangent there: always for a touch, possible for an end
}
export interface CurveContacts {
  points: ContactPoint[];
  ends: [number, number][];
  lying: boolean;
}

function shapeContacts(A: Shape, B: Shape, tol: number): CurveContacts {
  if (A.kind === 'spline' || B.kind === 'spline') return splineContacts(A, B, tol);
  const endsOf = (s: Shape): [string, Vec2][] => (s.kind === 'circle' ? [] : [[s.a, s.pa], [s.b, s.pb]]);
  const [endsA, endsB] = [endsOf(A), endsOf(B)];
  const ends: [number, number][] = [];
  endsA.forEach(([ka, pa], i) => endsB.forEach(([kb, pb], j) => ka !== kb && dist2(pa, pb) <= tol && ends.push([i, j])));
  const atEnd = (p: Vec2, list: [string, Vec2][]): boolean => list.some(([, q]) => dist2(p, q) <= tol);
  const points: ContactPoint[] = [];
  const add = (at: Vec2, kind: ContactKind, tangent: boolean): void => {
    if (!points.some((q) => dist2(at, q.at) <= tol)) points.push({ at, kind, tangent });
  };
  const [roundA, roundB] = [roundOf(A), roundOf(B)];
  const sameCircle = roundA !== undefined && roundB !== undefined && dist2(roundA.c, roundB.c) <= tol && Math.abs(roundA.r - roundB.r) <= tol;
  const sameLine = A.kind === 'line' && B.kind === 'line' && lineDistance(B.pa, A) <= tol && lineDistance(B.pb, A) <= tol;
  if (sameCircle || sameLine) {
    if (A.kind === 'circle' || B.kind === 'circle') return { points: [], ends, lying: true };
    // an overlap: the ends of each strictly inside the other
    for (const [own, other] of [
      [endsA, B],
      [endsB, A],
    ] as const) {
      for (const [, p] of own) if (distanceTo(p, other) <= tol && !atEnd(p, endsOf(other))) add(p, 'overlap', false);
    }
    const lying = points.length > 0 || distanceTo(midpoint(A as Open), B) <= tol || distanceTo(midpoint(B as Open), A) <= tol;
    return { points, ends, lying };
  }
  const shared = endsA.filter(([ka]) => endsB.some(([kb]) => kb === ka)).map(([, p]) => p);
  const reach = 10 * tol + (roundA || roundB ? Math.sqrt(8 * Math.max(roundA?.r ?? 0, roundB?.r ?? 0) * tol) : 0);
  const near = (p: Vec2): boolean => distanceTo(p, A) <= tol && distanceTo(p, B) <= tol && !shared.some((v) => dist2(p, v) <= reach);
  const carrier = carrierContacts(A, B, tol);
  // the carriers touch: one contact of a line and a round curve, or of two round curves
  const touch = (roundA !== undefined || roundB !== undefined) && carrier.length === 1 ? carrier[0] : undefined;
  // the ends first, so that a T is cut at the end itself and not at a computed point beside it
  const endsOn = [...endsA, ...endsB].map(([, p]) => p).filter((p) => near(p) && !(atEnd(p, endsA) && atEnd(p, endsB)));
  const merged = touch !== undefined && endsOn.some((p) => dist2(p, touch) <= reach);
  for (const p of endsOn) add(p, 'end', merged && dist2(p, touch as Vec2) <= reach);
  for (const p of carrier) {
    if (merged || !near(p)) continue;
    if (atEnd(p, endsA) && atEnd(p, endsB)) continue; // two ends at one place: `ends`
    add(p, atEnd(p, endsA) || atEnd(p, endsB) ? 'end' : touch ? 'touch' : 'crossing', touch !== undefined);
  }
  return { points, ends, lying: false };
}

// The contacts of two curves of which one or both are splines (D70), found piece by piece on the
// polyline (`piecePairs`, with its rule of the shared vertices). A spline is not cut and holds no
// point, so these are reasons, not places to cut: `end` when the point lies at an end of one of the
// two curves (a joint of two pieces of the polyline is no end), `crossing` otherwise, never `touch`
// (a tangency of two carriers, which a polyline does not decide). A stretch of a piece along a line
// makes the pair `lying`; its points are the ends of either curve that lie inside the other.
function splineContacts(A: Shape, B: Shape, tol: number): CurveContacts {
  const endsOf = (s: Shape): [string, Vec2][] => (s.kind === 'circle' ? [] : [[s.a, s.pa], [s.b, s.pb]]);
  const [endsA, endsB] = [endsOf(A), endsOf(B)];
  const ends: [number, number][] = [];
  endsA.forEach(([ka, pa], i) => endsB.forEach(([kb, pb], j) => ka !== kb && dist2(pa, pb) <= tol && ends.push([i, j])));
  const atEnd = (p: Vec2, list: [string, Vec2][]): boolean => list.some(([, q]) => dist2(p, q) <= tol);
  const points: ContactPoint[] = [];
  const add = (at: Vec2, kind: ContactKind): void => {
    if (!points.some((q) => dist2(at, q.at) <= tol)) points.push({ at, kind, tangent: false });
  };
  let lying = false;
  for (const { P, Q, shared } of piecePairs(A, B, tol)) {
    const reach = vertexReach(P, Q, tol);
    const near = (p: Vec2): boolean => distanceTo(p, P) <= tol && distanceTo(p, Q) <= tol && !shared.some((v) => dist2(p, v) <= reach);
    if (P.kind === 'line' && Q.kind === 'line' && lineDistance(Q.pa, P) <= tol && lineDistance(Q.pb, P) <= tol) {
      // two pieces on one line: lying when they share a stretch
      const overlap = [P.pa, P.pb, midpoint(P)].some((p) => distanceTo(p, Q) <= tol) || [Q.pa, Q.pb, midpoint(Q)].some((p) => distanceTo(p, P) <= tol);
      if (overlap && [P.pa, P.pb, Q.pa, Q.pb].some((p) => near(p))) {
        lying = true;
        for (const [, p] of [...endsA, ...endsB]) if (distanceTo(p, A) <= tol && distanceTo(p, B) <= tol && !(atEnd(p, endsA) && atEnd(p, endsB))) add(p, 'overlap');
      }
      continue;
    }
    const candidates = [...[...endsA, ...endsB].map(([, p]) => p), ...carrierContacts(P, Q, tol), ...(P.kind !== 'circle' ? [P.pa, P.pb] : []), ...(Q.kind !== 'circle' ? [Q.pa, Q.pb] : [])];
    for (const p of candidates) {
      if (!near(p) || (atEnd(p, endsA) && atEnd(p, endsB))) continue; // two ends at one place: `ends`
      add(p, atEnd(p, endsA) || atEnd(p, endsB) ? 'end' : 'crossing');
    }
  }
  return { points: lying ? points.filter((p) => p.kind === 'overlap') : points, ends, lying };
}

// The distance of a point from the line (the whole line, not the segment) of a line shape.
function lineDistance(p: Vec2, s: Extract<Shape, { kind: 'line' }>): number {
  const d = sub2(s.pb, s.pa);
  const length = len2(d);
  return length === 0 ? dist2(p, s.pa) : Math.abs(cross2(d, sub2(p, s.pa))) / length;
}

// The shape of a curve of a sketch with its ends at their joined vertices (as the profile reads
// it), or undefined when it has no position or no length. A line is the stretch `lineExtent`
// gives: an axis of the origin is a whole line, whose ends are no vertex of anything.
function shapeOfCurve(curve: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): Shape | undefined {
  if (curve.shape.type === 'line' && isOriginAxis(curve.id)) {
    const extent = lineExtent(curve, geometry) as { a: Point2; b: Point2 };
    return { id: curve.id, kind: 'line', a: `\u0000${curve.id}/a`, b: `\u0000${curve.id}/b`, pa: xy(extent.a), pb: xy(extent.b) };
  }
  const vertex = (id: Id): CurveEnd | undefined => (has(geometry.points, joins(id)) ? { key: joins(id), p: xy(geometry.points[joins(id)]) } : undefined);
  const centre = (id: Id): Vec2 | undefined => (has(geometry.points, id) ? xy(geometry.points[id]) : undefined);
  const c = placedCurve(curve, geometry.radii, vertex, centre);
  if (!c) return undefined;
  switch (c.type) {
    case 'circle':
      return c.radius > LENGTH_TOLERANCE ? { id: curve.id, kind: 'circle', c: c.center, r: c.radius } : undefined;
    case 'line':
      return dist2(c.a.p, c.b.p) > LENGTH_TOLERANCE ? { id: curve.id, kind: 'line', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p } : undefined;
    case 'arc':
      return dist2(c.a.p, c.b.p) > LENGTH_TOLERANCE && c.radius > LENGTH_TOLERANCE ? { id: curve.id, kind: 'arc', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p, c: c.center, r: c.radius, start: c.start, sweep: c.sweep } : undefined;
    case 'spline': {
      const shape = splineShape(curve.id, c.a, c.b, c.control, chordTolerance);
      return shape.along[shape.along.length - 1] > LENGTH_TOLERANCE ? shape : undefined;
    }
    default:
      return unreachable(c, 'curve');
  }
}

// The contacts of two curves of a sketch (`CurveContacts`), with the joins of the profile (`joins`,
// the vertex of a point). Undefined when either has no position or no length. A spline is its
// polyline at the chord tolerance of the document (D70), as in the profile.
export function curveContacts(a: SketchCurve, b: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): CurveContacts | undefined {
  const [A, B] = [shapeOfCurve(a, joins, geometry, chordTolerance), shapeOfCurve(b, joins, geometry, chordTolerance)];
  return A && B ? shapeContacts(A, B, LENGTH_TOLERANCE) : undefined;
}

// Whether two curves of a sketch touch apart from a vertex they share: the test of the profile
// (`compatible`) for one pair. A curve without a position or a length touches everything.
export function curvesTouch(a: SketchCurve, b: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): boolean {
  const [A, B] = [shapeOfCurve(a, joins, geometry, chordTolerance), shapeOfCurve(b, joins, geometry, chordTolerance)];
  return !A || !B || !compatible(A, B, LENGTH_TOLERANCE);
}

// The polyline of a curve of a sketch that is a spline, as the profile reads it (its ends at their
// joined vertices), or undefined when it is no spline or has no position (D70). The contacts of the
// query, the place a tool is given and the chain of a cut in memory read it.
export function splinePolylineOf(curve: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): Vec2[] | undefined {
  if (curve.shape.type !== 'spline') return undefined;
  const shape = shapeOfCurve(curve, joins, geometry, chordTolerance);
  return shape?.kind === 'spline' ? shape.pts : undefined;
}

// Into how many lines an arc is divided. The cap keeps a huge radius or a tiny tolerance from
// asking for millions of lines (for r/tolerance above 1e16 the step comes out as zero); above it
// the division no longer keeps the tolerance.
const MAX_SEGMENTS = 4096;
export function segments(sweep: number, radius: number, chordTolerance: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(chordTolerance / radius, 1)), Math.PI / 4);
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(sweep / step - 1e-9)));
}

// Do the regions hold up after the arcs are divided into lines too? The validity of a profile is
// checked on the exact curves, but the body is made from polylines, which differ from an arc by up
// to the tolerance of the division. A curve that closely misses an arc then crosses its polyline,
// and a region thinner than the tolerance collapses into two points. Such loops would not make a
// closed body.
export function soundTessellation(regions: Region[]): boolean {
  return tessellationProblem(regions) === undefined;
}

// Why the polygons of regions would not make a closed body, with the curves and a place (D65): a
// loop that collapses to fewer than three points (a region thinner than the chord tolerance, whose
// arc is a single chord), or two polygon edges that cross though their curves do not.
export interface TightPlace {
  curves: Id[]; // the curves of the collapsed loop, or the two whose polygon edges cross
  at: Vec2; // a place on them, in the sketch
}
function tessellationProblem(regions: Region[]): TightPlace | undefined {
  interface Segment {
    a: string;
    b: string;
    curve: Id;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    minX: number;
    maxX: number;
  }
  const seen = new Set<string>();
  const list: Segment[] = [];
  for (const region of regions) {
    for (const loop of [region.outer, ...region.holes]) {
      const count = loop.keys.length;
      if (count < 3) return { curves: [...new Set(loop.curves)].sort(), at: [loop.xy[0], loop.xy[1]] };
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const [a, b] = [loop.keys[i], loop.keys[j]];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue; // neighbouring regions share the edge
        seen.add(key);
        const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
        list.push({ a, b, curve: loop.curves[i], ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
      }
    }
  }
  // On which side of line p a point lies; lines cross when the ends of each lie on opposite sides
  // of the other.
  const side = (p: Segment, x: number, y: number): number => (p.bx - p.ax) * (y - p.ay) - (p.by - p.ay) * (x - p.ax);
  list.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length && list[j].minX <= p.maxX; j++) {
      const q = list[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue; // neighbours touch at a vertex
      if (Math.max(q.ay, q.by) < Math.min(p.ay, p.by) || Math.min(q.ay, q.by) > Math.max(p.ay, p.by)) continue;
      const [qa, qb] = [side(p, q.ax, q.ay), side(p, q.bx, q.by)];
      if (qa * qb < 0 && side(q, p.ax, p.ay) * side(q, p.bx, p.by) < 0) {
        const t = qa / (qa - qb); // where q crosses the line of p
        return { curves: [...new Set([p.curve, q.curve])].sort(), at: [q.ax + t * (q.bx - q.ax), q.ay + t * (q.by - q.ay)] };
      }
    }
  }
  return undefined;
}

// The profile of the own curves with the coincident joins (the form the tests call).
export function detectProfile(sketch: SketchFeature, geometry: SketchGeometry, chordTolerance: number): Profile {
  return profileOf(sketchCurves(sketch, {}), pointJoins(sketch, geometry), geometry, chordTolerance);
}

// Finds the regions from the curves that form them (`regions`), sorted by ID; construction and
// projected curves do not form them. `joins` gives the vertex of a point (`joinsOf`).
// `broad`: how pairs and faces are filtered (`BROAD_PHASE`; only the test of the broad phase gives
// another).
export function profileOf(curves: readonly SketchCurve[], joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number, broad: BroadPhase = BROAD_PHASE): Profile {
  return buildProfile(curves, joins, geometry, chordTolerance, broad).profile;
}

// Why a profile is invalid when no pair of its curves touches (D65): the last check of the profile
// is on the polygons a body would be built from (`soundTessellation`), and this says which curves
// and where. Undefined when the profile is valid, or invalid for a pair that touches, two ends that
// are not joined or a curve of no length (the contacts say those).
export function profileProblem(curves: readonly SketchCurve[], joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): TightPlace | undefined {
  return buildProfile(curves, joins, geometry, chordTolerance, BROAD_PHASE).tight;
}

// The direction a half of a spline leaves its vertex in (D70): to the first point where its polyline,
// walked from the vertex in the direction of the half, leaves the circle of the radius `d` about the
// vertex (the first piece that ends on or outside the circle, cut by the circle). Every half reaches
// `d` before it ends (`d` is at most half its reach), and what lies inside the circle of each curve
// is one path from the vertex to the circle, so the order of the directions is the order of the
// curves round the vertex for curves that do not cross.
export function splineDirection(pts: readonly Vec2[], forward: boolean, d: number): number {
  const walk = forward ? pts : [...pts].reverse();
  const v = walk[0];
  for (let k = 0; k + 1 < walk.length; k++) {
    const [p, q] = [sub2(walk[k], v), sub2(walk[k + 1], v)];
    if (len2(q) < d) continue;
    // |p + t (q − p)| = d, the root in (0, 1]
    const e = sub2(q, p);
    const [a, b, c] = [dot2(e, e), 2 * dot2(p, e), dot2(p, p) - d * d];
    const t = a > 0 ? Math.min(1, Math.max(0, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a))) : 1;
    return positive(Math.atan2(p[1] + e[1] * t, p[0] + e[0] * t));
  }
  const end = sub2(walk[walk.length - 1], v);
  return positive(Math.atan2(end[1], end[0]));
}

function buildProfile(curves: readonly SketchCurve[], joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number, broad: BroadPhase): { profile: Profile; tight?: TightPlace } {
  const tol = LENGTH_TOLERANCE;
  const vertex = (id: Id): CurveEnd => ({ key: joins(id), p: xy(geometry.points[joins(id)]) });
  const centre = (id: Id): Vec2 => xy(geometry.points[id]);

  const shapes: Shape[] = [];
  let valid = true;
  for (const curve of curves.filter((c) => c.regions).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))) {
    const id = curve.id;
    const c = placedCurve(curve, geometry.radii, vertex, centre);
    if (!c) {
      valid = false; // a circle without a radius (a point without a position throws in `vertex` or `centre`, as before)
      continue;
    }
    switch (c.type) {
      case 'circle':
        if (!(c.radius > tol)) valid = false;
        else shapes.push({ id, kind: 'circle', c: c.center, r: c.radius });
        continue;
      case 'line':
        if (c.a.key === c.b.key || dist2(c.a.p, c.b.p) <= tol) {
          valid = false; // a curve of zero length
          continue;
        }
        shapes.push({ id, kind: 'line', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p });
        continue;
      case 'arc':
        if (c.a.key === c.b.key || dist2(c.a.p, c.b.p) <= tol) {
          valid = false; // a curve of zero length
          continue;
        }
        if (!(c.radius > tol)) {
          valid = false;
          continue;
        }
        shapes.push({ id, kind: 'arc', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p, c: c.center, r: c.radius, start: c.start, sweep: c.sweep });
        continue;
      case 'spline': {
        // D70: its polyline; no length, or a touch of the curve with itself, makes the profile invalid
        const spline = splineShape(id, c.a, c.b, c.control, chordTolerance);
        if (!(spline.along[spline.along.length - 1] > tol) || splineSelfContact(spline.pts, spline.a === spline.b) !== undefined) {
          valid = false;
          continue;
        }
        shapes.push(spline);
        continue;
      }
      default:
        unreachable(c, 'curve');
    }
  }
  // the pairs whose boxes meet (the broad phase), each tested by `compatible`
  if (valid) {
    for (const [i, j] of broad.pairs(shapes.map(shapeBox), tol)) {
      if (compatible(shapes[i], shapes[j], tol)) continue;
      valid = false;
      break;
    }
  }
  if (!valid) return { profile: { valid: false, regions: [] } };

  // ---- the planar graph: half-edges of lines and arcs
  interface Half {
    shape: Open;
    forward: boolean; // in the direction of the curve (for an arc counterclockwise)
    from: string;
    to: string;
    angle: number; // the direction the half-edge leaves the vertex in (after sorting, the direction to a near point of the curve)
    curvature: number; // signed: positive turns left
    twin: number;
    loop: number;
  }
  let open = shapes.filter((s): s is Open => s.kind !== 'circle');
  let halves: Half[] = [];
  let loops: number[][] = [];
  for (;;) {
    halves = [];
    for (const s of open) {
      const index = halves.length;
      switch (s.kind) {
        case 'line': {
          const angle = Math.atan2(s.pb[1] - s.pa[1], s.pb[0] - s.pa[0]);
          halves.push({ shape: s, forward: true, from: s.a, to: s.b, angle, curvature: 0, twin: index + 1, loop: -1 });
          halves.push({ shape: s, forward: false, from: s.b, to: s.a, angle: positive(angle + Math.PI), curvature: 0, twin: index, loop: -1 });
          break;
        }
        case 'arc':
          halves.push({ shape: s, forward: true, from: s.a, to: s.b, angle: s.start + Math.PI / 2, curvature: 1 / s.r, twin: index + 1, loop: -1 });
          halves.push({ shape: s, forward: false, from: s.b, to: s.a, angle: s.start + s.sweep - Math.PI / 2, curvature: -1 / s.r, twin: index, loop: -1 });
          break;
        case 'spline': {
          // the curvature for a tie: that of the end of its Bezier piece, signed by the direction
          const pieces = splineBeziers(s.control);
          const last = [...pieces[pieces.length - 1]].reverse();
          halves.push({ shape: s, forward: true, from: s.a, to: s.b, angle: 0, curvature: bezierStartCurvature(pieces[0]), twin: index + 1, loop: -1 });
          halves.push({ shape: s, forward: false, from: s.b, to: s.a, angle: 0, curvature: bezierStartCurvature(last), twin: index, loop: -1 });
          break;
        }
        default:
          unreachable(s, 'shape');
      }
    }
    const outgoing = new Map<string, number[]>();
    halves.forEach((h, i) => outgoing.set(h.from, [...(outgoing.get(h.from) ?? []), i]));
    // The order of the half-edges around a vertex is taken by the direction to a point of the curve
    // a small distance from the vertex, not by the tangent: a line and an arc that leave the vertex
    // tangentially in the same direction have tangents equal up to the noise of the solver, and
    // chance would decide the order. The distance is half of the shortest curve at the vertex; the
    // chord of an arc deviates from the tangent by asin(curvature · distance / 2).
    // D70: how far a curve surely gets from the vertex (its reach) is for a line and an arc the
    // distance of its ends, for a spline the largest distance of its polyline from the vertex (for
    // a closed spline its farthest point, not its length); a spline leaves towards the first point
    // where its polyline leaves the circle of that distance about the vertex.
    const reachOf = (h: Half): number => {
      const s = h.shape;
      if (s.kind !== 'spline') return dist2(s.pa, s.pb);
      const v = h.forward ? s.pa : s.pb;
      // a loop, not a spread: a polyline can have more points than a call takes arguments
      let largest = 0;
      for (const p of s.pts) largest = Math.max(largest, dist2(p, v));
      return largest;
    };
    for (const list of outgoing.values()) {
      const distance = Math.min(...list.map((i) => reachOf(halves[i]))) / 2;
      for (const i of list) {
        const h = halves[i];
        h.angle = h.shape.kind === 'spline' ? splineDirection(h.shape.pts, h.forward, distance) : positive(h.angle + Math.asin(Math.max(-1, Math.min(1, (h.curvature * distance) / 2))));
      }
      list.sort((p, q) => halves[p].angle - halves[q].angle || halves[p].curvature - halves[q].curvature || p - q);
    }
    // The next half-edge around a face (the face on the left): at the vertex the first clockwise
    // from the opposite half-edge.
    const next = (i: number): number => {
      const list = outgoing.get(halves[i].to) as number[];
      const k = list.indexOf(halves[i].twin);
      return list[(k + list.length - 1) % list.length];
    };
    loops = [];
    halves.forEach((h, i) => {
      if (h.loop >= 0) return;
      const loop: number[] = [];
      for (let k = i; halves[k].loop < 0; k = next(k)) {
        halves[k].loop = loops.length;
        loop.push(k);
      }
      loops.push(loop);
    });
    // A curve that has the same face on both sides encloses no area: it is ignored.
    const useless = new Set(halves.filter((h) => h.loop === halves[h.twin].loop).map((h) => h.shape));
    if (useless.size === 0) break;
    open = open.filter((s) => !useless.has(s));
  }

  // The signed area of a loop: the polygon of the vertices plus the circular segments of the arcs.
  const position = new Map<string, Vec2>();
  for (const s of open) position.set(s.a, s.pa).set(s.b, s.pb);
  const areaOf = (loop: number[]): number => {
    let area = 0;
    for (const i of loop) {
      const h = halves[i];
      const s = h.shape;
      switch (s.kind) {
        case 'line':
          area += cross2(position.get(h.from) as Vec2, position.get(h.to) as Vec2) / 2;
          break;
        case 'arc':
          area += cross2(position.get(h.from) as Vec2, position.get(h.to) as Vec2) / 2;
          area += ((h.forward ? 1 : -1) * s.r * s.r * (s.sweep - Math.sin(s.sweep))) / 2; // the segment of the arc
          break;
        case 'spline': {
          // its polyline in the direction the loop passes it, in place of the chord
          let along = 0;
          for (let k = 0; k + 1 < s.pts.length; k++) along += cross2(s.pts[k], s.pts[k + 1]) / 2;
          area += h.forward ? along : -along;
          break;
        }
        default:
          unreachable(s, 'shape');
      }
    }
    return area;
  };

  // The polyline of a loop. The division of an arc does not depend on the direction of the pass,
  // so neighbouring regions share vertices.
  const polyline = (loop: number[]): Loop => {
    const exact: OutlineCurve[] = [];
    const sampled: Id[] = [];
    const out: Loop = { xy: [], keys: [], curves: [], exact };
    for (const i of loop) {
      const h = halves[i];
      const s = h.shape;
      const [start, end] = [position.get(h.from) as Vec2, position.get(h.to) as Vec2];
      out.xy.push(start[0], start[1]);
      out.keys.push(`v:${h.from}`);
      out.curves.push(s.id);
      const travel = { key: s.id, forward: h.forward, from: start, to: end, ends: [h.from, h.to] as [string, string] };
      switch (s.kind) {
        case 'line':
          exact.push({ ...travel, type: 'line' });
          continue;
        case 'arc':
          break;
        case 'spline': {
          // the points of its polyline between the ends, keyed by their index in the polyline and
          // in reverse for the backward half, so that regions on both sides share them
          if (!sampled.includes(s.id)) sampled.push(s.id);
          const last = s.pts.length - 1;
          for (let step = 1; step < last; step++) {
            const k = h.forward ? step : last - step;
            out.xy.push(s.pts[k][0], s.pts[k][1]);
            out.keys.push(`c:${s.id}:${k}`);
            out.curves.push(s.id);
          }
          continue;
        }
        default:
          unreachable(s, 'shape');
      }
      exact.push({ ...travel, type: 'arc', center: s.c, radius: s.r, start: h.forward ? s.start : s.start + s.sweep, sweep: h.forward ? s.sweep : -s.sweep });
      const n = segments(s.sweep, s.r, chordTolerance);
      for (let step = 1; step < n; step++) {
        const k = h.forward ? step : n - step;
        const angle = s.start + (s.sweep * k) / n;
        out.xy.push(s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle));
        out.keys.push(`c:${s.id}:${k}`);
        out.curves.push(s.id);
      }
    }
    if (sampled.length === 0) return out;
    // a loop through a spline has no exact curves (D70)
    const { exact: _exact, ...rest } = out;
    return { ...rest, sampled };
  };
  const circleLoop = (s: Extract<Shape, { kind: 'circle' }>, clockwise: boolean): Loop => {
    const n = segments(TAU, s.r, chordTolerance);
    const out: Loop = { xy: [], keys: [], curves: [], exact: [{ key: s.id, forward: !clockwise, type: 'circle', center: s.c, radius: s.r, ccw: !clockwise }] };
    for (let step = 0; step < n; step++) {
      const k = clockwise ? (n - step) % n : step;
      const angle = (TAU * k) / n;
      out.xy.push(s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle));
      out.keys.push(`c:${s.id}:${k}`);
      out.curves.push(s.id);
    }
    return out;
  };

  // Does a point lie inside a boundary? A ray in the direction +x; the curves are taken in pieces
  // monotonic in y with a half-open rule, so a pass through a vertex does not count twice.
  type Boundary = { halves: number[] } | { circle: Extract<Shape, { kind: 'circle' }> };
  // The box of a boundary as the ray test reads it: a line its ends, an arc its whole circle and its
  // two ends, a circle itself. A point outside it is crossed by no piece, or (left of it) by an even
  // number, since the pieces of a closed boundary change side an even number of times.
  const boundaryBox = (boundary: Boundary): Box => {
    if ('circle' in boundary) return shapeBox(boundary.circle);
    const points: Vec2[] = [];
    for (const i of boundary.halves) {
      const s = halves[i].shape;
      switch (s.kind) {
        case 'line':
          points.push(s.pa, s.pb);
          break;
        case 'arc':
          points.push(s.pa, s.pb, [s.c[0] - s.r, s.c[1] - s.r], [s.c[0] + s.r, s.c[1] + s.r]);
          break;
        case 'spline':
          points.push(...s.control); // the box of its control points holds its polyline
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    return boxOf(points);
  };
  const outside = (p: Vec2, box: Box): boolean => p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3];
  const crossings = (p: Vec2, boundary: Boundary): number => {
    let count = 0;
    const piece = (from: Vec2, to: Vec2, xAt: () => number) => {
      if (from[1] > p[1] !== to[1] > p[1] && xAt() > p[0]) count++;
    };
    const arcPieces = (c: Vec2, r: number, start: number, sweep: number, from: Vec2, to: Vec2) => {
      // dividing points: the top and the bottom of the circle
      const cuts = [Math.PI / 2, (3 * Math.PI) / 2].map((angle) => positive(angle - start)).filter((offset) => offset > 0 && offset < sweep).sort((x, y) => x - y);
      const stops = [0, ...cuts, sweep];
      for (let i = 0; i + 1 < stops.length; i++) {
        const at = (offset: number): Vec2 => (offset === 0 ? from : offset === sweep ? to : [c[0] + r * Math.cos(start + offset), c[1] + r * Math.sin(start + offset)]);
        const right = Math.cos(start + (stops[i] + stops[i + 1]) / 2) > 0;
        piece(at(stops[i]), at(stops[i + 1]), () => c[0] + (right ? 1 : -1) * Math.sqrt(Math.max(0, r * r - (p[1] - c[1]) ** 2)));
      }
    };
    if ('circle' in boundary) {
      const s = boundary.circle;
      const [top, bottom]: Vec2[] = [[s.c[0], s.c[1] + s.r], [s.c[0], s.c[1] - s.r]];
      arcPieces(s.c, s.r, Math.PI / 2, Math.PI, top, bottom);
      arcPieces(s.c, s.r, (3 * Math.PI) / 2, Math.PI, bottom, top);
      return count;
    }
    for (const i of boundary.halves) {
      const s = halves[i].shape;
      switch (s.kind) {
        case 'line':
          piece(s.pa, s.pb, () => s.pa[0] + ((p[1] - s.pa[1]) / (s.pb[1] - s.pa[1])) * (s.pb[0] - s.pa[0]));
          break;
        case 'arc':
          arcPieces(s.c, s.r, s.start, s.sweep, s.pa, s.pb);
          break;
        case 'spline':
          for (let k = 0; k + 1 < s.pts.length; k++) {
            const [from, to] = [s.pts[k], s.pts[k + 1]];
            piece(from, to, () => from[0] + ((p[1] - from[1]) / (to[1] - from[1])) * (to[0] - from[0]));
          }
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    return count;
  };

  // ---- connected parts of the graph: each has bounded faces and one outer boundary
  interface Face {
    area: number;
    boundary: Boundary;
    region: Region;
    component: number;
    box?: Box;
  }
  interface Component {
    sample: Vec2; // a point of the part by which the region it lies in is searched for
    hole: () => Loop; // the outer boundary, clockwise
  }
  const faces: Face[] = [];
  const components: Component[] = [];
  const componentOf = new Map<string, number>();
  const group = new Map<string, string>([...position.keys()].map((k) => [k, k]));
  const rootOf = (k: string): string => {
    let r = k;
    while (group.get(r) !== r) r = group.get(r) as string;
    return r;
  };
  for (const s of open) group.set(rootOf(s.a), rootOf(s.b));
  loops.forEach((loop) => {
    const root = rootOf(halves[loop[0]].from);
    if (!componentOf.has(root)) {
      componentOf.set(root, components.length);
      components.push({ sample: position.get(root) as Vec2, hole: () => ({ xy: [], keys: [], curves: [] }) });
    }
    const component = componentOf.get(root) as number;
    const area = areaOf(loop);
    if (area > 0) {
      const outer = polyline(loop);
      faces.push({ area, boundary: { halves: loop }, region: { ref: { outerLoop: [...new Set(outer.curves)].sort() }, outer, holes: [] }, component });
    } else components[component].hole = () => polyline(loop);
  });
  for (const s of shapes) {
    if (s.kind !== 'circle') continue;
    faces.push({ area: Math.PI * s.r * s.r, boundary: { circle: s }, region: { ref: { outerLoop: [s.id] }, outer: circleLoop(s, false), holes: [] }, component: components.length });
    components.push({ sample: [s.c[0] + s.r, s.c[1]], hole: () => circleLoop(s, true) });
  }
  // Holes: a part of the graph nested in a region of another part is its hole; it belongs to the
  // smallest region that contains it.
  components.forEach((component, index) => {
    let parentFace: Face | undefined;
    for (const face of faces) {
      if (face.component === index) continue;
      if (broad.faceBoxes && outside(component.sample, (face.box ??= boundaryBox(face.boundary)))) continue;
      if (crossings(component.sample, face.boundary) % 2 === 0) continue;
      if (!parentFace || face.area < parentFace.area) parentFace = face;
    }
    if (parentFace) parentFace.region.holes.push(component.hole());
  });
  const regions = faces.map((f) => f.region).sort((p, q) => (p.ref.outerLoop.join('|') < q.ref.outerLoop.join('|') ? -1 : 1));
  const tight = tessellationProblem(regions);
  if (tight) return { profile: { valid: false, regions: [] }, tight };
  return { profile: { valid: true, regions } };
}

// ---------------------------------------------------------------- checks of an outline

// The checks of loops that did not come from `detectProfile`: an outline moved by an offset and the
// outline of a wall (recompute/outline.ts). The first two are the checks of a sketch profile (curves
// touch only where they are joined; the polylines do not cross). They are not enough: the crossing
// test of `soundTessellation` sees only edges whose ends lie strictly on opposite sides of each
// other, so an edge that ends on another, passes through its end or runs along it is no crossing
// to it. The polylines therefore get three more tests (clearance, area, nesting).

// Two curves of the loops that touch where they are not joined, if there are any. A corner is
// a vertex of its own in every loop: curves are joined only where they follow each other.
export function touchingCurves(loops: OutlineCurve[][], broad: BroadPhase = BROAD_PHASE): [OutlineCurve, OutlineCurve] | undefined {
  const shapes: { shape: Shape; curve: OutlineCurve }[] = [];
  loops.forEach((loop, l) => {
    loop.forEach((curve, i) => {
      const id = `${l}:${i}`;
      const [a, b] = [`${l}:${i}`, `${l}:${(i + 1) % loop.length}`];
      if (curve.type === 'circle') shapes.push({ curve, shape: { id, kind: 'circle', c: curve.center, r: curve.radius } });
      else if (curve.type === 'line') shapes.push({ curve, shape: { id, kind: 'line', a, b, pa: curve.from, pb: curve.to } });
      // a shape runs counter-clockwise from `a` to `b`
      else if (curve.sweep > 0) shapes.push({ curve, shape: { id, kind: 'arc', a, b, pa: curve.from, pb: curve.to, c: curve.center, r: curve.radius, start: curve.start, sweep: curve.sweep } });
      else shapes.push({ curve, shape: { id, kind: 'arc', a: b, b: a, pa: curve.to, pb: curve.from, c: curve.center, r: curve.radius, start: curve.start + curve.sweep, sweep: -curve.sweep } });
    });
  });
  for (const [i, j] of broad.pairs(shapes.map((s) => shapeBox(s.shape)), LENGTH_TOLERANCE)) if (!compatible(shapes[i].shape, shapes[j].shape, LENGTH_TOLERANCE)) return [shapes[i].curve, shapes[j].curve];
  return undefined;
}

// The distance of a point from a segment, and of two segments (zero when they meet in any way).
function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function segmentToSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const side = (px: number, py: number, qx: number, qy: number, x: number, y: number): number => (qx - px) * (y - py) - (qy - py) * (x - px);
  const [c, d, a, b] = [side(ax, ay, bx, by, cx, cy), side(ax, ay, bx, by, dx, dy), side(cx, cy, dx, dy, ax, ay), side(cx, cy, dx, dy, bx, by)];
  if (c * d < 0 && a * b < 0) return 0;
  return Math.min(pointToSegment(ax, ay, cx, cy, dx, dy), pointToSegment(bx, by, cx, cy, dx, dy), pointToSegment(cx, cy, ax, ay, bx, by), pointToSegment(dx, dy, ax, ay, bx, by));
}

// What is wrong with the polylines of loops, if anything; `curves` are the keys of the curves the
// place belongs to. `signs[i]` is the sign of the area loop i has to have (an outer loop positive,
// a hole negative).
// - `points`: a loop has fewer than three points.
// - `clearance`: two edges that do not follow each other in one loop are nearer than the length
//   tolerance, or an edge folds back onto the one it follows (its other end is nearer than the
//   tolerance to that edge). Edges follow each other by position in the loop, not by a common key:
//   a loop that returns to a point it has been at is refused. What passes is simple polygons with
//   no point in common.
// - `area`: a loop has lost the sign of its area, or has an area not above the tolerance times
//   its length.
export interface PolygonProblem {
  what: 'points' | 'clearance' | 'area';
  curves: Id[];
}
export function polygonProblem(loops: Loop[], signs: number[]): PolygonProblem | undefined {
  const tol = LENGTH_TOLERANCE;
  interface Edge {
    loop: number;
    index: number;
    count: number;
    curve: Id;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    minX: number;
    maxX: number;
  }
  const list: Edge[] = [];
  for (const [l, loop] of loops.entries()) {
    const count = loop.keys.length;
    if (count < 3) return { what: 'points', curves: [...new Set(loop.curves)] };
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
      list.push({ loop: l, index: i, count, curve: loop.curves[i], ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
    }
  }
  // the sweep of `soundTessellation`, with the boxes widened by the tolerance
  list.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length && list[j].minX <= p.maxX + tol; j++) {
      const q = list[j];
      if (Math.max(q.ay, q.by) < Math.min(p.ay, p.by) - tol || Math.min(q.ay, q.by) > Math.max(p.ay, p.by) + tol) continue;
      const [first, second] = p.loop !== q.loop ? [undefined, undefined] : (p.index + 1) % p.count === q.index ? [p, q] : (q.index + 1) % q.count === p.index ? [q, p] : [undefined, undefined];
      const near =
        first && second
          ? pointToSegment(first.ax, first.ay, second.ax, second.ay, second.bx, second.by) <= tol || pointToSegment(second.bx, second.by, first.ax, first.ay, first.bx, first.by) <= tol
          : segmentToSegment(p.ax, p.ay, p.bx, p.by, q.ax, q.ay, q.bx, q.by) <= tol;
      if (near) return { what: 'clearance', curves: [...new Set([p.curve, q.curve])] };
    }
  }
  for (const [l, loop] of loops.entries()) {
    const count = loop.keys.length;
    let [area, length] = [0, 0];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      area += (loop.xy[2 * i] * loop.xy[2 * j + 1] - loop.xy[2 * j] * loop.xy[2 * i + 1]) / 2;
      length += Math.hypot(loop.xy[2 * j] - loop.xy[2 * i], loop.xy[2 * j + 1] - loop.xy[2 * i + 1]);
    }
    if (Math.sign(area) !== signs[l] || !(Math.abs(area) > tol * length)) return { what: 'area', curves: [...new Set(loop.curves)] };
  }
  return undefined;
}

// Which polyline lies inside which: `[i][j]` says that loop i lies inside loop j, decided by the
// first vertex of i against the polygon of j. One vertex decides for loops that passed the
// clearance: two simple polygons without a common point are either nested or apart.
export function polygonNesting(loops: Loop[]): boolean[][] {
  const inside = (x: number, y: number, loop: Loop): boolean => {
    const count = loop.keys.length;
    let odd = false;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
      if (ay > y !== by > y && ax + ((y - ay) / (by - ay)) * (bx - ax) > x) odd = !odd;
    }
    return odd;
  };
  return loops.map((loop, i) => loops.map((other, j) => i !== j && inside(loop.xy[0], loop.xy[1], other)));
}

export const sameRegion = (a: RegionRef, b: RegionRef): boolean => a.outerLoop.length === b.outerLoop.length && a.outerLoop.every((id, i) => id === b.outerLoop[i]);
