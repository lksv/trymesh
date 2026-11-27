// Geometry of a sketch for drawing and hit testing: positions from the result of the recompute, shapes of
// curves, measuring. Pure functions with no dependency on the browser.
import { type Constraint, type DimensionShape, type Id, type SketchCurve, type SketchFeature, type SketchResult, type SketchToolContext, type Vec2, constraintOperands, curvePoints, derivedOrigin, isOriginAxis, kindOf as kindOfEntry, lineExtent, referenceEntities, solvedCurves, splinePolyline } from '@trymesh/engine';

export const ORIGIN = 'origin';
const TAU = 2 * Math.PI;

export type Shape =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number } // counter-clockwise
  // a spline (D70): its control polygon and the polyline the view draws and hit-tests
  | { type: 'spline'; control: Vec2[]; points: Vec2[] };

// The chord tolerance of the polyline of a spline in the view, relative to the largest side of the
// box of its control points: a rule of the view, as the step of π/48 of an arc is.
export const VIEW_TOLERANCE = 0.0005;
export function splineShape(control: Vec2[]): Shape {
  const xs = control.map((p) => p[0]);
  const ys = control.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return { type: 'spline', control, points: size > 0 ? splinePolyline(control, VIEW_TOLERANCE * size) : [control[0], control[control.length - 1]] };
}

export interface PointView {
  id: Id;
  at: Vec2;
  own: boolean; // false = the origin or a point of projected geometry
  derived?: true; // a point of a copy of a mirror or pattern (D68)
}
export interface CurveView {
  id: Id;
  own: boolean; // false = a projected edge
  derived?: true; // a copy of a mirror or pattern (D68): drawn as derived geometry, not snapped to
  construction: boolean; // of a copy, the flag of its source
  shape: Shape;
  points: Id[]; // defining points: the ends of a line; the centre of a circle; the centre, start and end of an arc
}
export interface SketchView {
  points: Map<Id, PointView>;
  curves: Map<Id, CurveView>;
  source: SketchToolContext; // the sketch and the solved state the view was made of, for the sketch tools of the engine
}
export type EntityKind = 'point' | Shape['type'];

// The end of a switch over the kinds of a curve (D64): a kind added to `Shape` or to the curves of
// the engine does not compile until the switch has its case. At run time it throws, which a sketch
// the engine validated never reaches.
export function unreachable(value: never, what: string): never {
  throw new Error(`${what}: unexpected ${JSON.stringify(value)}`);
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

// The view of a solved sketch, from what the engine's reader of a solved sketch gives
// (`solvedCurves`): the own curves, the curves of its entries, and the axes of the origin
// `origin/x` and `origin/y` (D71), which are curves that are not own, held by the point `origin`
// and shaped as whole lines (`lineExtent`), so they are hovered, picked and snapped to anywhere.
export function sketchView(feature: SketchFeature, result: SketchResult): SketchView {
  const points = new Map<Id, PointView>();
  const curves = new Map<Id, CurveView>();
  const solved = solvedCurves(feature, result);
  const at = (id: Id): Vec2 | undefined => {
    const p = solved.geometry.points[id];
    return p ? [p.x, p.y] : undefined;
  };
  points.set(ORIGIN, { id: ORIGIN, at: [0, 0], own: false });
  for (const id of Object.keys(feature.points)) points.set(id, { id, at: at(id) as Vec2, own: true });

  // the shape of a curve over the positions of its points (the radius of a circle given)
  const shapeOf = (sketchCurve: SketchCurve, radius: number): Shape => {
    const curve = sketchCurve.shape;
    switch (curve.type) {
      case 'line': {
        const extent = lineExtent(sketchCurve, solved.geometry);
        return extent ? { type: 'line', a: [extent.a.x, extent.a.y], b: [extent.b.x, extent.b.y] } : { type: 'line', a: at(curve.a) as Vec2, b: at(curve.b) as Vec2 };
      }
      case 'circle':
        return { type: 'circle', center: at(curve.center) as Vec2, radius };
      case 'arc': {
        const [center, start, end] = [at(curve.center) as Vec2, at(curve.start) as Vec2, at(curve.end) as Vec2];
        const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const sweep = positive(Math.atan2(end[1] - center[1], end[0] - center[0]) - from) || TAU;
        return { type: 'arc', center, radius: dist(center, start), from, sweep };
      }
      case 'spline':
        return splineShape(curve.points.map((id) => at(id) as Vec2));
      default:
        return unreachable(curve, 'curve');
    }
  };
  // The entries of `external` (projected geometry): their points with a position, in the order of
  // the document and of the kind of each entry.
  for (const entry of Object.keys(feature.external)) {
    const derived = kindOfEntry(feature.external[entry]).source === 'derived';
    for (const [id, kind] of Object.entries(referenceEntities(feature, entry))) {
      const p = kind === 'point' ? at(id) : undefined;
      if (p) points.set(id, { id, at: p, own: false, ...(derived ? { derived: true as const } : {}) });
    }
  }
  // The curves: the own ones, then those of the entries the result has (in the order of the
  // document and of the kind of each entry), then the two axes. An axis is held by `origin`, its
  // far point being no point of the sketch.
  for (const curve of solved.curves.values()) {
    const own = curve.source === 'own';
    curves.set(curve.id, {
      id: curve.id,
      own,
      ...(curve.source === 'derived' ? { derived: true as const } : {}),
      // a copy has the flag of its source (D68)
      construction: own ? feature.curves[curve.id].construction === true : curve.source === 'derived' && feature.curves[derivedOrigin(feature, curve.id)?.source ?? '']?.construction === true,
      points: isOriginAxis(curve.id) ? [ORIGIN] : curvePoints(curve.shape),
      shape: shapeOf(curve, solved.geometry.radii[curve.id]),
    });
  }
  return { points, curves, source: { sketch: feature, result } };
}

// Whether a drawing tool may snap a new point to a curve: one that can hold a point by
// `pointOnCurve`. Not a copy of a mirror or pattern (D68: no constraint of its own sketch names it),
// not a spline (D70: no constraint holds a point on it).
export const holdsPoint = (view: SketchView, curve: Id): boolean => {
  const c = view.curves.get(curve);
  return c !== undefined && c.derived !== true && c.shape.type !== 'spline';
};
// Whether a constraint may name an entity of the sketch: not a copy (D68) and not a spline (D70).
// A selection that holds one is offered no constraint.
export const takesConstraint = (view: SketchView, id: Id): boolean => {
  const point = view.points.get(id);
  if (point) return point.derived !== true;
  const c = view.curves.get(id);
  return c === undefined || (c.derived !== true && c.shape.type !== 'spline');
};

export const kindOf = (view: SketchView, id: Id): EntityKind | undefined => (view.points.has(id) ? 'point' : view.curves.get(id)?.shape.type);

// The polyline of a curve; a circle is closed (last point = first).
export function polyline(shape: Shape): Vec2[] {
  let [from, sweep] = [0, TAU];
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'spline':
      return shape.points;
    case 'circle':
      break;
    case 'arc':
      [from, sweep] = [shape.from, shape.sweep];
      break;
    default:
      return unreachable(shape, 'shape');
  }
  const count = Math.max(8, Math.ceil(sweep / (Math.PI / 48)));
  const out: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = from + (sweep * i) / count;
    out.push([shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)]);
  }
  return out;
}

