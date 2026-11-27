// First-order analysis of how determined a sketch is: degrees of freedom, dependent constraints,
// freedom of entities. The rules are in docs/architecture/sketch.md, section "Sketch diagnosis".
//
// Each constraint is one or two equations over the positions of points and the radii of circles.
// From their derivatives in the solved state (the Jacobian matrix) everything else follows by
// linear algebra: the degrees of freedom are the number of variables minus the rank, a constraint
// is redundant when its rows lie in the space of the rows of the other constraints, and a point is
// free when the rows of the constraints do not hold it. The solver is not called for this: its
// count of degrees of freedom is not reliable (a cycle of equal lengths, a line collapsed to a
// point) and solving repeatedly is slow.
import { CONSTRAINTS } from './catalog';
import { commonEnd } from './common-end';
import { curvePoints } from './sketch-content';
import type { Constraint, Curve, FreeEntity, Id, SolveInput, Vec2 } from './types';
import { ORIGIN, unreachable } from './util';

// The equations have the dimension of a length, so their derivatives are dimensionless and the
// thresholds do not depend on the scale.
const DEPENDENT = 1e-6; // a row counts as dependent after its projection onto the space of the others is subtracted
const ZERO_ROW = 1e-9; // an equation that determines nothing in this state
const SUPPORT = 1e-6; // the coefficient from which a constraint counts among those another one follows from
const STEP = 1e-6; // the step of the numeric derivative relative to the size of the constraint's geometry
const PROBE = 1e-3; // the part of an auxiliary vector that must remain for it to count as a new motion
const SHARED = 1e-6; // a point lies on a circle (relative to the size of the curves)

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const nonZero = (value: number): number => (value > 0 ? value : 1);
const sign = (value: number): number => (value < 0 ? -1 : 1);
// Repeatable "random" numbers from (−1, 1) (mulberry32), so the result of the analysis does not
// change.
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
};
const norm = (vector: Float64Array): number => {
  let sum = 0;
  for (let k = 0; k < vector.length; k++) sum += vector[k] * vector[k];
  return Math.sqrt(sum);
};

// The geometry of the sketch at given values of the variables.
interface Geometry {
  point(id: Id): Vec2;
  curve(id: Id): Curve;
  radius(id: Id): number; // circle: a variable or a fixed value; arc: the distance of the start from the center
}
const lineOf = (g: Geometry, id: Id): [Vec2, Vec2] => {
  const c = g.curve(id) as Extract<Curve, { type: 'line' }>;
  return [g.point(c.a), g.point(c.b)];
};
const direction = (g: Geometry, id: Id): Vec2 => {
  const [a, b] = lineOf(g, id);
  return sub(b, a);
};
const centerOf = (g: Geometry, id: Id): Vec2 => g.point((g.curve(id) as Extract<Curve, { center: Id }>).center);

type Equations = (g: Geometry) => number[];
// Do the other constraints (without tangencies) hold the point on the circle or arc?
type Held = (point: Id, round: Id) => boolean;
// The end of the arc the adapter takes as the common end of a tangency of a line and an arc only
// because two fixed points lie at one place (`commonEnd` with `byPlace`, D72), or undefined.
type JoinedByPlace = (line: Id, arc: Id) => Id | undefined;
// The variant of a constraint of the given type (even when the types group it with another one,
// like horizontal and vertical).
type Variant<C, T> = C extends { type: infer U } ? (T extends U ? C : never) : never;
type Of<T extends Constraint['type']> = Variant<Constraint, T>;

// A spline is never an operand of a constraint (D70): the catalog refuses it, so a validated
// document never reaches the case.
const neverAnOperand = (what: string): never => {
  throw new Error(`a spline is never an operand of ${what}`);
};

