// Adapter of the port SketchSolver over planegcs (the 2D solver of FreeCAD in WASM).
// The contract of the port is in docs/architecture/ports.md, section SketchSolver.
import { Algorithm, DebugMode, GcsWrapper, SolveStatus, init_planegcs_module } from '@salusoft89/planegcs';
import type { SketchPrimitive } from '@salusoft89/planegcs';
import { commonEnd } from '@trymesh/engine';
import type { Constraint, Curve, Id, Point2, SketchSolver, SolveInput, SolveResult, TangentEnds } from '@trymesh/engine';

export interface PlanegcsOptions {
  // Where to find planegcs.wasm (in the browser); in Node it is found on its own.
  locateFile?: (file: string) => string;
}

// Auxiliary constraints and primitives of the adapter. A user's ID may contain at most one slash
// (derived IDs of projected geometry), so two slashes at the start cannot collide.
const SYNTHETIC = '//';
const isSynthetic = (id: string) => id.startsWith(SYNTHETIC);
// A constraint of the engine that needs two primitives of the library (a fixed point: one per
// coordinate) carries the second one under this prefix; what the library says about it is said
// about the constraint.
const SECOND = `${SYNTHETIC}second/`;
const owners = (ids: string[]): Id[] => [...new Set(ids.map((id) => (id.startsWith(SECOND) ? id.slice(SECOND.length) : id)).filter((id) => !isSynthetic(id)))].sort();

const MERGED = 1e-7; // two points lie at the same place (relative to the size of the coordinates)
const SPREAD = 1e-3; // how far merged points are moved apart (relative to the size of the sketch)

type Primitive = SketchPrimitive;
type Loose = Record<string, unknown> & { id: string; type: string };

// One pass through the library.
interface Pass {
  ok: boolean; // the library found a solution and reports no conflict
  settled: boolean; // status Success: all constraints, the redundant ones included, are met
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;
  conflicting: Id[];
  redundant: Id[];
  // The redundant primitives as the library names them: of a fixed point one coordinate alone
  // may be redundant, and only that one is left out while dragging.
  redundantPrimitives: string[];
}

