// Skica: vstup solveru a razítko, referenční kóty, detekce profilů a oblastí.
// Pravidla jsou v docs/architecture.md, sekce Skica, Řešení skici a Profily a oblasti.
import type { GeometrySource, ResolvedReference } from './references/spec';
import { AXES_GEOMETRY, constraintOperands, isDimension } from './sketch-content';
import type { Constraint, Curve, CurveShape, Id, Point2, Projected, RegionRef, SketchFeature, SketchResult, SolveInput, Vec2 } from './types';
import { AXIS_REACH, LENGTH_TOLERANCE, ORIGIN, ORIGIN_AXES, cross2, dist2, dot2, fingerprint, has, isOriginAxis, len2, stableStringify, sub2, unreachable } from './util';

// Použité polohy: vlastní body, počátek a body promítnuté geometrie; poloměry kružnic včetně promítnutých.
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

// Spojování bodů: tentýž bod, nebo dvojice (vazba coincident), která je v použitých polohách splněná.
// Tranzitivní, jde i přes počátek a promítnuté body. The answer is the vertex of a point: the point
// with the smallest ID of those it is joined with. The profile of a sketch and the chain of a wall
// (recompute/outline.ts) join points by this rule.
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
// An arc runs counter-clockwise from `a` at the angle `start` by `sweep` in (0, 2π].
export type PlacedCurve =
  | { type: 'line'; a: CurveEnd; b: CurveEnd }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; a: CurveEnd; b: CurveEnd; center: Vec2; radius: number; start: number; sweep: number };
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
    default:
      return unreachable(shape, 'curve');
  }
}

// The two points a line or an arc names at its ends (`a`, `b`; `start`, `end`); a circle has none.
export function curveEnds(shape: CurveShape): [Id, Id] | undefined {
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'arc':
      return [shape.start, shape.end];
    case 'circle':
      return undefined;
    default:
      return unreachable(shape, 'curve');
  }
}

// ---------------------------------------------------------------- vstup solveru

export interface SolverSetup {
  input: SolveInput; // bez tažení
  stamp: string; // otisk vstupů: křivky, řídicí vazby, hodnoty promítnuté geometrie
  skipped: Id[]; // vazby vynechané, protože jejich promítnutá geometrie nemá žádné platné hodnoty
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
    const { geometry } = references[id];
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
    else if (!isDimension(c) || c.driving) constraints[id] = c; // referenční kóty počítá engine
  }
  const used: Record<Id, Projected> = {};
  for (const id of Object.keys(sketch.external)) {
    const value = has(references, id) ? references[id].value : undefined;
    if (value) used[id] = value;
  }
  const stamp = fingerprint(stableStringify({ curves, constraints, external: used }));
  return { input: { points, radii, curves, constraints, fixed }, stamp, skipped: skipped.sort() };
}

// Vlastní řešené proměnné skici z poloh, které vrátil solver.
export function ownVariables(sketch: SketchFeature, geometry: SketchGeometry): SketchGeometry {
  const points: Record<Id, Point2> = {};
  const radii: Record<Id, number> = {};
  for (const id of Object.keys(sketch.points)) points[id] = geometry.points[id];
  for (const id of Object.keys(sketch.radii)) radii[id] = geometry.radii[id];
  return { points, radii };
}

// ---------------------------------------------------------------- referenční kóty

const xy = (p: Point2): Vec2 => [p.x, p.y];