// The equations of each constraint: they are zero in the solution. `g0` is the solved state; it
// decides what the equation does not determine by itself (on which side of a line a point lies,
// outer or inner contact of circles), and the lengths that divide equations with a zero right-hand
// side are taken from it: the divisor is then a constant and the equation stays smooth. The
// equations depend only on differences of positions, not on the origin. Their meaning must match
// the adapter of the solver; a test that the solved sketch satisfies the equations guards it.
const EQUATIONS: { [T in Constraint['type']]: (c: Of<T>, g0: Geometry, held: Held, joined: JoinedByPlace) => Equations } = {
  coincident: (c) => (g) => sub(g.point(c.a), g.point(c.b)),
  pointOnCurve: (c, g0) => {
    const curve = g0.curve(c.curve);
    switch (curve.type) {
      case 'line':
        return (g) => {
          const [a, b] = lineOf(g, c.curve);
          return [cross(sub(b, a), sub(g.point(c.point), a)) / nonZero(len(sub(b, a)))];
        };
      case 'circle':
      case 'arc':
        return (g) => [len(sub(g.point(c.point), centerOf(g, c.curve))) - g.radius(c.curve)];
      case 'spline':
        return neverAnOperand('pointOnCurve');
      default:
        return unreachable(curve, 'curve');
    }
  },
  horizontal: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[1] - a[1]];
  },
  vertical: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[0] - a[0]];
  },
  horizontalPoints: (c) => (g) => [g.point(c.b)[1] - g.point(c.a)[1]],
  verticalPoints: (c) => (g) => [g.point(c.b)[0] - g.point(c.a)[0]],
  parallel: (c, g0) => {
    const scale = nonZero(Math.max(len(direction(g0, c.a)), len(direction(g0, c.b))));
    return (g) => [cross(direction(g, c.a), direction(g, c.b)) / scale];
  },
  perpendicular: (c, g0) => {
    const scale = nonZero(Math.max(len(direction(g0, c.a)), len(direction(g0, c.b))));
    return (g) => [dot(direction(g, c.a), direction(g, c.b)) / scale];
  },
  equalLength: (c) => (g) => [len(direction(g, c.a)) - len(direction(g, c.b))],
  equalRadius: (c) => (g) => [g.radius(c.a) - g.radius(c.b)],
  // Positions are given relative to a point of the constraint, not to the origin of the sketch, so
  // the coordinates are measured from the origin point: two equations over an ordinary variable point.
  fixed: (c) => (g) => {
    const [p, o] = [g.point(c.point), g.point(ORIGIN)];
    return [p[0] - o[0] - c.x, p[1] - o[1] - c.y];
  },
  // Tangency has two forms. In general: the distance of the center from the line (or of the centers
  // from each other) matches the radii. But when the other constraints already hold a defining
  // point of the other curve on the circle (the end of a line, the end of an arc), this equation
  // says the same in the first order as they do: the system has a double root in the solution.
  // Tangency then means that the radius at that point is perpendicular to the line, or that both
  // centers and the common point lie on a line. When the point lies on the circle only by
  // coincidence or only thanks to the tangency itself, the general form applies: otherwise the
  // radius would drop out of the analysis.
  tangent: (c, g0, held, joined) => {
    const [first, second] = g0.curve(c.a).type === 'line' ? [c.a, c.b] : [c.b, c.a];
    const onCircle = (point: Id, round: Id, size: number): boolean => Math.abs(len(sub(g0.point(point), centerOf(g0, round))) - g0.radius(round)) <= SHARED * nonZero(size);
    const ends = (round: Id): Id[] => {
      const curve = g0.curve(round);
      switch (curve.type) {
        case 'arc':
          return [curve.start, curve.end];
        case 'line':
        case 'circle':
          return [];
        case 'spline':
          return neverAnOperand('tangent');
        default:
          return unreachable(curve, 'curve');
      }
    };
    const firstCurve = g0.curve(first);
    switch (firstCurve.type) {
      case 'line': {
        const line = firstCurve;
        const size = Math.max(len(direction(g0, first)), g0.radius(second));
        const shared = [line.a, line.b].find((point) => onCircle(point, second, size) && held(point, second));
        if (shared !== undefined) {
          return (g) => {
            const u = direction(g, first);
            return [dot(sub(centerOf(g, second), g.point(shared)), u) / nonZero(len(u))];
          };
        }
        // The adapter's rule by place: an end of the arc on a fixed point within the fixed join of
        // a fixed end of the line. The adapter then solves the radius to that end square to the
        // line, so the analysis reads that equation, also where the end of the line lies off the
        // circle by more than SHARED of the size (an own arc under 1 mm; the review of 6f, kind 1).
        const end = joined(first, second);
        if (end !== undefined) {
          return (g) => {
            const u = direction(g, first);
            return [dot(sub(centerOf(g, second), g.point(end)), u) / nonZero(len(u))];
          };
        }
        const side = (g: Geometry): number => {
          const [a, b] = lineOf(g, first);
          return cross(sub(b, a), sub(centerOf(g, second), a)) / nonZero(len(sub(b, a)));
        };
        const s = sign(side(g0));
        return (g) => [s * side(g) - g.radius(second)];
      }
      case 'circle':
      case 'arc':
        break;
      case 'spline':
        return neverAnOperand('tangent');
      default:
        return unreachable(firstCurve, 'curve');
    }
    const [r1, r2] = [g0.radius(first), g0.radius(second)];
    const touches = (point: Id, round: Id): boolean => onCircle(point, round, Math.max(r1, r2)) && held(point, round);
    const shared = [...ends(first).filter((point) => touches(point, second)), ...ends(second).filter((point) => touches(point, first))][0];
    if (shared !== undefined) {
      const scale = nonZero(Math.max(r1, r2));
      return (g) => [cross(sub(centerOf(g, first), g.point(shared)), sub(centerOf(g, second), g.point(shared))) / scale];
    }
    const between = (g: Geometry): number => len(sub(centerOf(g, first), centerOf(g, second)));
    const outer = Math.abs(between(g0) - (r1 + r2)) <= Math.abs(between(g0) - Math.abs(r1 - r2));
    const s = sign(r1 - r2);
    return (g) => [between(g) - (outer ? g.radius(first) + g.radius(second) : s * (g.radius(first) - g.radius(second)))];
  },
  // The midpoint of points a, b lies on the axis and the line joining them is perpendicular to it.
  symmetric: (c) => (g) => {
    const [p, q] = lineOf(g, c.line);
    const u = sub(q, p);
    const [a, b] = [g.point(c.a), g.point(c.b)];
    const length = nonZero(len(u));
    return [cross(u, sub([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p)) / length, dot(sub(b, a), u) / length];
  },
  midpoint: (c) => (g) => {
    const [p, q] = lineOf(g, c.line);
    const m = g.point(c.point);
    return [m[0] - (p[0] + q[0]) / 2, m[1] - (p[1] + q[1]) / 2];
  },
  midpointPoints: (c) => (g) => {
    const [a, b, m] = [g.point(c.a), g.point(c.b), g.point(c.point)];
    return [m[0] - (a[0] + b[0]) / 2, m[1] - (a[1] + b[1]) / 2];
  },
  // A zero distance is identity: a single equation would have a zero derivative in the solution.
  distance: (c) => (g) => {
    const d = sub(g.point(c.a), g.point(c.b));
    return c.value === 0 ? d : [len(d) - c.value];
  },
  distancePointLine: (c, g0) => {
    const signed = (g: Geometry): number => {
      const [a, b] = lineOf(g, c.line);
      return cross(sub(b, a), sub(g.point(c.point), a)) / nonZero(len(sub(b, a)));
    };
    const s = sign(signed(g0));
    return (g) => [(c.value === 0 ? 1 : s) * signed(g) - c.value];
  },
  // Two equations, as the adapter's two primitives: the lines are parallel, and the point `a` of
  // the line a lies at the distance from the line b, on the side where it lies in the solution
  // (the adapter's distance is unsigned; at 0 it puts the point on the line). The adapter may
  // measure from another end of either line (its `measuredEnd`, for the way to the solution): of
  // parallel lines that is the same equation up to the first one, so the rows span the same space.
  // Of two lines with a common end the second equation is zero at 0 and counts for nothing, as
  // the adapter leaves it out.
  distanceLineLine: (c, g0) => {
    const scale = nonZero(Math.max(len(direction(g0, c.a)), len(direction(g0, c.b))));
    const signed = (g: Geometry): number => {
      const [a, b] = lineOf(g, c.b);
      return cross(sub(b, a), sub(lineOf(g, c.a)[0], a)) / nonZero(len(sub(b, a)));
    };
    const s = sign(signed(g0));
    return (g) => [cross(direction(g, c.a), direction(g, c.b)) / scale, (c.value === 0 ? 1 : s) * signed(g) - c.value];
  },
  // The centre lies the radius and the gap away from the line, on its side in the solution: the
  // general form of a tangency of a line and a circle with the gap added.
  distanceLineCircle: (c, g0) => {
    const side = (g: Geometry): number => {
      const [a, b] = lineOf(g, c.line);
      return cross(sub(b, a), sub(centerOf(g, c.curve), a)) / nonZero(len(sub(b, a)));
    };
    const s = sign(side(g0));
    return (g) => [s * side(g) - g.radius(c.curve) - c.value];
  },
  horizontalDistance: (c) => (g) => [g.point(c.b)[0] - g.point(c.a)[0] - c.value],
  verticalDistance: (c) => (g) => [g.point(c.b)[1] - g.point(c.a)[1] - c.value],
  // The angle is multiplied by a length so that the equation has the dimension of a length like
  // the others.
  angle: (c) => (g) => {
    const [u, v] = [direction(g, c.a), direction(g, c.b)];
    const off = Math.atan2(cross(u, v), dot(u, v)) - c.value;
    return [Math.atan2(Math.sin(off), Math.cos(off)) * Math.sqrt(len(u) * len(v))];
  },
  radius: (c) => (g) => [g.radius(c.curve) - c.value],
  diameter: (c) => (g) => [2 * g.radius(c.curve) - c.value],
};