export async function createPlanegcsSolver(options: PlanegcsOptions = {}): Promise<SketchSolver> {
  const mod = await init_planegcs_module(options.locateFile ? { locateFile: options.locateFile } : undefined);

  const run = (input: SolveInput, extra: { drag?: SolveInput['drag']; without?: Set<string>; algorithm?: Algorithm; collapsed?: Set<Id>; flipped?: boolean } = {}): Pass => {
    const gcs = new GcsWrapper(new mod.GcsSystem());
    try {
      gcs.debug_mode = DebugMode.NoDebug; // otherwise the solver prints to standard output
      gcs.push_primitives_and_params(buildPrimitives(input, extra.drag, extra.without, extra.collapsed, extra.flipped) as unknown as Primitive[]);
      const status = gcs.solve(extra.algorithm);
      const conflicting = owners(gcs.get_gcs_conflicting_constraints());
      const redundantPrimitives = gcs.get_gcs_redundant_constraints();
      const redundant = owners(redundantPrimitives);
      const ok = (status === SolveStatus.Success || status === SolveStatus.Converged) && conflicting.length === 0;
      const pass: Pass = { ok, settled: status === SolveStatus.Success, points: {}, radii: {}, degreesOfFreedom: 0, conflicting, redundant, redundantPrimitives };
      if (!ok) return pass;
      gcs.apply_solution();
      for (const p of gcs.sketch_index.get_primitives() as unknown as Loose[]) {
        if (p.type === 'point') pass.points[p.id] = { x: p.x as number, y: p.y as number };
        else if (p.type === 'circle') pass.radii[p.id] = p.radius as number;
      }
      pass.degreesOfFreedom = gcs.gcs.dof();
      return pass;
    } finally {
      gcs.destroy_gcs_module(); // WASM memory is freed by hand
    }
  };

  return {
    solve(input: SolveInput): SolveResult {
      // On failure the input is returned; the count of degrees of freedom then has no meaning.
      const failure = (conflicting: Id[], redundant: Id[]): SolveResult => ({
        status: conflicting.length > 0 ? 'conflict' : 'failed',
        points: clonePoints(input.points),
        radii: { ...input.radii },
        degreesOfFreedom: 0,
        conflicting,
        redundant,
      });

      // Merged symmetry. The library computes the symmetry of two points (and the midpoint of a line)
      // from the line joining them; when the points lie at the same place, it reports the constraint
      // as a conflict even though it is met (both points on the axis). When such a constraint is
      // among the conflicting ones, two fallbacks are tried:
      // 1. move the merged points a little apart and solve the original system (a solution in which
      //    the points do not merge is found this way: a width dimension, dragging one of the points),
      // 2. replace the constraint by its merged form (the points coincide and a point on the axis);
      //    every such solution meets the original constraint. The form then holds for the further
      //    passes of this solve too.
      let collapsed = new Set<Id>();
      const attempt = (from: SolveInput, extra: { drag?: SolveInput['drag']; without?: Set<string> }, first: boolean): Pass => {
        let pass = run(from, { ...extra, collapsed });
        // The default algorithm (DogLeg) sometimes does not get there where another one does; FreeCAD does the same.
        if (first && !pass.ok && pass.conflicting.length === 0) pass = run(from, { ...extra, collapsed, algorithm: Algorithm.LevenbergMarquardt });
        // A distance of two lines measured from the other line (D75, `measuredEnd`): the same
        // constraint, which the library may reach where it did not reach the first form. A pass
        // that got there by shrinking one of the lines to a point is not taken: the failure stays
        // a failure, without a conflict found in a state the sketch never had.
        if (first && !pass.ok && pass.conflicting.length === 0 && Object.values(from.constraints).some((c) => c.type === 'distanceLineLine' && c.driving)) {
          for (const algorithm of [undefined, Algorithm.LevenbergMarquardt]) {
            const turned = run(from, { ...extra, collapsed, flipped: true, algorithm });
            if (turned.ok && !collapsedLine(from, turned.points)) return turned;
          }
        }
        if (pass.ok) return pass;
        const merged = mergedPairs(from).filter((id) => !collapsed.has(id));
        if (!merged.some((id) => pass.conflicting.includes(id))) return pass;
        if (first) {
          const apart = run(spread(from, merged), { ...extra, collapsed });
          if (apart.ok) return apart;
        }
        const all = new Set([...collapsed, ...merged]);
        const forced = run(from, { ...extra, collapsed: all });
        if (!forced.ok) return pass;
        collapsed = all;
        return forced;
      };

      // Dragging: a redundant constraint would be reported as a conflict with the temporary target of
      // the drag. So it is first found out without the drag which constraints are redundant, and they
      // are left out while dragging.
      // (Primitives, not constraints: a fixed point whose one coordinate repeats another constraint
      // must keep the other coordinate, or the drag would move it.)
      let without: Set<string> | undefined;
      if (input.drag) {
        const plain = attempt(input, {}, true);
        if (!plain.ok) return failure(plain.conflicting, plain.redundant);
        without = new Set(plain.redundantPrimitives);
        collapsed = new Set(); // a drag may move merged points apart again
      }
      let pass = attempt(input, { drag: input.drag, without }, true);
      if (!pass.ok) return failure(pass.conflicting, pass.redundant);

      // Verification and diagnostics from the state found. The library reports the degrees of freedom
      // and the redundant constraints by the initial estimate, not by the result, and in the status
      // Converged it may leave a redundant constraint unmet. So it solves again from the result until
      // the state is settled.
      for (let round = 0; round < 4; round++) {
        const next = attempt({ ...input, points: pass.points, radii: { ...input.radii, ...pass.radii } }, {}, false);
        if (!next.ok) return failure(next.conflicting, next.redundant);
        const moved = Object.keys(next.points).some((id) => next.points[id].x !== pass.points[id].x || next.points[id].y !== pass.points[id].y);
        pass = next;
        if (next.settled && !moved) break;
      }
      if (!pass.settled) return failure([], pass.redundant);

      // A solution that is not usable geometry is not returned: infinite values, a radius that is not
      // positive (for a tangency the library keeps the outer or the inner contact by the initial
      // estimate), an arc with its ends on different radii.
      const fixed = new Set(input.fixed);
      const usable =
        Object.values(pass.points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
        Object.values(pass.radii).every((r) => Number.isFinite(r) && r > 0) &&
        Object.values(input.curves).every((curve) => {
          if (curve.type !== 'arc') return true;
          const [c, s, e] = [pass.points[curve.center], pass.points[curve.start], pass.points[curve.end]];
          const [rs, re] = [Math.hypot(s.x - c.x, s.y - c.y), Math.hypot(e.x - c.x, e.y - c.y)];
          return Math.abs(rs - re) <= 1e-6 * Math.max(1, rs);
        });
      if (!usable) return failure([], pass.redundant);
      // a fixed circle keeps its radius bit for bit, even when its centre moves
      for (const id of Object.keys(pass.radii)) if (fixed.has(id)) pass.radii[id] = input.radii[id];
      return { status: 'solved', points: pass.points, radii: pass.radii, degreesOfFreedom: pass.degreesOfFreedom, conflicting: [], redundant: pass.redundant };
    },
  };
}

const clonePoints = (points: Record<Id, Point2>): Record<Id, Point2> =>
  Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { x: p.x, y: p.y }]));

