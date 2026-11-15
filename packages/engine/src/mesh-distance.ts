// Distances measured on the mesh (D39), shared by the queries that measure: the smallest distance
// between two parts of the mesh, the precision of its coordinates, and how far a number measured
// on it may be from the exact shapes.
import type { QueryContext } from './query/spec';
import type { BodyResult, Id, Solid, Vec3 } from './types';
import { LENGTH_TOLERANCE, add3, cross3, dot3, len3, mul3, sub3 } from './util';

// ---------------------------------------------------------------- precision and accuracy

// How precisely a coordinate of the mesh is known: coordinates are single precision, so a length
// is known to about a millionth of the largest coordinate of the bodies concerned, and to
// a millionth of a millimetre at least. Every query means this by "the precision of the
// coordinates": a depth of an interference, a gap of zero, a section, the contact with a bed.
export function coordinatePrecision(...bodies: Pick<BodyResult, 'bounds'>[]): number {
  return 1e-6 * Math.max(1, ...bodies.flatMap((body) => [...body.bounds.min, ...body.bounds.max].map(Math.abs)));
}

// An estimate of how far a distance measured on the mesh may be from the distance of the exact
// shapes: one chord tolerance of the document for each listed body that has a face which is not
// planar, plus the precision of the coordinates. A body is listed once per side of the
// measurement (twice when both entities lie on it).
// - A body with only planar faces has only straight edges: nothing of it is a polygon of a curve.
//   A planar face of any other body may end in the polygon of an arc, so it counts.
// - It is an estimate, not a bound: a circle or a tooth flank above the caps on the number of
//   segments no longer keeps the chord tolerance.
export function meshAccuracy(context: Pick<QueryContext, 'bodies' | 'state'>, bodies: readonly Id[]): number {
  const listed = bodies.map((id) => context.bodies[id]);
  const round = listed.filter((body) => body.faces.some((face) => !face.planar)).length;
  return round * context.state.document.settings.chordTolerance + (listed.length ? coordinatePrecision(...listed) : 0);
}

// ---------------------------------------------------------------- two simplices