// The condition of an arc that the document does not store as a constraint: both ends equally far
// from the center.
const arcRule =
  (arc: Extract<Curve, { type: 'arc' }>): Equations =>
  (g) => [len(sub(g.point(arc.start), g.point(arc.center))) - len(sub(g.point(arc.end), g.point(arc.center)))];

// ---------------------------------------------------------------- linear algebra

// A growing orthonormal basis. For each accepted vector it remembers how it is composed of the
// original accepted vectors, so that a dependent vector can be expressed as their combination.
class Basis {
  private readonly q: Float64Array[] = [];
  private readonly mix: Float64Array[] = []; // q[i] = Σ mix[i][j] · original[j], j ≤ i
  readonly members: number[] = []; // tags of the accepted vectors

  get size(): number {
    return this.q.length;
  }

  // Subtracts the projection onto the basis; returns the remainder and the components in the basis.
  // When most of the vector was subtracted, the remainder carries rounding error and is subtracted
  // a second time; otherwise one pass is enough.
  private reduce(vector: Float64Array): { rest: Float64Array; parts: Float64Array } {
    const rest = Float64Array.from(vector);
    const parts = new Float64Array(this.q.length);
    const before = norm(vector);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.q.length; i++) {
        const qi = this.q[i];
        let d = 0;
        for (let k = 0; k < rest.length; k++) d += rest[k] * qi[k];
        if (d === 0) continue;
        for (let k = 0; k < rest.length; k++) rest[k] -= d * qi[k];
        parts[i] += d;
      }
      if (norm(rest) > 0.5 * before) break;
    }
    return { rest, parts };
  }

  // The length of the part of the vector that does not lie in the space of the basis.
  outside(vector: Float64Array): Float64Array {
    return this.reduce(vector).rest;
  }

  // Adds a unit vector. If it is dependent, it does not add it and returns the coefficients of the
  // original accepted vectors (in the order of `members`) that compose it.
  add(vector: Float64Array, tag: number): Float64Array | undefined {
    const { rest, parts } = this.reduce(vector);
    const length = norm(rest);
    const count = this.q.length;
    if (length <= DEPENDENT) {
      const coefficients = new Float64Array(count);
      for (let i = 0; i < count; i++) for (let j = 0; j <= i; j++) coefficients[j] += parts[i] * this.mix[i][j];
      return coefficients;
    }
    const mix = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) for (let j = 0; j <= i; j++) mix[j] -= (parts[i] * this.mix[i][j]) / length;
    mix[count] = 1 / length;
    for (let k = 0; k < rest.length; k++) rest[k] /= length;
    this.q.push(rest);
    this.mix.push(mix);
    this.members.push(tag);
    return undefined;
  }
}