// The primitives are ordered by ID so that the same input always gives the same output
// regardless of the order of the keys in the objects.
// The pair of points from which the library computes the symmetry: the symmetric points, for the
// midpoint of a line its ends, for the midpoint of two points those two.
function pairOf(c: Constraint, curves: Record<Id, Curve>): [Id, Id] | undefined {
  if (c.type === 'symmetric' || c.type === 'midpointPoints') return [c.a, c.b];
  const line = c.type === 'midpoint' ? curves[c.line] : undefined;
  return line?.type === 'line' ? [line.a, line.b] : undefined;
}

// Constraints of symmetry and of a midpoint whose pair of points merges in the input.
function mergedPairs(input: SolveInput): Id[] {
  return Object.keys(input.constraints).filter((id) => {
    const pair = pairOf(input.constraints[id], input.curves);
    if (!pair) return false;
    const [p, q] = [input.points[pair[0]], input.points[pair[1]]];
    return Math.hypot(p.x - q.x, p.y - q.y) <= MERGED * Math.max(1, Math.abs(p.x), Math.abs(p.y));
  });
}

// The input in which the merged pairs of the given constraints are moved apart: symmetric points
// perpendicular to the axis, the ends of a line in the direction x. Fixed points are not moved.
function spread(input: SolveInput, constraints: Id[]): SolveInput {
  const fixed = new Set(input.fixed);
  const points = clonePoints(input.points);
  let extent = 0;
  for (const p of Object.values(input.points)) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  const step = SPREAD * (extent > 0 ? extent : 1);
  for (const id of constraints) {
    const c = input.constraints[id];
    const [a, b] = pairOf(c, input.curves) as [Id, Id];
    let normal = { x: 1, y: 0 };
    if (c.type === 'symmetric') {
      const axis = input.curves[c.line] as Extract<Curve, { type: 'line' }>;
      const [p, q] = [input.points[axis.a], input.points[axis.b]];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length > 0) normal = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
    }
    if (!fixed.has(a)) points[a] = { x: points[a].x - step * normal.x, y: points[a].y - step * normal.y };
    if (!fixed.has(b)) points[b] = { x: points[b].x + step * normal.x, y: points[b].y + step * normal.y };
  }
  return { ...input, points };
}

