// Meshes and frames written by hand for the tests of the section (D38): prisms as closed meshes
// with shared vertices, turned and moved, and the planes that cut them.
import { type CutLoop, cut } from '../src/query/section';
import type { Frame, Solid, Vec2, Vec3 } from '../src/types';

export const BOTTOM = 0;
export const TOP = 1;
// A prism from z = `low` to z = `high` over a polygon that runs counter-clockwise, as a closed
// mesh with shared vertices. Every side is a quad of two triangles, so a cut across it has
// a point on every diagonal. `hole` is a polygon with as many corners inside the first; the caps
// are then the quads between the two. `sideFace(i)` numbers the face of the side `i` of the
// outer polygon; the sides of the hole are the face `holeFace`.
export function prism(outer: Vec2[], low: number, high: number, sideFace: (side: number) => number, hole?: Vec2[], holeFace = 9): Solid {
  const n = outer.length;
  const positions: number[] = [];
  for (const ring of hole ? [outer, hole] : [outer]) for (const z of [low, high]) for (const [x, y] of ring) positions.push(x, y, z);
  const triangles: number[] = [];
  const faces: number[] = [];
  const add = (face: number, a: number, b: number, c: number): void => {
    triangles.push(a, b, c);
    faces.push(face);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // the outer wall looks away from the polygon, the wall of the hole into the hole
    add(sideFace(i), i, j, n + j);
    add(sideFace(i), i, n + j, n + i);
    if (hole) {
      add(holeFace, 2 * n + i, 3 * n + j, 2 * n + j);
      add(holeFace, 2 * n + i, 3 * n + i, 3 * n + j);
      add(TOP, n + i, n + j, 3 * n + j);
      add(TOP, n + i, 3 * n + j, 3 * n + i);
      add(BOTTOM, i, 2 * n + j, j);
      add(BOTTOM, i, 2 * n + i, 2 * n + j);
    } else if (i > 0 && j > 0) {
      add(TOP, n, n + i, n + j);
      add(BOTTOM, 0, j, i);
    }
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faces) };
}
export const regular = (n: number, radius: number, phase = 0): Vec2[] => Array.from({ length: n }, (_, i) => [radius * Math.cos(phase + (2 * Math.PI * i) / n), radius * Math.sin(phase + (2 * Math.PI * i) / n)]);
// A box 4 × 3 × 10 with a corner at the origin; its four sides are the faces 2 to 5.
export const box = (): Solid => prism([[0, 0], [4, 0], [4, 3], [0, 3]], 0, 10, (side) => 2 + side);

// Turns about `axis` through the origin by `angle`, then moves by `by`.
export function placement(axis: Vec3, angle: number, by: Vec3 = [0, 0, 0]): { point: (p: Vec3) => Vec3; direction: (d: Vec3) => Vec3 } {
  const length = Math.hypot(...axis);
  const [kx, ky, kz] = axis.map((part) => part / length);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const direction = ([x, y, z]: Vec3): Vec3 => {
    const dot = kx * x + ky * y + kz * z;
    return [x * c + (ky * z - kz * y) * s + kx * dot * (1 - c), y * c + (kz * x - kx * z) * s + ky * dot * (1 - c), z * c + (kx * y - ky * x) * s + kz * dot * (1 - c)];
  };
  return { direction, point: (p) => direction(p).map((part, k) => part + by[k]) as Vec3 };
}
export type Placement = ReturnType<typeof placement>;
export function placed(solid: Solid, at: Placement): Solid {
  const positions = new Float32Array(solid.positions.length);
  for (let i = 0; i < positions.length; i += 3) positions.set(at.point([solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]]), i);
  return { ...solid, positions };
}
export const moved = (solid: Solid, by: Vec3): Solid => placed(solid, placement([0, 0, 1], 0, by));
// Several closed meshes as one, in the order given.
export function together(...solids: Solid[]): Solid {
  let offset = 0;
  const triangles: number[] = [];
  for (const solid of solids) {
    for (const index of solid.triangles) triangles.push(index + offset);
    offset += solid.positions.length / 3;
  }
  return { positions: Float32Array.from(solids.flatMap((solid) => [...solid.positions])), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(solids.flatMap((solid) => [...solid.faceIds])) };
}
// The plane z = `z` of a body as modelled, where the body is placed; `flip`: seen from the other side.
export const planeAt = (z: number, at?: Placement, flip = false): Frame => {
  const frame: Frame = { origin: [0, 0, z], x: [flip ? -1 : 1, 0, 0], y: [0, 1, 0], normal: [0, 0, flip ? -1 : 1] };
  return at ? { origin: at.point(frame.origin), x: at.direction(frame.x), y: at.direction(frame.y), normal: at.direction(frame.normal) } : frame;
};
// The precision of the coordinates of a mesh, as `coordinatePrecision` gives it for a body.
export const precisionOf = (solid: Solid): number => 1e-6 * Math.max(1, ...Array.from(solid.positions, Math.abs));
export const cutOf = (solid: Solid, frame: Frame): CutLoop[] => cut(solid, frame, precisionOf(solid), precisionOf(solid));
export const lengthOf = (loop: CutLoop): number => loop.lengths.reduce((sum, length) => sum + length, 0);
export const turned = <T>(list: T[], by: number): T[] => [...list.slice(by), ...list.slice(0, by)];