// The point of the triangle abc closest to p (Ericson, Real-Time Collision Detection, 5.1.5).
export function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const [ab, ac, ap] = [sub3(b, a), sub3(c, a), sub3(p, a)];
  const [d1, d2] = [dot3(ab, ap), dot3(ac, ap)];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub3(p, b);
  const [d3, d4] = [dot3(ab, bp), dot3(ac, bp)];
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add3(a, mul3(ab, d1 / (d1 - d3)));
  const cp = sub3(p, c);
  const [d5, d6] = [dot3(ab, cp), dot3(ac, cp)];
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add3(a, mul3(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add3(b, mul3(sub3(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const sum = va + vb + vc;
  return add3(a, add3(mul3(ab, vb / sum), mul3(ac, vc / sum)));
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

// The point of the segment ab closest to p.
function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub3(b, a);
  const length2 = dot3(ab, ab);
  return length2 === 0 ? a : add3(a, mul3(ab, clamp(dot3(sub3(p, a), ab) / length2)));
}

// The closest points of the segments p1q1 and p2q2 (Ericson, 5.1.9).
function closestOfSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): [Vec3, Vec3] {
  const [d1, d2, r] = [sub3(q1, p1), sub3(q2, p2), sub3(p1, p2)];
  const [a, e, f] = [dot3(d1, d1), dot3(d2, d2), dot3(d2, r)];
  let [s, t] = [0, 0];
  if (a === 0 && e === 0) return [p1, p2];
  if (a === 0) t = clamp(f / e);
  else {
    const c = dot3(d1, r);
    if (e === 0) s = clamp(-c / a);
    else {
      const b = dot3(d1, d2);
      const denominator = a * e - b * b;
      s = denominator > 0 ? clamp((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, clamp(-c / a)];
      else if (t > 1) [t, s] = [1, clamp((b - c) / a)];
    }
  }
  return [add3(p1, mul3(d1, s)), add3(p2, mul3(d2, t))];
}

// Where the segment pq goes through the triangle abc, or undefined when it does not. A segment in
// the plane of the triangle is left to the distances of the edges.
function pierce(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 | undefined {
  const [ab, ac, direction] = [sub3(b, a), sub3(c, a), sub3(q, p)];
  const h = cross3(direction, ac);
  const det = dot3(ab, h);
  const scale = len3(ab) * len3(ac) * len3(direction);
  if (scale === 0 || Math.abs(det) <= 1e-12 * scale) return undefined;
  const s = sub3(p, a);
  const u = dot3(s, h) / det;
  if (u < 0 || u > 1) return undefined;
  const k = cross3(s, ab);
  const v = dot3(direction, k) / det;
  if (v < 0 || u + v > 1) return undefined;
  const t = dot3(ac, k) / det;
  return t < 0 || t > 1 ? undefined : add3(p, mul3(direction, t));
}

// A point, a segment or a triangle, by the number of its corners.
type Simplex = readonly Vec3[];
// A triangle without an area (two corners in one place, three in a line) has no inside, and the
// barycentric form divides by its area: the closest point is then that of its nearest side.
function flat(a: Vec3, b: Vec3, c: Vec3): boolean {
  const [ab, ac] = [sub3(b, a), sub3(c, a)];
  return len3(cross3(ab, ac)) <= 1e-9 * len3(ab) * len3(ac);
}
function closestOn(p: Vec3, simplex: Simplex): Vec3 {
  if (simplex.length === 1) return simplex[0];
  if (simplex.length === 2) return closestOnSegment(p, simplex[0], simplex[1]);
  const [a, b, c] = simplex;
  if (!flat(a, b, c)) return closestOnTriangle(p, a, b, c);
  const onSides = [closestOnSegment(p, a, b), closestOnSegment(p, b, c), closestOnSegment(p, c, a)];
  return onSides.reduce((best, one) => (len3(sub3(p, one)) < len3(sub3(p, best)) ? one : best));
}
const sides = (simplex: Simplex): [Vec3, Vec3][] => (simplex.length === 1 ? [] : simplex.length === 2 ? [[simplex[0], simplex[1]]] : [[simplex[0], simplex[1]], [simplex[1], simplex[2]], [simplex[2], simplex[0]]]);

// The closest points of two simplices: the least of every corner against the other simplex and
// every side against every side, and zero where a side of one goes through the other (two
// triangles that cross through their insides have no corner and no side close to each other).
function closestOfSimplices(a: Simplex, b: Simplex): { distance: number; a: Vec3; b: Vec3 } {
  let best = { distance: Infinity, a: a[0], b: b[0] };
  const offer = (onA: Vec3, onB: Vec3): void => {
    const distance = len3(sub3(onA, onB));
    if (distance < best.distance) best = { distance, a: onA, b: onB };
  };
  for (const corner of a) offer(corner, closestOn(corner, b));
  for (const corner of b) offer(closestOn(corner, a), corner);
  const [sidesA, sidesB] = [sides(a), sides(b)];
  for (const [p1, q1] of sidesA) for (const [p2, q2] of sidesB) offer(...closestOfSegments(p1, q1, p2, q2));
  if (best.distance > 0) {
    for (const [through, face] of [[sidesA, b], [sidesB, a]] as const) {
      if (face.length !== 3) continue;
      for (const [p, q] of through) {
        const at = pierce(p, q, face[0], face[1], face[2]);
        if (at) return { distance: 0, a: at, b: at };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- two parts of the mesh

// A part of the mesh: a point, the segments of an edge (`BodyResult.edges[i].segments`, six
// numbers a segment), or the triangles of a solid, all of them or those of one face.
export type MeshPart = { point: Vec3 } | { segments: ArrayLike<number> } | { solid: Solid; face?: number };
export interface Closest {
  distance: number;
  a: Vec3;
  b: Vec3;
  faceA?: number; // only for a part with triangles
  faceB?: number;
}

interface Piece {
  corners: Simplex;
  min: Vec3;
  max: Vec3;
  face?: number;
  normal?: Vec3; // of a triangle, unit; undefined for one without an area
}

function piece(corners: Vec3[], face?: number): Piece {
  const [min, max]: [Vec3, Vec3] = [[...corners[0]], [...corners[0]]];
  for (const corner of corners) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], corner[axis]);
      max[axis] = Math.max(max[axis], corner[axis]);
    }
  }
  if (corners.length !== 3) return { corners, min, max };
  const normal = cross3(sub3(corners[1], corners[0]), sub3(corners[2], corners[0]));
  const length = len3(normal);
  return { corners, min, max, face, ...(length > 0 ? { normal: mul3(normal, 1 / length) } : {}) };
}

function piecesOf(part: MeshPart): Piece[] {
  if ('point' in part) return [piece([part.point])];
  if ('segments' in part) {
    const s = part.segments;
    return Array.from({ length: Math.floor(s.length / 6) }, (_, i) => piece([[s[6 * i], s[6 * i + 1], s[6 * i + 2]], [s[6 * i + 3], s[6 * i + 4], s[6 * i + 5]]]));
  }
  const { positions: p, triangles, faceIds } = part.solid;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const out: Piece[] = [];
  for (let t = 0; t < faceIds.length; t++) {
    if (part.face !== undefined && faceIds[t] !== part.face) continue;
    out.push(piece([at(triangles[3 * t]), at(triangles[3 * t + 1]), at(triangles[3 * t + 2])], faceIds[t]));
  }
  return out;
}

// The distance of two boxes: zero when they overlap.
function boxDistance(minA: Vec3, maxA: Vec3, minB: Vec3, maxB: Vec3): number {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const gap = Math.max(0, minA[axis] - maxB[axis], minB[axis] - maxA[axis]);
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}
function boxOf(pieces: Piece[]): { min: Vec3; max: Vec3 } {
  const [min, max]: [Vec3, Vec3] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (const one of pieces) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], one.min[axis]);
      max[axis] = Math.max(max[axis], one.max[axis]);
    }
  }
  return { min, max };
}

const SAMPLE = 50; // pieces of each part the first, coarse step looks at
const KEPT = 4096; // pairs remembered for the choice of the faces before the list is thinned

// The smallest distance between two parts of the mesh, with the two points it lies between.
// - `within`: undefined is returned when nothing is that close (a pair exactly that far apart is
//   found). Pieces whose boxes are further apart are skipped; the best distance found so far
//   tightens the bound.
// - Two triangles that cross are at distance zero (and a segment that goes through a triangle),
//   so two faces of bodies that collide measure zero. A part wholly inside a closed solid without
//   touching its surface is not found this way: the distance is then to the surface around it.
//   Whether two bodies share a volume is the question of `interference`.
// - `faceA`, `faceB`: the faces of the two closest triangles. Where the closest point lies on an
//   edge or a corner of a body, triangles of several faces are equally close; among the pairs
//   within `LENGTH_TOLERANCE` of the smallest distance the face named is the one that faces the
//   other part most directly, so the wall of a bore is named and not the cap it ends in. Faces
//   that face it equally are decided by the smaller number, not by the order of the triangles.
// - Parts that touch or cross: the pass stops at the first distance of zero, and the faces named
//   are those of that pair of pieces.
// - The pass is quadratic in the worst case. It starts from a bound (the smallest distance among
//   a coarse sample of each part, or `within`), drops every piece whose box is further than that
//   from the box of the whole other part, and then walks the rest along the longest axis, so
//   that a piece meets only the pieces near it on that axis.
// - Undefined also when a part has nothing in it (a face the solid does not have).
export function closest(partA: MeshPart, partB: MeshPart, within?: number): Closest | undefined {
  let [a, b] = [piecesOf(partA), piecesOf(partB)];
  if (a.length === 0 || b.length === 0) return undefined;
  const bound = within ?? Infinity;
  let limit = bound; // nothing further than this can be the answer
  let best: { distance: number; a: Vec3; b: Vec3; faceA?: number; faceB?: number } | undefined;
  // the pairs about as close as the best one, each with how directly its two faces look at the other part
  let near: { distance: number; faceA?: number; scoreA: number; faceB?: number; scoreB: number }[] = [];
  const named = a[0].face !== undefined || b[0].face !== undefined;
  const offer = (one: Piece, other: Piece): void => {
    if (boxDistance(one.min, one.max, other.min, other.max) > limit + LENGTH_TOLERANCE) return;
    const found = closestOfSimplices(one.corners, other.corners);
    if (!(found.distance <= bound) || found.distance > limit + LENGTH_TOLERANCE) return;
    if (!best || found.distance < best.distance) {
      best = { ...found, faceA: one.face, faceB: other.face };
      limit = found.distance;
    }
    if (!named || found.distance === 0) return;
    const direction = sub3(found.b, found.a);
    const length = len3(direction);
    const score = (own: Piece, sign: number): number => (own.normal ? (sign * dot3(own.normal, direction)) / length : 0);
    near.push({ distance: found.distance, faceA: one.face, scoreA: score(one, 1), faceB: other.face, scoreB: score(other, -1) });
    if (near.length > KEPT) near = near.filter((pair) => pair.distance <= limit + LENGTH_TOLERANCE);
  };
  const touching = (): boolean => best?.distance === 0; // a distance of zero cannot be improved on: the pass stops there

  // 1. a bound from a coarse sample of both parts
  const sample = (pieces: Piece[]): Piece[] => pieces.filter((_, i) => i % Math.ceil(pieces.length / SAMPLE) === 0);
  for (const one of sample(a)) for (const other of sample(b)) if (!touching()) offer(one, other);

  // 2. pieces too far from the whole other part cannot hold the answer
  const [boxA, boxB] = [boxOf(a), boxOf(b)];
  a = a.filter((one) => boxDistance(one.min, one.max, boxB.min, boxB.max) <= limit + LENGTH_TOLERANCE);
  b = b.filter((other) => boxDistance(other.min, other.max, boxA.min, boxA.max) <= limit + LENGTH_TOLERANCE);

  // 3. the rest, along the axis the two parts are longest in: `b` sorted by where its pieces
  // start, so that a piece of `a` meets only those that can be within the bound on that axis
  let axis = 0;
  for (let i = 1; i < 3; i++) if (Math.max(boxA.max[i], boxB.max[i]) - Math.min(boxA.min[i], boxB.min[i]) > Math.max(boxA.max[axis], boxB.max[axis]) - Math.min(boxA.min[axis], boxB.min[axis])) axis = i;
  b.sort((one, other) => one.min[axis] - other.min[axis]);
  const longest = b.reduce((most, other) => Math.max(most, other.max[axis] - other.min[axis]), 0);
  for (const one of a) {
    if (touching()) break;
    // the first piece of `b` that can reach back to `one`: it starts no earlier than this
    const from = one.min[axis] - limit - LENGTH_TOLERANCE - longest;
    let [low, high] = [0, b.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (b[middle].min[axis] < from) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < b.length && !touching() && b[i].min[axis] <= one.max[axis] + limit + LENGTH_TOLERANCE; i++) offer(one, b[i]);
  }
  const found = best as { distance: number; a: Vec3; b: Vec3; faceA?: number; faceB?: number } | undefined;
  if (!found) return undefined; // `within` was given and nothing is that close
  // The faces: of the touching pair; otherwise, among the pairs as close as the answer, the one
  // that looks at the other part most directly, and of two that do so equally the smaller number.
  let [faceA, faceB] = [found.faceA, found.faceB];
  if (found.distance > 0) {
    const pick = (face: (pair: (typeof near)[number]) => number | undefined, score: (pair: (typeof near)[number]) => number): number | undefined => {
      let chosen: { face: number; score: number } | undefined;
      for (const pair of near) {
        const [number, value] = [face(pair), score(pair)];
        if (number === undefined || pair.distance > found.distance + LENGTH_TOLERANCE) continue;
        if (!chosen || value > chosen.score + 1e-9 || (Math.abs(value - chosen.score) <= 1e-9 && number < chosen.face)) chosen = { face: number, score: value };
      }
      return chosen?.face;
    };
    [faceA, faceB] = [pick((pair) => pair.faceA, (pair) => pair.scoreA), pick((pair) => pair.faceB, (pair) => pair.scoreB)];
  }
  return { distance: found.distance, a: found.a, b: found.b, ...(faceA !== undefined ? { faceA } : {}), ...(faceB !== undefined ? { faceB } : {}) };
}