function buildPrimitives(input: SolveInput, drag?: SolveInput['drag'], without?: Set<string>, collapsed?: Set<Id>, flipped?: boolean): Loose[] {
  const fixed = new Set(input.fixed);
  for (const id of [...Object.keys(input.points), ...Object.keys(input.curves), ...Object.keys(input.constraints)]) {
    if (isSynthetic(id)) throw new Error(`solver: the ID "${id}" collides with the auxiliary IDs of the adapter`);
  }
  // Points and circles (a fixed radius) may be fixed; the adapter cannot fix anything else.
  for (const id of fixed) {
    if (!input.points[id] && input.curves[id]?.type !== 'circle') throw new Error(`solver: "${id}" in fixed is neither a point nor a circle`);
  }
  const out: Loose[] = [];
  const sorted = <T>(record: Record<Id, T>) => Object.keys(record).sort().map((id) => [id, record[id] as T] as const);
  const point = (id: Id): Point2 => {
    const p = input.points[id];
    if (!p) throw new Error(`solver: unknown point ${id}`);
    return p;
  };

  // A point with a fixed-point constraint starts at its coordinates. The library finds them
  // anyway, but from a rough estimate it may stop in a place where a dimension that agrees with
  // them looks like a conflict (a point on the axis through the other end of a distance).
  const start = new Map<Id, Point2>();
  for (const [, constraint] of sorted(input.constraints)) {
    if (constraint.type === 'fixed' && !fixed.has(constraint.point)) start.set(constraint.point, { x: constraint.x, y: constraint.y });
  }
  for (const [id, p] of sorted(input.points)) out.push({ id, type: 'point', x: start.get(id)?.x ?? p.x, y: start.get(id)?.y ?? p.y, fixed: fixed.has(id) });

  for (const [id, curve] of sorted(input.curves)) {
    switch (curve.type) {
      case 'line':
        point(curve.a);
        point(curve.b);
        out.push({ id, type: 'line', p1_id: curve.a, p2_id: curve.b });
        break;
      case 'circle': {
        point(curve.center);
        const radius = input.radii[id];
        if (radius === undefined) throw new Error(`solver: the circle ${id} has no radius`);
        out.push({ id, type: 'circle', c_id: curve.center, radius });
        if (fixed.has(id)) out.push({ id: `${SYNTHETIC}fixRadius/${id}`, type: 'circle_radius', c_id: id, radius });
        break;
      }
      case 'arc': {
        // An arc: the library wants the radius and the angles on input and the rules of the arc as a constraint.
        const c = point(curve.center);
        const s = point(curve.start);
        const e = point(curve.end);
        const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
        let endAngle = Math.atan2(e.y - c.y, e.x - c.x);
        if (endAngle <= startAngle) endAngle += 2 * Math.PI; // counter-clockwise
        out.push({
          id,
          type: 'arc',
          c_id: curve.center,
          start_id: curve.start,
          end_id: curve.end,
          radius: Math.hypot(s.x - c.x, s.y - c.y),
          start_angle: startAngle,
          end_angle: endAngle,
        });
        out.push({ id: `${SYNTHETIC}arcRules/${id}`, type: 'arc_rules', a_id: id });
        break;
      }
      case 'spline':
        // D70: the solver sees only the points of a spline; its control points are points of the
        // input (checked as the ends of a line are), and nothing is added for the curve
        for (const p of curve.points) point(p);
        break;
      default: {
        const unknown: never = curve; // a kind added to Curve needs its case here
        throw new Error(`solver: unknown kind of curve at ${id}`, { cause: unknown });
      }
    }
  }

  for (const [id, constraint] of sorted(input.constraints)) {
    if ('driving' in constraint && !constraint.driving) continue; // reference dimensions are computed by the engine
    if (constraint.type === 'fixed') {
      // two primitives, each left out on its own
      point(constraint.point);
      if (!without?.has(id)) out.push({ id, type: 'coordinate_x', p_id: constraint.point, x: constraint.x });
      if (!without?.has(`${SECOND}${id}`)) out.push({ id: `${SECOND}${id}`, type: 'coordinate_y', p_id: constraint.point, y: constraint.y });
      continue;
    }
    if (constraint.type === 'distanceLineLine') {
      // two primitives, each left out on its own (D75): the lines parallel, and an end of one line
      // (`measuredEnd`) at the distance from the other (on it at 0: the unsigned distance has a
      // kink there). A `parallel` of the same lines beside it leaves only the first one redundant.
      const [a, b] = [lineOf(id, constraint.a, input.curves), lineOf(id, constraint.b, input.curves)];
      for (const end of [a.a, a.b, b.a, b.b]) point(end);
      if (!without?.has(id)) out.push({ id, type: 'parallel', l1_id: constraint.a, l2_id: constraint.b });
      // Two lines with a common end that are parallel lie on one line already: at 0 the second
      // primitive would say nothing (the library would call the constraint redundant), so it is
      // left out. At another value there is no solution, and the distance is measured from the
      // common end itself, an end of the line it is measured to: the library then names this
      // constraint as the conflict in its first pass. Measured from a far end, it shrank a line
      // to a point and named another constraint (second review of D75).
      const common = [a.a, a.b].find((end) => end === b.a || end === b.b);
      if (!without?.has(`${SECOND}${id}`) && !(common !== undefined && constraint.value === 0)) {
        const from = common !== undefined ? { point: common, line: constraint.b } : measuredEnd(constraint, a, b, fixed, flipped === true);
        out.push(constraint.value === 0 ? { id: `${SECOND}${id}`, type: 'point_on_line_pl', p_id: from.point, l_id: from.line } : { id: `${SECOND}${id}`, type: 'p2l_distance', p_id: from.point, l_id: from.line, distance: constraint.value });
      }
      continue;
    }
    if (without?.has(id)) continue;
    if (collapsed?.has(id)) {
      // the merged form: both points of the pair at one place, which lies on the axis (at the midpoint of the line, or is the midpoint)
      const [a, b] = pairOf(constraint, input.curves) as [Id, Id];
      out.push({ id, type: 'p2p_coincident', p1_id: a, p2_id: b });
      if (constraint.type === 'symmetric') out.push({ id: `${SYNTHETIC}onAxis/${id}`, type: 'point_on_line_pl', p_id: a, l_id: constraint.line });
      else if (constraint.type === 'midpoint' || constraint.type === 'midpointPoints') out.push({ id: `${SYNTHETIC}middle/${id}`, type: 'p2p_coincident', p1_id: constraint.point, p2_id: a });
      continue;
    }
    out.push({ id, ...translate(id, constraint, input.curves, input.constraints, { points: input.points, fixed }) });
  }

  if (drag) {
    const { point: p, target } = drag;
    point(p);
    out.push({ id: `${SYNTHETIC}drag/x`, type: 'coordinate_x', p_id: p, x: target.x, temporary: true });
    out.push({ id: `${SYNTHETIC}drag/y`, type: 'coordinate_y', p_id: p, y: target.y, temporary: true });
  }
  return out;
}

