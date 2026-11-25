// Onshape's splines as splines of a sketch (design of 6h, "Splines"): which are converted (rule 1),
// as one spline over their control points (rule 2) or as a chain of Bezier pieces (rule 3), within a
// budget per sketch (rule 5); and the sampling of a chain for the match of a region (rule 7).
import { MAX_SPLINE_POINTS, bsplineBeziers, splineBeziers } from '../../packages/engine/src/index';
import type { V2 } from './common';

// The control points of splines one sketch may write, after the decomposition into pieces.
export const SPLINE_BUDGET = 193;

export const isSpline = (e: any) => e?.sketchEntityType === 'skSplineSegment' || e?.sketchEntityType === 'skSpline';

export type SplinePlan =
  | { ok: false; why: string }
  | { ok: true; whole: boolean; degree: number; control: V2[]; pieces: V2[][]; points: number };

// Rule 1 (what is not converted) and rules 2 and 3 (how): `geom` is the entity of the geometry
// endpoint, `feature` that of the feature (with the control points, in metres), `ends` the
// positions of the geometry endpoint's start and end points (mm, the Onshape sketch's 2D).
export function planSpline(geom: any, feature: any, ends: [V2 | undefined, V2 | undefined]): SplinePlan {
  const g = feature?.geometry;
  if (!g || !Array.isArray(g.controlPoints) || !Array.isArray(g.knots)) return { ok: false, why: 'the feature has no control points' };
  if (g.isRational) return { ok: false, why: 'rational' };
  if (g.isPeriodic) return { ok: false, why: 'periodic' };
  const p: number = g.degree;
  if (!Number.isInteger(p) || p < 1 || p > 3) return { ok: false, why: `of degree ${p}` };
  const flat: number[] = g.controlPoints;
  const knots: number[] = g.knots;
  if (flat.length % 2 || ![...flat, ...knots].every(Number.isFinite)) return { ok: false, why: 'a control point or a knot is not finite' };
  const control: V2[] = [];
  for (let i = 0; i < flat.length; i += 2) control.push([flat[i] * 1000, flat[i + 1] * 1000]);
  const n = control.length;
  if (n < p + 1) return { ok: false, why: `${n} control points for degree ${p}` };
  if (knots.length !== n + p + 1) return { ok: false, why: `${knots.length} knots for ${n} control points of degree ${p}` };
  for (let i = 1; i < knots.length; i++) if (knots[i] < knots[i - 1]) return { ok: false, why: 'the knots decrease' };
  const [lo, hi] = [knots[0], knots[knots.length - 1]];
  if (!(hi > lo)) return { ok: false, why: 'the knots span nothing' };
  const span = hi - lo;
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(span));
  for (let i = 0; i <= p; i++) if (!eq(knots[i], lo) || !eq(knots[knots.length - 1 - i], hi)) return { ok: false, why: 'the knots are not clamped' };
  const inner = knots.slice(p + 1, knots.length - p - 1);
  const counts = new Map<number, number>();
  for (const k of inner) counts.set(k, (counts.get(k) ?? 0) + 1);
  if ([...counts.values()].some((m) => m > p)) return { ok: false, why: `an inner knot repeated ${p + 1} times (a break in the curve)` };
  const [s0, s1] = [geom.startParameter ?? feature.startParam, geom.endParameter ?? feature.endParam];
  if (s0 !== undefined && s1 !== undefined && (!eq(s0, lo) || !eq(s1, hi))) return { ok: false, why: 'a segment that is not the whole knot range' };
  const near = (a: V2, b?: V2) => !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  if (!near(control[0], ends[0]) || !near(control[n - 1], ends[1])) return { ok: false, why: 'the first and the last control points are not its end points' };
  // rule 2: a clamped uniform cubic of up to 64 control points is the curve of D70 exactly
  const m = n - p;
  const uniform = p === 3 && n >= 4 && n <= MAX_SPLINE_POINTS && inner.every((k, i) => Math.abs(k - (lo + ((i + 1) * span) / m)) <= 1e-9 * span);
  if (uniform) return { ok: true, whole: true, degree: p, control, pieces: splineBeziers(control), points: n };
  // rule 3: the Bezier pieces
  const pieces = bsplineBeziers(control, knots, p);
  return { ok: true, whole: false, degree: p, control, pieces, points: pieces.length * p + 1 };
}

// A chain sampled for the match of a region: each Bezier piece halved until its control points are
// within 1e-4 mm of its chord (the engine's polyline keeps only the chord tolerance of 0.01 mm).
export function sampleChain(pieces: V2[][], tolerance = 1e-4): V2[] {
  const out: V2[] = [];
  const split = (b: V2[]): [V2[], V2[]] => {
    const left: V2[] = [b[0]];
    const right: V2[] = [b[b.length - 1]];
    let work = b;
    while (work.length > 1) {
      work = work.slice(1).map((q, i): V2 => [(work[i][0] + q[0]) / 2, (work[i][1] + q[1]) / 2]);
      left.push(work[0]);
      right.unshift(work[work.length - 1]);
    }
    return [left, right];
  };
  const flat = (b: V2[]) => {
    const [a, z] = [b[0], b[b.length - 1]];
    const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
    return b.every((q) => (L < 1e-12 ? Math.hypot(q[0] - a[0], q[1] - a[1]) : Math.abs((z[0] - a[0]) * (q[1] - a[1]) - (z[1] - a[1]) * (q[0] - a[0])) / L) <= tolerance);
  };
  const walk = (b: V2[], depth: number) => {
    if (depth > 24 || flat(b)) { out.push(b[b.length - 1]); return; }
    const [l, r] = split(b);
    walk(l, depth + 1);
    walk(r, depth + 1);
  };
  if (pieces.length) out.push(pieces[0][0]);
  for (const b of pieces) walk(b, 0);
  return out;
}

export function distanceToPolyline(line: V2[], [x, y]: V2): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [[ax, ay], [bx, by]] = [line[i], line[i + 1]];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y));
  }
  return best;
}