// Hodnoty referenčních kót (driving: false) z použitých poloh. Kóta, jejíž operand chybí, se vynechá.
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
    } else if (c.type === 'angle') {
      const [a, b] = [line(c.a), line(c.b)];
      if (a && b) {
        const [da, db] = [sub2(a[1], a[0]), sub2(b[1], b[0])];
        value = Math.atan2(cross2(da, db), dot2(da, db)); // od směru a ke směru b, proti směru hodin
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

// ---------------------------------------------------------------- profily a oblasti

// Uzavřená lomená čára v souřadnicích skici. Bod i má klíč keys[i]; hrana z bodu i do bodu i + 1
// pochází z křivky curves[i]. Vnější smyčka jde proti směru hodin, díra po směru.
// `exact`: the curves the polyline was divided from, in the order and direction the loop passes
// them (the loops of a sketch and of a moved outline have them; a generated loop has none).
export interface Loop {
  xy: number[];
  keys: string[];
  curves: Id[];
  exact?: OutlineCurve[];
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
  valid: boolean; // false = křivky se kříží nebo dotýkají mimo spojené body
  regions: Region[];
}

type Shape =
  | { id: Id; kind: 'line'; a: string; b: string; pa: Vec2; pb: Vec2 }
  | { id: Id; kind: 'arc'; a: string; b: string; pa: Vec2; pb: Vec2; c: Vec2; r: number; start: number; sweep: number }
  | { id: Id; kind: 'circle'; c: Vec2; r: number };
type Open = Exclude<Shape, { kind: 'circle' }>;

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

// Vzdálenost bodu od křivky.
function distanceTo(p: Vec2, s: Shape): number {
  switch (s.kind) {
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
    default:
      return unreachable(s, 'shape');
  }
};

// A shape with a centre and a radius (a circle or an arc), or undefined for a line.
type Round = Exclude<Shape, { kind: 'line' }>;
function roundOf(s: Shape): Round | undefined {
  switch (s.kind) {
    case 'line':
      return undefined;
    case 'circle':
    case 'arc':
      return s;
    default:
      return unreachable(s, 'shape');
  }
}

// Průsečíky a body dotyku nosných křivek (přímka, kružnice), s tolerancí pro tečnost.
function carrierContacts(A: Shape, B: Shape, tol: number): Vec2[] {
  switch (A.kind) {
    case 'line':
      switch (B.kind) {
        case 'line':
          return lineContacts(A, B);
        case 'circle':
        case 'arc':
          return lineRoundContacts(A, B, tol);
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
        default:
          return unreachable(B, 'shape');
      }
    default:
      return unreachable(A, 'shape');
  }
}
type LineShape = Extract<Shape, { kind: 'line' }>;
function lineContacts(A: LineShape, B: LineShape): Vec2[] {
  const [da, db] = [sub2(A.pb, A.pa), sub2(B.pb, B.pa)];
  const denominator = cross2(da, db);
  if (Math.abs(denominator) <= 1e-12 * len2(da) * len2(db)) return []; // rovnoběžné: stačí kontrola koncových bodů
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
  if (D <= tol) return []; // soustředné se stejným poloměrem: řeší se zvlášť
  const u: Vec2 = [delta[0] / D, delta[1] / D];
  if (D >= P.r + Q.r - tol) return [[P.c[0] + u[0] * P.r, P.c[1] + u[1] * P.r]]; // vnější dotyk
  if (D <= Math.abs(P.r - Q.r) + tol) {
    const sign = P.r > Q.r ? 1 : -1; // vnitřní dotyk
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

// Smějí se dvě křivky v profilu potkat? Dotýkat se smějí jen ve spojených bodech.
function compatible(A: Shape, B: Shape, tol: number): boolean {
  const curved = [A, B].flatMap((s) => roundOf(s) ?? []);
  // Soustředné kružnice nebo oblouky se stejným poloměrem leží na sobě.
  if (curved.length === 2 && dist2(curved[0].c, curved[1].c) <= tol && Math.abs(curved[0].r - curved[1].r) <= tol) {
    if (A.kind === 'circle' || B.kind === 'circle') return false;
  }
  // Společné vrcholy. U tečného napojení (zaoblení) leží křivky pod tolerancí i kus od vrcholu,
  // proto se dotyk bere jako dotyk ve vrcholu až do vzdálenosti dané poloměrem.
  const shared: Vec2[] = [];
  if (A.kind !== 'circle' && B.kind !== 'circle') {
    for (const [ka, pa] of [[A.a, A.pa], [A.b, A.pb]] as [string, Vec2][]) if (ka === B.a || ka === B.b) shared.push(pa);
  }
  const reach = 10 * tol + (curved.length ? Math.sqrt(8 * Math.max(...curved.map((s) => s.r)) * tol) : 0);
  const candidates: Vec2[] = carrierContacts(A, B, tol);
  for (const s of [A, B]) if (s.kind !== 'circle') candidates.push(s.pa, s.pb, midpoint(s));
  for (const p of candidates) {
    if (distanceTo(p, A) > tol || distanceTo(p, B) > tol) continue;
    if (!shared.some((v) => dist2(p, v) <= reach)) return false;
  }
  return true;
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

// The distance of a point from the line (the whole line, not the segment) of a line shape.
function lineDistance(p: Vec2, s: Extract<Shape, { kind: 'line' }>): number {
  const d = sub2(s.pb, s.pa);
  const length = len2(d);
  return length === 0 ? dist2(p, s.pa) : Math.abs(cross2(d, sub2(p, s.pa))) / length;
}

// The shape of a curve of a sketch with its ends at their joined vertices (as the profile reads
// it), or undefined when it has no position or no length. A line is the stretch `lineExtent`
// gives: an axis of the origin is a whole line, whose ends are no vertex of anything.
function shapeOfCurve(curve: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry): Shape | undefined {
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
    default:
      return unreachable(c, 'curve');
  }
}

// The contacts of two curves of a sketch (`CurveContacts`), with the joins of the profile (`joins`,
// the vertex of a point). Undefined when either has no position or no length.
export function curveContacts(a: SketchCurve, b: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry): CurveContacts | undefined {
  const [A, B] = [shapeOfCurve(a, joins, geometry), shapeOfCurve(b, joins, geometry)];
  return A && B ? shapeContacts(A, B, LENGTH_TOLERANCE) : undefined;
}

// Whether two curves of a sketch touch apart from a vertex they share: the test of the profile
// (`compatible`) for one pair. A curve without a position or a length touches everything.
export function curvesTouch(a: SketchCurve, b: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry): boolean {
  const [A, B] = [shapeOfCurve(a, joins, geometry), shapeOfCurve(b, joins, geometry)];
  return !A || !B || !compatible(A, B, LENGTH_TOLERANCE);
}

// Na kolik úseček se dělí oblouk. Strop brání tomu, aby obří poloměr nebo nepatrná tolerance
// vyžádaly milióny úseček (pro r/tolerance nad 1e16 vychází krok nula); nad ním už dělení
// toleranci nedodrží.
const MAX_SEGMENTS = 4096;
export function segments(sweep: number, radius: number, chordTolerance: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(chordTolerance / radius, 1)), Math.PI / 4);
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(sweep / step - 1e-9)));
}

