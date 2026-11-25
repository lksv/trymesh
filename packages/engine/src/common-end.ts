// The rule of a tangency of a line and an arc at a common end (D52, D72), one function for the two
// that read it: the adapter of the solver, which solves such a tangency as "the radius to the common
// end is square to the line", and the analysis of the sketch (analysis.ts), which has to count the
// freedoms of what the adapter solved. Two copies of the rule disagreed at the edge of the fixed
// join (the review of 6f's implementation, kind 1): the adapter took the common end and the analysis
// the general form, which has a double root there, so one freedom was counted too many.
import type { Constraint, Curve, Id, Point2 } from './types';

// Two fixed points this close are one end of a tangency (D72), and, when the arc of the tangency is
// fixed too, also this close relative to its radius.
export const FIXED_JOIN = 1e-6;

// What decides one end: the points of the input (read only for fixed points) and the fixed set.
export interface TangentEnds {
  points: Record<Id, Point2>;
  fixed: ReadonlySet<Id>;
}

// Whether two ends are one end: one ID, or (`byPlace`) two fixed points at one place (D72): at most
// `FIXED_JOIN` mm apart and, when the arc is fixed (`radius`), within `FIXED_JOIN` of its radius.
// The end of a line of an imported outline and the start of the arc beside it are two IDs at one
// place, as those of two projections of 6b that meet are.
function sameEnd(p: Id, q: Id, radius: number | undefined, ends: TangentEnds | undefined): boolean {
  if (p === q) return true;
  if (!ends || !ends.fixed.has(p) || !ends.fixed.has(q)) return false;
  const [a, b] = [ends.points[p], ends.points[q]];
  if (!a || !b) return false;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return d <= FIXED_JOIN && (radius === undefined || d <= FIXED_JOIN * radius);
}

function find(line: Extract<Curve, { type: 'line' }>, arc: Extract<Curve, { type: 'arc' }>, constraints: Record<Id, Constraint>, ends: TangentEnds | undefined): Id | undefined {
  const lineEnds = [line.a, line.b];
  const arcEnds = [arc.start, arc.end];
  const fixedArc = ends !== undefined && ends.fixed.has(arc.center) && ends.fixed.has(arc.start) && ends.fixed.has(arc.end);
  const [c, s] = [ends?.points[arc.center], ends?.points[arc.start]];
  const radius = fixedArc && c && s ? Math.hypot(s.x - c.x, s.y - c.y) : undefined;
  const one = (p: Id, q: Id): boolean => sameEnd(p, q, radius, ends);
  const ofLine = (p: Id): boolean => lineEnds.some((q) => one(p, q));
  const shared = arcEnds.find((p) => ofLine(p));
  if (shared !== undefined) return shared;
  // the start before the end and the constraints by ID, so that the order of the keys of the
  // input does not matter (a line both of whose ends are joined to the ends of the arc)
  const joins = Object.keys(constraints)
    .sort()
    .map((id) => constraints[id])
    .filter((k): k is Extract<Constraint, { type: 'coincident' }> => k.type === 'coincident');
  return arcEnds.find((p) => joins.some((k) => (one(k.a, p) && ofLine(k.b)) || (one(k.b, p) && ofLine(k.a))));
}

// A tangency of a line and an arc at a common end: the end of the arc (`start` or `end`) that is one
// end with an end of the line (`sameEnd`), or that one coincident constraint of the input names
// together with a point that is one end with an end of the line. So the rule reads the same from
// either side: an own line held on the point of an outline's curve beside the arc, an own arc held
// on it, an own line that starts at `origin` where a fixed arc starts (D72). Decided from the curves
// and constraints and from the positions and the radius of fixed entities only (numbers of the
// input, never a variable of the estimate); a chain of two joins or an end held on the line by
// pointOnCurve is not read. `byPlace`: the end was found only through two fixed points at one place
// (by the IDs alone there is none), which the analysis has no other way to tell.
export function commonEnd(line: Extract<Curve, { type: 'line' }>, arc: Extract<Curve, { type: 'arc' }>, constraints: Record<Id, Constraint>, ends: TangentEnds): { end: Id; byPlace: boolean } | undefined {
  const end = find(line, arc, constraints, ends);
  return end !== undefined ? { end, byPlace: find(line, arc, constraints, undefined) === undefined } : undefined;
}