// The nearest point of a curve to the point p.
export function closestOn(shape: Shape, p: Vec2): Vec2 {
  switch (shape.type) {
    case 'line': {
      const [dx, dy] = [shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]];
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - shape.a[0]) * dx + (p[1] - shape.a[1]) * dy) / length2));
      return [shape.a[0] + t * dx, shape.a[1] + t * dy];
    }
    case 'circle': {
      const { center, radius } = shape;
      const angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    case 'arc': {
      const { center, radius } = shape;
      let angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      const along = positive(angle - shape.from);
      // outside the arc: the nearer of the end points
      if (along > shape.sweep) angle = along - shape.sweep < TAU - along ? shape.from + shape.sweep : shape.from;
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    case 'spline': {
      // the nearest point of its polyline
      let [best, bestDistance]: [Vec2, number] = [shape.points[0], Infinity];
      for (let k = 0; k + 1 < shape.points.length; k++) {
        const q = closestOn({ type: 'line', a: shape.points[k], b: shape.points[k + 1] }, p);
        if (dist(q, p) < bestDistance) [best, bestDistance] = [q, dist(q, p)];
      }
      return best;
    }
    default:
      return unreachable(shape, 'shape');
  }
}

export const distanceTo = (shape: Shape, p: Vec2): number => dist(closestOn(shape, p), p);

// The nearest point of the sketch within the distance `reach`; on a tie the own point takes precedence.
export function hitPoint(view: SketchView, p: Vec2, reach: number, skip?: (id: Id) => boolean): PointView | undefined {
  let best: PointView | undefined;
  let bestDistance = reach;
  for (const point of view.points.values()) {
    if (skip?.(point.id)) continue;
    const d = dist(point.at, p);
    if (d > reach) continue;
    if (!best || d < bestDistance || (d === bestDistance && point.own && !best.own)) {
      best = point;
      bestDistance = d;
    }
  }
  return best;
}

export function hitCurve(view: SketchView, p: Vec2, reach: number, skip?: (id: Id) => boolean): CurveView | undefined {
  let best: CurveView | undefined;
  let bestDistance = reach;
  for (const curve of view.curves.values()) {
    if (skip?.(curve.id)) continue;
    const d = distanceTo(curve.shape, p);
    if (d <= bestDistance && (d < bestDistance || !best)) {
      best = curve;
      bestDistance = d;
    }
  }
  return best;
}

