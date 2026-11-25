// The geometry of a spline of a sketch (D70): a clamped, uniform, non-rational B-spline of degree
// min(3, n − 1) over n control points. A leaf of the engine: pure functions over positions; it
// imports only the types and util.ts, and nothing here reads a sketch.
// - `bsplineBeziers`: the Bezier pieces of a B-spline of any knots (Boehm's knot insertion), for the
//   spline of the sketch and for the importers (6f, 6h);
// - `splinePolyline`: the polyline within the chord tolerance, which the profile and the app read;
// - `splineThrough`, `splineBox`: where the curve runs, without a tolerance (`get_sketch`).
import type { Vec2 } from './types';
import { LENGTH_TOLERANCE, dist2 } from './util';

// The limits of a spline, checked by the validator of a curve.
export const MIN_SPLINE_POINTS = 3;
export const MAX_SPLINE_POINTS = 64;
// The cap of the steps of one Bezier piece, as the cap of `segments` for arcs: above it the polyline
// no longer keeps the chord tolerance.
export const MAX_SPLINE_PIECES = 4096;

// The degree of a spline of `n` entries of `points` (a closed spline counts its closing entry).
export const splineDegree = (n: number): 2 | 3 => (n >= 4 ? 3 : 2);

// The Bezier pieces of a non-rational B-spline of degree `degree` with the knot vector `knots`
// (non-decreasing, `control.length + degree + 1` long, clamped: the first and the last knot repeated
// `degree + 1` times): every inner knot inserted until it is `degree` times there (Boehm), then one
// piece of `degree + 1` points per span of non-zero length, in order.
export function bsplineBeziers(control: readonly Vec2[], knots: readonly number[], degree: number): Vec2[][] {
  const p = degree;
  if (p < 1 || control.length < p + 1 || knots.length !== control.length + p + 1) throw new Error(`a B-spline of degree ${p} over ${control.length} points needs ${control.length + p + 1} knots, not ${knots.length}`);
  let U = [...knots];
  let P = control.map((q): Vec2 => [q[0], q[1]]);
  const [low, high] = [U[p], U[U.length - p - 1]];
  const inner = [...new Set(U.filter((u) => u > low && u < high))].sort((x, y) => x - y);
  for (const u of inner) {
    const multiplicity = U.filter((v) => v === u).length;
    for (let r = multiplicity; r < p; r++) {
      // the span k with U[k] <= u < U[k + 1]
      let k = p;
      while (k + 1 < U.length && U[k + 1] <= u) k++;
      const Q: Vec2[] = [];
      for (let i = 0; i <= P.length; i++) {
        if (i <= k - p) Q.push(P[i]);
        else if (i > k) Q.push(P[i - 1]);
        else {
          const a = (u - U[i]) / (U[i + p] - U[i]);
          Q.push([(1 - a) * P[i - 1][0] + a * P[i][0], (1 - a) * P[i - 1][1] + a * P[i][1]]);
        }
      }
      U = [...U.slice(0, k + 1), u, ...U.slice(k + 1)];
      P = Q;
    }
  }
  // On a span [U[k], U[k + 1]) of non-zero length the curve is the Bezier curve of P[k − p .. k].
  const pieces: Vec2[][] = [];
  for (let k = p; k < U.length - p - 1; k++) if (U[k + 1] > U[k]) pieces.push(P.slice(k - p, k + 1));
  return pieces;
}

// The pieces of a spline of the sketch: its clamped uniform knots (0 repeated p + 1 times, 1 to
// m − 1, m repeated p + 1 times, for m = n − p spans).
export function splineBeziers(control: readonly Vec2[]): Vec2[][] {
  const n = control.length;
  const p = splineDegree(n);
  const m = n - p;
  const knots = [...Array<number>(p + 1).fill(0), ...Array.from({ length: m - 1 }, (_, i) => i + 1), ...Array<number>(p + 1).fill(m)];
  return bsplineBeziers(control, knots, p);
}

// A point of a Bezier piece at the parameter t (de Casteljau).
export function bezierAt(bezier: readonly Vec2[], t: number): Vec2 {
  const work = bezier.map((q): Vec2 => [q[0], q[1]]);
  for (let level = work.length - 1; level > 0; level--) {
    for (let i = 0; i < level; i++) work[i] = [(1 - t) * work[i][0] + t * work[i + 1][0], (1 - t) * work[i][1] + t * work[i + 1][1]];
  }
  return work[0];
}

// How many straight pieces a Bezier piece is divided into for the chord tolerance:
// ceil(sqrt(M / (8 · tolerance))), at least 1 and at most `MAX_SPLINE_PIECES`, where M is the largest
// length of the control points of the second derivative of the piece over its parameter t in
// [0, 1] (p (p − 1) times the second differences of its points). The second derivative lies in the
// convex hull of those points, so M bounds it, and a chord over a step h of t lies within h² M / 8
// of the curve.
export function splinePieces(bezier: readonly Vec2[], chordTolerance: number): number {
  const p = bezier.length - 1;
  let M = 0;
  for (let i = 0; i + 2 <= p; i++) {
    const x = bezier[i + 2][0] - 2 * bezier[i + 1][0] + bezier[i][0];
    const y = bezier[i + 2][1] - 2 * bezier[i + 1][1] + bezier[i][1];
    M = Math.max(M, p * (p - 1) * Math.hypot(x, y));
  }
  const steps = Math.ceil(Math.sqrt(M / (8 * chordTolerance)));
  return Number.isFinite(steps) ? Math.min(MAX_SPLINE_PIECES, Math.max(1, steps)) : M > 0 ? MAX_SPLINE_PIECES : 1;
}