const normalized = (vector: Float64Array): Float64Array | undefined => {
  const length = norm(vector);
  return length > ZERO_ROW ? vector.map((value) => value / length) : undefined;
};

// ---------------------------------------------------------------- analysis

interface Row {
  owner: Id | undefined; // the constraint; undefined = the condition of an arc
  vector: Float64Array | undefined; // a unit row of the Jacobian matrix; undefined = zero
}

export class SketchAnalysis {
  readonly degreesOfFreedom: number;
  readonly residual: number; // the largest deviation of the equations in the solved state (mm)
  private readonly rows: Row[] = [];
  private readonly order: Id[]; // the constraints in the order of the document
  private readonly variables: { id: Id; kind: FreeEntity['kind']; at: number }[] = [];
  private readonly count: number; // the number of variables
  private readonly basis: Basis; // rows in the order of the document: older ones take precedence
  private readonly dual = new Map<number, Float64Array>(); // row → its components in the basis of the dependencies
  private readonly dependencies: number; // the dimension of the space of dependencies between the rows
  private surplusCache?: { redundant: Id[]; removable: Id[] };
  private freeCache?: FreeEntity[];

  // `input`: the input of the solver with the solved positions; driving constraints only, in the
  // order of the document.
  constructor(private readonly input: SolveInput) {
    const fixed = new Set(input.fixed);
    const at = new Map<Id, number>(); // point → index of x (y follows)
    const radiusAt = new Map<Id, number>();
    let count = 0;
    for (const id of Object.keys(input.points)) {
      if (fixed.has(id)) continue;
      at.set(id, count);
      this.variables.push({ id, kind: 'point', at: count });
      count += 2;
    }
    for (const [id, curve] of Object.entries(input.curves)) {
      if (curve.type !== 'circle' || fixed.has(id)) continue;
      radiusAt.set(id, count);
      this.variables.push({ id, kind: 'radius', at: count });
      count += 1;
    }
    this.count = count;
    const values = new Float64Array(count);
    for (const [id, index] of at) values.set([input.points[id].x, input.points[id].y], index);
    for (const [id, index] of radiusAt) values[index] = input.radii[id];

    // The equations are evaluated at positions relative to a point of the constraint (`origin`),
    // not to the origin of the sketch: a small shape far from the origin would otherwise lose
    // precision in the rounding of the coordinates. The derivative is taken by moving one variable
    // (`moved`) by `shift`.
    let origin: Vec2 = [0, 0];
    let moved = -1;
    let shift = 0;
    const geometry: Geometry = {
      point: (id) => {
        const index = at.get(id);
        if (index === undefined) return [input.points[id].x - origin[0], input.points[id].y - origin[1]];
        return [values[index] - origin[0] + (index === moved ? shift : 0), values[index + 1] - origin[1] + (index + 1 === moved ? shift : 0)];
      },
      curve: (id) => input.curves[id],
      radius: (id) => {
        const curve = input.curves[id];
        switch (curve.type) {
          case 'arc':
            return len(sub(geometry.point(curve.start), geometry.point(curve.center)));
          case 'circle':
          case 'line': {
            // a circle: its variable, or its value when it is fixed (a line is never asked)
            const index = radiusAt.get(id);
            return index === undefined ? input.radii[id] : values[index] + (index === moved ? shift : 0);
          }
          case 'spline':
            return neverAnOperand('a radius');
          default:
            return unreachable(curve, 'curve');
        }
      },
    };
    const pointsOf = (entity: Id): Id[] => {
      const curve = input.curves[entity];
      if (!curve) return [entity];
      return curvePoints(curve);
    };

    // Unit rows of the Jacobian matrix by numeric derivative; the step follows the size of the
    // geometry the constraint concerns. The row of an equation that determines nothing in this
    // state is undefined.
    let extent = 0;
    for (const p of Object.values(input.points)) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    let residual = 0;
    const derive = (build: (g0: Geometry) => Equations, entities: Id[]): (Float64Array | undefined)[] => {
      const points = [...new Set(entities.flatMap(pointsOf))];
      const outer = origin; // derive is called from inside `build` too (the question of tangency)
      origin = points.length > 0 ? [input.points[points[0]].x, input.points[points[0]].y] : [0, 0];
      const touched = new Set<number>();
      let size = 0;
      for (const point of points) {
        const index = at.get(point);
        if (index !== undefined) touched.add(index).add(index + 1);
        for (const other of points) size = Math.max(size, len(sub(geometry.point(point), geometry.point(other))));
      }
      for (const entity of entities) {
        const index = radiusAt.get(entity);
        if (index !== undefined) touched.add(index);
        const curve = input.curves[entity];
        if (curve) {
          switch (curve.type) {
            case 'line':
            case 'spline': // no radius (a spline is never an operand; its points are)
              break;
            case 'circle':
            case 'arc':
              size = Math.max(size, geometry.radius(entity));
              break;
            default:
              unreachable(curve, 'curve');
          }
        }
      }
      const step = STEP * (size > 0 ? size : nonZero(extent));
      const equations = build(geometry);
      const base = equations(geometry);
      for (const off of base) residual = Math.max(residual, Math.abs(off));
      const vectors = base.map(() => new Float64Array(count));
      for (const index of touched) {
        moved = index;
        shift = step;
        const plus = equations(geometry);
        shift = -step;
        const minus = equations(geometry);
        for (let e = 0; e < vectors.length; e++) vectors[e][index] = (plus[e] - minus[e]) / (2 * step);
      }
      moved = -1;
      origin = outer;
      return vectors.map(normalized);
    };

    // Tangency asks whether the other constraints hold a point on the circle. So the rows of
    // everything else are computed first; from them (only when needed) the basis is built against
    // which the question is answered.
    const ends = { points: input.points, fixed };
    const joined: JoinedByPlace = (line, arc) => {
      const [l, a] = [input.curves[line], input.curves[arc]];
      if (l?.type !== 'line' || a?.type !== 'arc') return undefined;
      const found = commonEnd(l, a, input.constraints, ends);
      return found?.byPlace ? found.end : undefined;
    };
    const arcRows = Object.values(input.curves).flatMap((curve) => (curve.type === 'arc' ? derive(() => arcRule(curve), [curve.center, curve.start, curve.end]) : []));
    this.order = Object.keys(input.constraints);
    const operands = (c: Constraint): Id[] => CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
    const rowsOf = (id: Id, held: Held): (Float64Array | undefined)[] => {
      const c = input.constraints[id];
      const build = EQUATIONS[c.type] as (c: Constraint, g0: Geometry, held: Held, joined: JoinedByPlace) => Equations;
      return derive((g0) => build(c, g0, held, joined), operands(c));
    };
    const built = new Map<Id, (Float64Array | undefined)[]>();
    for (const id of this.order) if (input.constraints[id].type !== 'tangent') built.set(id, rowsOf(id, () => false));
    let others: Basis | undefined;
    const held: Held = (point, round) => {
      const [row] = derive(() => (g) => [len(sub(g.point(point), centerOf(g, round))) - g.radius(round)], [point, round]);
      if (!row) return true; // the start of the arc lies on it by definition
      if (!others) {
        others = new Basis();
        for (const vector of [...arcRows, ...this.order.flatMap((id) => built.get(id) ?? [])]) if (vector) others.add(vector, 0);
      }
      return norm(others.outside(row)) <= DEPENDENT;
    };
    for (const id of this.order) if (!built.has(id)) built.set(id, rowsOf(id, held));
    for (const vector of arcRows) this.rows.push({ owner: undefined, vector });
    for (const id of this.order) for (const vector of built.get(id) as (Float64Array | undefined)[]) this.rows.push({ owner: id, vector });
    this.residual = residual;

    // The basis of the rows in the order of the document. Each dependent row gives one dependency:
    // itself minus a combination of the accepted rows. The components of a row in all the
    // dependencies (a column of the "dual" matrix) say whether and with what the row is
    // interchangeable.
    this.basis = new Basis();
    const relations: { row: number; coefficients: Float64Array; members: number[] }[] = [];
    this.rows.forEach((row, index) => {
      const coefficients = row.vector ? this.basis.add(row.vector, index) : new Float64Array(0);
      if (coefficients) relations.push({ row: index, coefficients, members: this.basis.members.slice(0, coefficients.length) });
    });
    this.dependencies = relations.length;
    relations.forEach((relation, k) => {
      const set = (row: number, value: number) => {
        let vector = this.dual.get(row);
        if (!vector) this.dual.set(row, (vector = new Float64Array(relations.length)));
        vector[k] = value;
      };
      set(relation.row, 1);
      relation.members.forEach((member, j) => Math.abs(relation.coefficients[j]) > SUPPORT && set(member, -relation.coefficients[j]));
    });
    this.degreesOfFreedom = count - this.basis.size;
  }