const endpoints = (view: SketchView, line: Id): [Vec2, Vec2] | undefined => {
  const shape = view.curves.get(line)?.shape;
  return shape?.type === 'line' ? [shape.a, shape.b] : undefined;
};

// The distance of a point from the infinite line through two points (from the first one when they merge).
const distanceToLine = (p: Vec2, [a, b]: [Vec2, Vec2]): number => {
  const length = dist(a, b);
  return length === 0 ? dist(a, p) : Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / length;
};

// The current value of a dimension from the positions in the sketch (the same conventions as the engine);
// undefined = an operand is missing.
export function measure(shape: DimensionShape, view: SketchView): number | undefined {
  const point = (id: Id) => view.points.get(id)?.at;
  switch (shape.type) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance': {
      const [a, b] = [point(shape.a), point(shape.b)];
      if (!a || !b) return undefined;
      return shape.type === 'distance' ? dist(a, b) : shape.type === 'horizontalDistance' ? b[0] - a[0] : b[1] - a[1];
    }
    case 'distancePointLine': {
      const [p, ends] = [point(shape.point), endpoints(view, shape.line)];
      if (!p || !ends) return undefined;
      return distanceToLine(p, ends);
    }
    case 'distanceLineLine': {
      // from the point a of the line a to the line b, as the engine measures it (D75); the point a
      // of an axis of the origin is the origin, not the far end the view draws the axis from
      const [first, second] = [endpoints(view, shape.a), endpoints(view, shape.b)];
      if (!first || !second) return undefined;
      return distanceToLine(isOriginAxis(shape.a) ? [0, 0] : first[0], second);
    }
    case 'distanceLineCircle': {
      // the distance of the centre from the line less the radius
      const [ends, round] = [endpoints(view, shape.line), view.curves.get(shape.curve)?.shape];
      if (!ends || (round?.type !== 'circle' && round?.type !== 'arc')) return undefined;
      return distanceToLine(round.center, ends) - round.radius;
    }
    case 'angle': {
      const [first, second] = [endpoints(view, shape.a), endpoints(view, shape.b)];
      if (!first || !second) return undefined;
      const direction = ([a, b]: [Vec2, Vec2]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
      const angle = positive(direction(second) - direction(first));
      return angle > Math.PI ? angle - TAU : angle; // (−π, π]
    }
    case 'radius':
    case 'diameter': {
      const curve = view.curves.get(shape.curve)?.shape;
      if (!curve) return undefined;
      switch (curve.type) {
        case 'line':
        case 'spline': // never an operand (D70)
          return undefined;
        case 'circle':
        case 'arc':
          return shape.type === 'radius' ? curve.radius : 2 * curve.radius;
        default:
          return unreachable(curve, 'shape');
      }
    }
  }
}

// Operands of a constraint (IDs of entities of the sketch), by the engine's catalog.
export const operandsOf = constraintOperands;

// The place for the label of a constraint: the middle between the operands; for a circle a point on the
// rim. An axis of the origin (D71), a whole line, has no middle: its spot is the foot on it of the middle
// of the other operands (of the origin, when every operand is an axis), so the label of a dimension to an
// axis stands beside the point it measures.
export function anchorOf(c: Constraint, view: SketchView): Vec2 | undefined {
  const spots: Vec2[] = [];
  const axes: Shape[] = [];
  for (const id of operandsOf(c)) {
    const point = view.points.get(id);
    const shape = view.curves.get(id)?.shape;
    if (shape && isOriginAxis(id)) axes.push(shape);
    else if (point) spots.push(point.at);
    else if (!shape) return undefined;
    else {
      switch (shape.type) {
        case 'line':
          spots.push([(shape.a[0] + shape.b[0]) / 2, (shape.a[1] + shape.b[1]) / 2]);
          break;
        case 'circle':
        case 'arc': {
          const angle = shape.type === 'arc' ? shape.from + shape.sweep / 2 : Math.PI / 4;
          spots.push([shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)]);
          break;
        }
        case 'spline': // never an operand of a constraint (D70): the middle of its polyline's points
          spots.push(shape.points[Math.floor(shape.points.length / 2)]);
          break;
        default:
          unreachable(shape, 'shape');
      }
    }
  }
  const middle = (of: Vec2[]): Vec2 => [of.reduce((sum, s) => sum + s[0], 0) / of.length, of.reduce((sum, s) => sum + s[1], 0) / of.length];
  if (axes.length > 0) {
    const from: Vec2 = spots.length > 0 ? middle(spots) : [0, 0];
    spots.push(...axes.map((axis) => closestOn(axis, from)));
  }
  if (spots.length === 0) return undefined;
  return middle(spots);
}

// Does a point lie inside a loop (pairs of coordinates one after another)?
export function insideLoop(loop: ArrayLike<number>, p: Vec2): boolean {
  let inside = false;
  const count = loop.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const [xi, yi, xj, yj] = [loop[2 * i], loop[2 * i + 1], loop[2 * j], loop[2 * j + 1]];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