// The polyline of a spline: each piece divided into equal steps of its parameter, the first point of
// every step, then the last control point. Its first point is the first control point and its last
// the last, exactly. A point nearer than the length tolerance to the last one kept is left out, and
// so is every trailing inner point that near to the end: control points at one place make steps
// shorter than the tolerance, and two pieces with such a piece between them would read as a touch of
// the curve with itself. So the polyline lies within the chord tolerance plus the length tolerance of
// the curve. It is computed from the control points in their order; both directions of a loop walk
// the same list.
export function splinePolyline(control: readonly Vec2[], chordTolerance: number): Vec2[] {
  const first: Vec2 = [control[0][0], control[0][1]];
  const last: Vec2 = [control[control.length - 1][0], control[control.length - 1][1]];
  const kept: Vec2[] = [first];
  splineBeziers(control).forEach((piece, index) => {
    const n = splinePieces(piece, chordTolerance);
    for (let step = index === 0 ? 1 : 0; step < n; step++) {
      const q = bezierAt(piece, step / n);
      if (dist2(q, kept[kept.length - 1]) > LENGTH_TOLERANCE) kept.push(q);
    }
  });
  while (kept.length > 1 && dist2(kept[kept.length - 1], last) <= LENGTH_TOLERANCE) kept.pop();
  kept.push(last);
  return kept;
}

// Points the curve passes exactly, in order: its first point, and for every Bezier piece its middle
// (the parameter 1/2) and its end, so the joints of the pieces are every second point and the list
// ends at the last control point (2m + 1 points for m pieces). They are samples of the curve, not
// all of it: between two of them it stays inside the hull of the control points (and `splineBox`).
export function splineThrough(control: readonly Vec2[]): Vec2[] {
  const pieces = splineBeziers(control);
  const out: Vec2[] = [[control[0][0], control[0][1]]];
  pieces.forEach((piece, index) => {
    out.push(bezierAt(piece, 0.5));
    const end = index === pieces.length - 1 ? control[control.length - 1] : piece[piece.length - 1];
    out.push([end[0], end[1]]);
  });
  return out;
}

// A box `[minX, minY, maxX, maxY]`.
export type SplineBox = [number, number, number, number];

// The box of the curve itself: the ends of every Bezier piece and the places where a coordinate of
// its derivative is zero (a quadratic, or for degree 2 a linear function, per coordinate and piece).
// It lies in the box of the control points.
export function splineBox(control: readonly Vec2[]): SplineBox {
  const box: SplineBox = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (q: Vec2): void => {
    box[0] = Math.min(box[0], q[0]);
    box[1] = Math.min(box[1], q[1]);
    box[2] = Math.max(box[2], q[0]);
    box[3] = Math.max(box[3], q[1]);
  };
  for (const piece of splineBeziers(control)) {
    take(piece[0]);
    take(piece[piece.length - 1]);
    for (const axis of [0, 1]) for (const t of derivativeRoots(piece.map((q) => q[axis]))) take(bezierAt(piece, t));
  }
  return box;
}

// The parameters in (0, 1) where the derivative of a Bezier function of degree 2 or 3 is zero.
function derivativeRoots(b: readonly number[]): number[] {
  const p = b.length - 1;
  const d = b.slice(1).map((v, i) => v - b[i]); // the derivative's control values, over p
  const inside = (t: number): boolean => t > 0 && t < 1;
  if (p === 2) return d[0] !== d[1] ? [d[0] / (d[0] - d[1])].filter(inside) : [];
  if (p !== 3) return [];
  // d0 (1 − t)² + 2 d1 t (1 − t) + d2 t² = a t² + b t + c
  const [a, bb, c] = [d[0] - 2 * d[1] + d[2], 2 * (d[1] - d[0]), d[0]];
  if (Math.abs(a) <= 1e-15 * (Math.abs(bb) + Math.abs(c))) return bb !== 0 ? [-c / bb].filter(inside) : [];
  const disc = bb * bb - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-bb + root) / (2 * a), (-bb - root) / (2 * a)].filter(inside);
}

// The signed curvature of a Bezier piece at its start (positive turns left), 0 when its first leg
// has no length: (p − 1) / p · cross(B1 − B0, B2 − B1) / |B1 − B0|³.
export function bezierStartCurvature(bezier: readonly Vec2[]): number {
  const p = bezier.length - 1;
  if (p < 2) return 0;
  const [u, v] = [
    [bezier[1][0] - bezier[0][0], bezier[1][1] - bezier[0][1]],
    [bezier[2][0] - bezier[1][0], bezier[2][1] - bezier[1][1]],
  ];
  const length = Math.hypot(u[0], u[1]);
  if (length === 0) return 0;
  return (((p - 1) / p) * (u[0] * v[1] - u[1] * v[0])) / length ** 3;
}