  private rowsOf(constraint: Id): number[] {
    const out: number[] = [];
    this.rows.forEach((row, index) => row.owner === constraint && out.push(index));
    return out;
  }

  // `redundant`: the constraints that follow from the others. `removable`: a set that can be
  // removed at once; it is removed from the newest constraint, so the older ones stay. Both in the
  // order of the document.
  surplus(): { redundant: Id[]; removable: Id[] } {
    if (this.surplusCache) return this.surplusCache;
    if (this.dependencies === 0) return (this.surplusCache = { redundant: [], removable: [] });
    const redundant = this.order.filter((id) => this.removableTogether(new Basis(), id));
    const removed = new Basis();
    const removable: Id[] = [];
    for (const id of [...redundant].reverse()) if (this.removableTogether(removed, id)) removable.push(id);
    return (this.surplusCache = { redundant, removable: removable.reverse() });
  }

  // Adds a constraint to the set to remove when that does not lower the rank; otherwise it leaves
  // the set unchanged. A set of rows can be removed exactly when their components in the
  // dependencies are linearly independent.
  private removableTogether(removed: Basis, constraint: Id): boolean {
    const units: Float64Array[] = [];
    for (const index of this.rowsOf(constraint)) {
      const vector = this.dual.get(index);
      const unit = vector && normalized(vector);
      if (!unit) return false;
      units.push(unit);
    }
    // the remainders of all rows of the constraint after subtracting the set must be independent
    // of each other too
    const rests = units.map((unit) => removed.outside(unit));
    const own = new Basis();
    for (const rest of rests) {
      const unit = norm(rest) > DEPENDENT ? normalized(rest) : undefined;
      if (!unit || own.add(unit, 0)) return false;
    }
    for (const unit of units) removed.add(unit, 0);
    return true;
  }

