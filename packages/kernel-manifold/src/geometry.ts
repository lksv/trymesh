// Vectors, planes of faces and the tolerances of the adapter.
import type { Solid } from '@trymesh/engine';

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / len(a));

// position of the vertex i
export const vertex = (s: Solid, i: number): V3 => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
export const triangleCount = (s: Solid): number => s.triangles.length / 3;
export const corners = (s: Solid, t: number): [V3, V3, V3] => [
  vertex(s, s.triangles[3 * t]),
  vertex(s, s.triangles[3 * t + 1]),
  vertex(s, s.triangles[3 * t + 2]),
];

// Width of a triangle: its height over the longest side. `normal` is the unnormalised cross product of the sides.
export function triWidth(v: [V3, V3, V3], normal: V3): number {
  const longest = Math.max(len(sub(v[1], v[0])), len(sub(v[2], v[1])), len(sub(v[0], v[2])));
  return longest === 0 ? 0 : len(normal) / longest;
}

// Tolerances of the adapter, all derived from the size D: the diagonal of the bounding box of both
// bodies, but at least twice the largest coordinate.
export interface Tolerances {
  tol: number; // what is still taken as "in one plane"
  overlap: number; // how far a face is shifted
  sliver: number; // a narrower triangle of a curved face is not used to determine the plane
  onPlane: number; // a vertex "lies in the shifted plane"
  weld: number; // vertices closer than this are welded
}

export function tolerances(...solids: Solid[]): Tolerances {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    for (let i = 0; i < s.positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], s.positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], s.positions[i]);
    }
  }
  // The precision of float32 drops with the distance from the origin. A model far from the origin
  // therefore gets tolerances by its largest coordinate, not only by its size.
  const D = Math.max(len(sub(hi, lo)), 2 * Math.max(...lo.map(Math.abs), ...hi.map(Math.abs)));
  return { tol: D * 1e-5, overlap: D * 4e-5, sliver: D * 8e-5, onPlane: D * 5e-6, weld: D * 1e-6 };
}

export interface FaceTriangle {
  v: [V3, V3, V3];
  n: V3; // unnormalised normal
}

export interface FittedFace {
  id: number;
  n: V3; // unit normal of the fitted plane
  d: number; // the plane n·x = d
  planar: boolean;
  width: number; // width of the widest triangle
  tris: FaceTriangle[];
}

// Fits a plane to each face (by the face number). A face is planar when its vertices lie within
// `tol` of the fitted plane. The decision must not go by the normals of the single triangles: a narrow
// triangle made by a boolean has an unreliable normal and would mark the whole face as not planar.
export function fitFaces(s: Solid, tol: number): Map<number, FittedFace> {
  const groups = new Map<number, { tris: FaceTriangle[]; sum: V3 }>();
  for (let t = 0; t < triangleCount(s); t++) {
    const v = corners(s, t);
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    let g = groups.get(s.faceIds[t]);
    if (!g) groups.set(s.faceIds[t], (g = { tris: [], sum: [0, 0, 0] }));
    g.tris.push({ v, n });
    g.sum = add(g.sum, n);
  }
  const out = new Map<number, FittedFace>();
  for (const [id, g] of groups) {
    if (len(g.sum) === 0) continue;
    const n = unit(g.sum);
    let area = 0;
    let d = 0;
    let width = 0;
    for (const tri of g.tris) {
      const a = len(tri.n) / 2;
      area += a;
      d += a * dot(n, mul(add(add(tri.v[0], tri.v[1]), tri.v[2]), 1 / 3));
      width = Math.max(width, triWidth(tri.v, tri.n));
    }
    if (area === 0) continue;
    d /= area;
    let deviation = 0;
    for (const tri of g.tris) for (const p of tri.v) deviation = Math.max(deviation, Math.abs(dot(n, p) - d));
    // A face made only of narrow remains has no reliable normal; that is why `width` is returned too.
    out.set(id, { id, n, d, planar: deviation <= tol, width, tris: g.tris });
  }
  return out;
}