// Each variant of a constraint of the engine has exactly one counterpart in the library; it varies only by the kind of curve.
// (A fixed point is the exception with two primitives and is translated by the caller.)
// A tangency of a line and an arc at a common end (D52, D72): the rule is the engine's `commonEnd`,
// which the analysis of the sketch reads too, so that the two never disagree about the form.
type Ends = TangentEnds;

// A spline is never an operand of a constraint (D70): the engine refuses it before the solver.
const neverASpline = (id: Id): never => {
  throw new Error(`solver: constraint ${id}: a spline is never an operand of a constraint`);
};

// The end the distance of two lines is measured from, and the line it is measured to (D75). Of
// parallel lines every end of one is as far from the other, so the choice does not change the
// meaning; it decides whether the library gets there from a freehand estimate. A fixed end
// measured to a free line makes that line turn and move at once (an axis of the origin as the
// first line failed from 45°); an end of the free line measured to the held one only moves it.
// So: an end that is not fixed before a fixed one, in the order a.a, a.b, b.a, b.b. `other` takes
// the first end of the other line by the same rule: the second try of a solve that failed, since
// two free lines of which constraints hold one look alike here. (Lines with a common end do not
// come here: the caller measures from that end.)
type LineCurve = Extract<Curve, { type: 'line' }>;
function measuredEnd(c: { a: Id; b: Id }, a: LineCurve, b: LineCurve, fixed: ReadonlySet<Id>, other: boolean): { point: Id; line: Id } {
  const ends = [
    { point: a.a, line: c.b },
    { point: a.b, line: c.b },
    { point: b.a, line: c.a },
    { point: b.b, line: c.a },
  ].map((end, index) => ({ ...end, held: fixed.has(end.point) ? 1 : 0, index }));
  ends.sort((p, q) => p.held - q.held || p.index - q.index);
  return (other ? ends.find((end) => end.line !== ends[0].line) : undefined) ?? ends[0];
}

// Did a pass shrink a line of a driving distance of two lines to a point? Such a "solution" meets
// the parallelism by having no direction, with anything else the sketch asks; the second try of a
// solve must not be taken for one (second review of D75).
const COLLAPSED = 1e-6; // of the length the line had in the input
function collapsedLine(input: SolveInput, points: Record<Id, Point2>): boolean {
  const length = (at: Record<Id, Point2>, line: LineCurve): number => Math.hypot(at[line.b].x - at[line.a].x, at[line.b].y - at[line.a].y);
  return Object.values(input.constraints).some(
    (c) =>
      c.type === 'distanceLineLine' &&
      c.driving &&
      [c.a, c.b].some((id) => {
        const line = input.curves[id];
        return line?.type === 'line' && length(points, line) <= COLLAPSED * length(input.points, line);
      }),
  );
}