  // The entities that can still move: a point by 1 or 2 degrees, the radius of a circle by 1.
  // The motions the constraints allow form the space perpendicular to the rows of the constraints.
  // Its basis is obtained by projecting as many auxiliary vectors as the sketch has degrees of
  // freedom; the freedom of an entity is the rank of that basis restricted to the coordinates of
  // the entity.
  free(): FreeEntity[] {
    if (this.freeCache) return this.freeCache;
    const out: FreeEntity[] = [];
    const motions: Float64Array[] = [];
    const next = random(1);
    for (let attempt = 0; motions.length < this.degreesOfFreedom && attempt < 4 * this.degreesOfFreedom + 8; attempt++) {
      const probe = Float64Array.from({ length: this.count }, next);
      const rest = this.basis.outside(probe);
      for (let pass = 0; pass < 2; pass++) {
        for (const motion of motions) {
          let d = 0;
          for (let k = 0; k < rest.length; k++) d += rest[k] * motion[k];
          for (let k = 0; k < rest.length; k++) rest[k] -= d * motion[k];
        }
      }
      const length = norm(rest);
      if (length > PROBE * norm(probe)) motions.push(rest.map((value) => value / length));
    }
    const along = (index: number): Float64Array => Float64Array.from(motions, (motion) => motion[index]);
    for (const variable of this.variables) {
      const first = along(variable.at);
      let freedom = norm(first) > DEPENDENT ? 1 : 0;
      if (variable.kind === 'point') {
        const second = along(variable.at + 1);
        if (freedom === 1) {
          // the second direction counts only when it is not a multiple of the first
          let d = 0;
          for (let k = 0; k < first.length; k++) d += second[k] * first[k];
          const square = norm(first) ** 2;
          for (let k = 0; k < first.length; k++) second[k] -= (d / square) * first[k];
        }
        if (norm(second) > DEPENDENT) freedom += 1;
      }
      if (freedom > 0) out.push({ id: variable.id, kind: variable.kind, freedom });
    }
    return (this.freeCache = out);
  }