// Obstojí oblasti i po rozdělení oblouků na úsečky? Platnost profilu se ověřuje na přesných
// křivkách, ale těleso vzniká z lomených čar, které se od oblouku liší až o toleranci dělení.
// Křivka, která oblouk těsně míjí, pak jeho lomenou čáru protne, a oblast tenčí než tolerance
// splaskne do dvou bodů. Z takových smyček by nevzniklo uzavřené těleso.
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
        if (seen.has(key)) continue; // hranu sdílejí sousední oblasti
        seen.add(key);
        const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
        list.push({ a, b, curve: loop.curves[i], ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
      }
    }
  }
  // Na které straně úsečky p leží bod; úsečky se kříží, když konce každé leží na opačných stranách druhé.
  const side = (p: Segment, x: number, y: number): number => (p.bx - p.ax) * (y - p.ay) - (p.by - p.ay) * (x - p.ax);
  list.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length && list[j].minX <= p.maxX; j++) {
      const q = list[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue; // sousedé se dotýkají ve vrcholu
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

// Najde oblasti z křivek, které je tvoří (`regions`), seřazených podle ID; konstrukční a promítnuté
// křivky je netvoří. `joins` gives the vertex of a point (`joinsOf`).
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
          valid = false; // křivka nulové délky
          continue;
        }
        shapes.push({ id, kind: 'line', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p });
        continue;
      case 'arc':
        if (c.a.key === c.b.key || dist2(c.a.p, c.b.p) <= tol) {
          valid = false; // křivka nulové délky
          continue;
        }
        if (!(c.radius > tol)) {
          valid = false;
          continue;
        }
        shapes.push({ id, kind: 'arc', a: c.a.key, b: c.b.key, pa: c.a.p, pb: c.b.p, c: c.center, r: c.radius, start: c.start, sweep: c.sweep });
        continue;
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

  // ---- rovinný graf: půlhrany úseček a oblouků
  interface Half {
    shape: Open;
    forward: boolean; // ve směru křivky (u oblouku proti směru hodin)
    from: string;
    to: string;
    angle: number; // směr, kterým půlhrana opouští vrchol (po seřazení směr k blízkému bodu křivky)
    curvature: number; // se znaménkem: kladná zatáčí doleva
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
        default:
          unreachable(s, 'shape');
      }
    }
    const outgoing = new Map<string, number[]>();
    halves.forEach((h, i) => outgoing.set(h.from, [...(outgoing.get(h.from) ?? []), i]));
    // Pořadí půlhran kolem vrcholu se bere podle směru k bodu křivky v malé vzdálenosti od vrcholu,
    // ne podle tečny: úsečka a oblouk, které z vrcholu vycházejí tečně stejným směrem, mají tečny
    // shodné až na šum solveru a pořadí by určovala náhoda. Vzdálenost je polovina nejkratší
    // křivky ve vrcholu; tětiva oblouku je od tečny odkloněná o asin(křivost · vzdálenost / 2).
    for (const list of outgoing.values()) {
      const distance = Math.min(...list.map((i) => dist2(halves[i].shape.pa, halves[i].shape.pb))) / 2;
      for (const i of list) halves[i].angle = positive(halves[i].angle + Math.asin(Math.max(-1, Math.min(1, (halves[i].curvature * distance) / 2))));
      list.sort((p, q) => halves[p].angle - halves[q].angle || halves[p].curvature - halves[q].curvature || p - q);
    }
    // Další půlhrana kolem stěny (stěna vlevo): ve vrcholu první po směru hodin od protisměrné půlhrany.
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
    // Křivka, která má po obou stranách stejnou stěnu, žádnou plochu neuzavírá: ignoruje se.
    const useless = new Set(halves.filter((h) => h.loop === halves[h.twin].loop).map((h) => h.shape));
    if (useless.size === 0) break;
    open = open.filter((s) => !useless.has(s));
  }

  // Plocha smyčky se znaménkem: mnohoúhelník vrcholů plus kruhové úseče oblouků.
  const position = new Map<string, Vec2>();
  for (const s of open) position.set(s.a, s.pa).set(s.b, s.pb);
  const areaOf = (loop: number[]): number => {
    let area = 0;
    for (const i of loop) {
      const h = halves[i];
      area += cross2(position.get(h.from) as Vec2, position.get(h.to) as Vec2) / 2;
      const s = h.shape;
      switch (s.kind) {
        case 'line':
          break;
        case 'arc':
          area += ((h.forward ? 1 : -1) * s.r * s.r * (s.sweep - Math.sin(s.sweep))) / 2; // the segment of the arc
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    return area;
  };

  // Lomená čára smyčky. Dělení oblouku nezávisí na směru průchodu, takže sousední oblasti sdílejí vrcholy.
  const polyline = (loop: number[]): Loop => {
    const exact: OutlineCurve[] = [];
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
    return out;
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

  // Leží bod uvnitř hranice? Paprsek ve směru +x; křivky se berou po úsecích monotónních v y
  // s polootevřeným pravidlem, takže průchod vrcholem se nepočítá dvakrát.
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
      // dělicí body: vrchol a spodek kružnice
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
        default:
          unreachable(s, 'shape');
      }
    }
    return count;
  };

  // ---- souvislé části grafu: každá má omezené stěny a jednu vnější hranici
  interface Face {
    area: number;
    boundary: Boundary;
    region: Region;
    component: number;
    box?: Box;
  }
  interface Component {
    sample: Vec2; // bod části, podle kterého se hledá oblast, ve které leží
    hole: () => Loop; // vnější hranice po směru hodin
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
  // Díry: část grafu vnořená do oblasti jiné části je její dírou; patří nejmenší oblasti, která ji obsahuje.
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