// The line a constraint names, or an error of the adapter.
function lineOf(id: Id, curveId: Id, curves: Record<Id, Curve>): Extract<Curve, { type: 'line' }> {
  const curve = curves[curveId];
  if (curve?.type !== 'line') throw new Error(`solver: the constraint ${id} expects a line, ${curveId} is ${curve?.type ?? 'unknown'}`);
  return curve;
}

function translate(id: Id, c: Exclude<Constraint, { type: 'fixed' | 'distanceLineLine' }>, curves: Record<Id, Curve>, constraints: Record<Id, Constraint>, ends: Ends): Record<string, unknown> & { type: string } {
  const kind = (curveId: Id): Curve['type'] => {
    const curve = curves[curveId];
    if (!curve) throw new Error(`solver: the constraint ${id} refers to an unknown curve ${curveId}`);
    return curve.type;
  };
  const line = (curveId: Id): Id => {
    if (kind(curveId) !== 'line') throw new Error(`solver: the constraint ${id} expects a line, ${curveId} is ${kind(curveId)}`);
    return curveId;
  };
  switch (c.type) {
    case 'coincident':
      return { type: 'p2p_coincident', p1_id: c.a, p2_id: c.b };
    case 'pointOnCurve': {
      const k = kind(c.curve);
      switch (k) {
        case 'line':
          return { type: 'point_on_line_pl', p_id: c.point, l_id: c.curve };
        case 'circle':
          return { type: 'point_on_circle', p_id: c.point, c_id: c.curve };
        case 'arc':
          return { type: 'point_on_arc', p_id: c.point, a_id: c.curve };
        case 'spline':
          return neverASpline(id);
        default: {
          const unknown: never = k;
          throw new Error(`solver: constraint ${id}: unknown kind of curve ${c.curve}`, { cause: unknown });
        }
      }
    }
    case 'horizontal':
      return { type: 'horizontal_l', l_id: line(c.line) };
    case 'vertical':
      return { type: 'vertical_l', l_id: line(c.line) };
    case 'horizontalPoints':
      return { type: 'horizontal_pp', p1_id: c.a, p2_id: c.b };
    case 'verticalPoints':
      return { type: 'vertical_pp', p1_id: c.a, p2_id: c.b };
    case 'parallel':
      return { type: 'parallel', l1_id: line(c.a), l2_id: line(c.b) };
    case 'perpendicular':
      return { type: 'perpendicular_ll', l1_id: line(c.a), l2_id: line(c.b) };
    case 'equalLength':
      return { type: 'equal_length', l1_id: line(c.a), l2_id: line(c.b) };
    case 'equalRadius': {
      // operand order of the library: circle before arc
      const [first, second] = kind(c.a) === 'arc' && kind(c.b) === 'circle' ? [c.b, c.a] : [c.a, c.b];
      const [k1, k2] = [kind(first), kind(second)];
      const refused = (): never => {
        throw new Error(`solver: constraint ${id}: equal radius needs circles or arcs`);
      };
      const unknown = (k: never): never => {
        throw new Error(`solver: constraint ${id}: unknown kind of curve (${String(k)})`);
      };
      switch (k1) {
        case 'circle':
          switch (k2) {
            case 'circle':
              return { type: 'equal_radius_cc', c1_id: first, c2_id: second };
            case 'arc':
              return { type: 'equal_radius_ca', c1_id: first, a2_id: second };
            case 'line':
            case 'spline':
              return refused();
            default:
              return unknown(k2);
          }
        case 'arc':
          switch (k2) {
            case 'arc':
              return { type: 'equal_radius_aa', a1_id: first, a2_id: second };
            case 'circle': // ordered circle first above
            case 'line':
            case 'spline':
              return refused();
            default:
              return unknown(k2);
          }
        case 'line':
        case 'spline':
          return refused();
        default:
          return unknown(k1);
      }
    }
    case 'tangent': {
      // operand order of the library: line, circle, arc
      const rank = { line: 0, circle: 1, arc: 2, spline: 3 } as const; // a spline is never an operand (D70): its pair throws below
      const [first, second] = rank[kind(c.a)] <= rank[kind(c.b)] ? [c.a, c.b] : [c.b, c.a];
      const pair = `${kind(first)}-${kind(second)}`;
      if (pair === 'line-circle') return { type: 'tangent_lc', l_id: first, c_id: second };
      if (pair === 'line-arc') {
        // At a common end the library's form ("the centre is the radius away from the line") has
        // a double root: its derivative there is that of the rule of the arc, so the library calls
        // the tangency redundant when the estimate is exact and reports it as a conflict after any
        // change. "The radius to the common end is square to the line" says the same wherever the
        // line has a length, without the double root (D52; the engine's analysis reads it so too).
        const [l, a] = [curves[first] as Extract<Curve, { type: 'line' }>, curves[second] as Extract<Curve, { type: 'arc' }>];
        const shared = commonEnd(l, a, constraints, ends)?.end;
        if (shared !== undefined) return { type: 'perpendicular_pppp', l1p1_id: a.center, l1p2_id: shared, l2p1_id: l.a, l2p2_id: l.b };
        return { type: 'tangent_la', l_id: first, a_id: second };
      }
      if (pair === 'circle-circle') return { type: 'tangent_cc', c1_id: first, c2_id: second };
      if (pair === 'circle-arc') return { type: 'tangent_ca', c_id: first, a_id: second };
      if (pair === 'arc-arc') return { type: 'tangent_aa', a1_id: first, a2_id: second };
      throw new Error(`solver: constraint ${id}: tangency of two lines makes no sense`);
    }
    case 'symmetric':
      return { type: 'p2p_symmetric_ppl', p1_id: c.a, p2_id: c.b, l_id: line(c.line) };
    case 'midpoint': {
      // a point is the midpoint of a line when its ends are symmetric about it
      const ends = curves[line(c.line)] as Extract<Curve, { type: 'line' }>;
      return { type: 'p2p_symmetric_ppp', p1_id: ends.a, p2_id: ends.b, p_id: c.point };
    }
    case 'midpointPoints': // a and b symmetric about the point
      return { type: 'p2p_symmetric_ppp', p1_id: c.a, p2_id: c.b, p_id: c.point };
    case 'distance':
      return { type: 'p2p_distance', p1_id: c.a, p2_id: c.b, distance: c.value };
    case 'distancePointLine':
      return { type: 'p2l_distance', p_id: c.point, l_id: line(c.line), distance: c.value };
    case 'distanceLineCircle': {
      // the library's form: |the distance of the centre from the line| = the radius + the gap; it
      // takes an arc as its circle
      const [l, k] = [line(c.line), kind(c.curve)];
      if (k !== 'circle' && k !== 'arc') throw new Error(`solver: constraint ${id}: a distance from a line needs a circle or an arc, ${c.curve} is ${k}`);
      return { type: 'c2ldistance', c_id: c.curve, l_id: l, dist: c.value };
    }
    case 'horizontalDistance': // signed: b.x − a.x = value
      return { type: 'difference', param1: { o_id: c.a, prop: 'x' }, param2: { o_id: c.b, prop: 'x' }, difference: c.value };
    case 'verticalDistance': // signed: b.y − a.y = value
      return { type: 'difference', param1: { o_id: c.a, prop: 'y' }, param2: { o_id: c.b, prop: 'y' }, difference: c.value };
    case 'angle': // from the direction of line a to the direction of line b, counter-clockwise
      return { type: 'l2l_angle_ll', l1_id: line(c.a), l2_id: line(c.b), angle: c.value };
    case 'radius': {
      const k = kind(c.curve);
      switch (k) {
        case 'arc':
          return { type: 'arc_radius', a_id: c.curve, radius: c.value };
        case 'spline':
          return neverASpline(id);
        case 'circle':
        case 'line': // validation lets only circles and arcs in
          return { type: 'circle_radius', c_id: c.curve, radius: c.value };
        default: {
          const unknown: never = k;
          throw new Error(`solver: constraint ${id}: unknown kind of curve ${c.curve} (${String(unknown)})`);
        }
      }
    }
    case 'diameter': {
      const k = kind(c.curve);
      switch (k) {
        case 'arc':
          return { type: 'arc_diameter', a_id: c.curve, diameter: c.value };
        case 'spline':
          return neverASpline(id);
        case 'circle':
        case 'line': // validation lets only circles and arcs in
          return { type: 'circle_diameter', c_id: c.curve, diameter: c.value };
        default: {
          const unknown: never = k;
          throw new Error(`solver: constraint ${id}: unknown kind of curve ${c.curve} (${String(unknown)})`);
        }
      }
    }
  }
}