  // The set of other constraints the constraint follows from, from which nothing more can be
  // removed; undefined = it does not follow from them. There can be more such sets: `prefer` says
  // which constraints take precedence (a smaller number first).
  explain(constraint: Id, prefer: (other: Id) => number): Id[] | undefined {
    const own = this.rowsOf(constraint);
    if (own.length === 0) return undefined;
    const position = new Map(this.order.map((id, index) => [id, index]));
    const rank = (row: Row): number => (row.owner === undefined ? -1 : prefer(row.owner));
    const others = this.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.owner !== constraint && row.vector)
      .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index);
    const basis = new Basis();
    for (const { row, index } of others) basis.add(row.vector as Float64Array, index);
    const implied = new Set<Id>();
    for (const index of own) {
      const vector = this.rows[index].vector;
      if (!vector) continue; // an equation that determines nothing follows from nothing in particular
      const coefficients = basis.add(vector, index);
      if (!coefficients) return undefined;
      coefficients.forEach((value, j) => {
        const owner = this.rows[basis.members[j]].owner;
        if (Math.abs(value) > SUPPORT && owner !== undefined) implied.add(owner);
      });
    }
    // A constraint with two equations can get into the basis with only one of them, and another
    // constraint stands in for the second one and then stays in the set needlessly. So removing
    // from the set is tried, from the least suitable constraints: what can be left out without the
    // constraint ceasing to follow does not belong there.
    const targets = own.map((index) => this.rows[index].vector).filter((vector) => vector !== undefined);
    const follows = (from: Set<Id>): boolean => {
      const span = new Basis();
      this.rows.forEach((row, index) => row.vector && (row.owner === undefined || from.has(row.owner)) && span.add(row.vector, index));
      return targets.every((vector) => norm(span.outside(vector)) <= DEPENDENT);
    };
    const order = (id: Id): number => position.get(id) as number;
    for (const id of [...implied].sort((a, b) => prefer(b) - prefer(a) || order(b) - order(a))) {
      implied.delete(id);
      if (!follows(implied)) implied.add(id);
    }
    return [...implied].sort((a, b) => order(a) - order(b));
  }
}
