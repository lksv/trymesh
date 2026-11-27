// What the scene of the app is drawn with: its colours, and points of a plane as lines in the world.
import type { Frame, ThreadResult, Vec2, Vec3 } from '@trymesh/engine';
import type { HalfSpace } from './viewport';

export const COLOR = { edge: 0x26303c, select: 0xf97316, hover: 0x0ea5e9, sketch: 0x1d4ed8, determined: 0x1c2430, implied: 0x7c3aed, idle: 0x5b7aa8, construction: 0xb45309, external: 0xa21caf, rubber: 0x64748b, plane: 0x8b9bb4, region: 0x2563eb, clash: 0xdc2626, cut: 0x7a8794, thread: 0x0f766e };

export const toWorld = (frame: Frame, u: number, v: number): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2],
];

export function pushPolyline(out: number[], frame: Frame, points: Vec2[]): void {
  for (let i = 0; i + 1 < points.length; i++) out.push(...toWorld(frame, points[i][0], points[i][1]), ...toWorld(frame, points[i + 1][0], points[i + 1][1]));
}

// The stretch of a line without ends through the origin of a plane, along `direction`, that lies
// in the part of the plane a view shows: `corners`, the corners of the view on the plane in order
// around it (a convex quadrilateral). Undefined when the line misses it.
export function stretchInView(corners: readonly Vec2[], direction: Vec2): [Vec2, Vec2] | undefined {
  const length = Math.hypot(direction[0], direction[1]);
  if (!(length > 0)) return undefined;
  const d: Vec2 = [direction[0] / length, direction[1] / length];
  const side = (p: Vec2): number => d[0] * p[1] - d[1] * p[0]; // the signed distance from the line
  let [from, to] = [Infinity, -Infinity];
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % corners.length];
    const [sp, sq] = [side(p), side(q)];
    if ((sp > 0 && sq > 0) || (sp < 0 && sq < 0) || (sp === 0 && sq === 0)) return;
    const s = sp / (sp - sq);
    const along = d[0] * (p[0] + s * (q[0] - p[0])) + d[1] * (p[1] + s * (q[1] - p[1]));
    [from, to] = [Math.min(from, along), Math.max(to, along)];
  });
  return from < to ? [[from * d[0] + 0, from * d[1] + 0], [to * d[0] + 0, to * d[1] + 0]] : undefined; // + 0: no negative zero
}

// A closed loop (pairs of coordinates in the plane) as lines in the world.
export function loopSegments(frame: Frame, loop: number[]): number[] {
  const points: Vec2[] = [];
  for (let i = 0; i < loop.length; i += 2) points.push([loop[i], loop[i + 1]]);
  points.push(points[0]);
  const out: number[] = [];
  pushPolyline(out, frame, points);
  return out;
}

// The square a plane is drawn as, in the coordinates of the plane.
export const planeSquare = (size: number): number[] => [-size / 2, -size / 2, size / 2, -size / 2, size / 2, size / 2, -size / 2, size / 2];

// The parts of segments (six numbers each) that a cut leaves: a segment in the half-space that is
// cut away goes, one that crosses its plane ends there. Without a cut the segments as given.
export function keptSegments(segments: ArrayLike<number>, clip: HalfSpace | undefined): ArrayLike<number> {
  if (!clip) return segments;
  const { origin, normal } = clip;
  const height = (i: number): number => (segments[i] - origin[0]) * normal[0] + (segments[i + 1] - origin[1]) * normal[1] + (segments[i + 2] - origin[2]) * normal[2];
  const out: number[] = [];
  for (let i = 0; i < segments.length; i += 6) {
    const [a, b] = [height(i), height(i + 3)];
    if (a >= 0 && b >= 0 && (a > 0 || b > 0)) continue; // cut away; one end may touch the plane
    const end = (k: number): number[] => [segments[k], segments[k + 1], segments[k + 2]];
    if (a <= 0 && b <= 0) {
      out.push(...end(i), ...end(i + 3));
      continue;
    }
    const t = a / (a - b); // where the segment meets the plane
    const meet = [0, 1, 2].map((k) => segments[i + k] + t * (segments[i + 3 + k] - segments[i + k]));
    out.push(...(a <= 0 ? [...end(i), ...meet] : [...meet, ...end(i + 3)]));
  }
  return out;
}

// Is a point of a plane inside a fill: inside its first loop and outside the others (its holes)?
// The loops are pairs of coordinates in the plane.
export function insideFill(at: Vec2, loops: ArrayLike<number>[]): boolean {
  const inside = (loop: ArrayLike<number>): boolean => {
    let odd = false;
    for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
      const [ax, ay, bx, by] = [loop[i], loop[i + 1], loop[j], loop[j + 1]];
      if (ay > at[1] !== by > at[1] && at[0] < ax + ((at[1] - ay) / (by - ay)) * (bx - ax)) odd = !odd;
    }
    return odd;
  };
  return loops.length > 0 && inside(loops[0]) && !loops.slice(1).some(inside);
}

// The most points of the lines of one thread: fewer per turn when there are many turns.
export const THREAD_POINTS = 4000;
const THREAD_POINTS_PER_TURN = 48;
// The helix of a thread (D76) as segments (six numbers each): one line per start, on the wall and
// lifted a hair to the air side (into a bore, off a pin), from `from` to `to` along its axis. It
// follows the datum of the record: the middle of the crest passes `origin + s · axis` at the angle
// θ from `zero` (right-hand about `axis`) with `s = turn · lead · θ / 2π + k · pitch`.
export function threadLines(thread: Pick<ThreadResult, 'origin' | 'axis' | 'zero' | 'radius' | 'internal' | 'pitch' | 'starts' | 'hand' | 'from' | 'to'>): number[] {
  const { origin, axis, zero, pitch, starts } = thread;
  const turn = thread.hand === 'left' ? -1 : 1;
  const lead = pitch * starts;
  const radius = thread.radius * (thread.internal ? 0.99 : 1.01);
  const side: Vec3 = [axis[1] * zero[2] - axis[2] * zero[1], axis[2] * zero[0] - axis[0] * zero[2], axis[0] * zero[1] - axis[1] * zero[0]];
  const length = Math.max(0, thread.to - thread.from);
  const turns = length / lead;
  const perTurn = Math.max(8, Math.min(THREAD_POINTS_PER_TURN, Math.floor(THREAD_POINTS / Math.max(1, starts * turns))));
  const steps = Math.max(1, Math.ceil(turns * perTurn));
  const out: number[] = [];
  for (let k = 0; k < starts; k++) {
    let last: Vec3 | undefined;
    for (let i = 0; i <= steps; i++) {
      const s = thread.from + (length * i) / steps;
      const theta = (2 * Math.PI * (s - k * pitch)) / (turn * lead);
      const [c, n] = [Math.cos(theta), Math.sin(theta)];
      const point: Vec3 = [0, 1, 2].map((j) => origin[j] + s * axis[j] + radius * (c * zero[j] + n * side[j])) as Vec3;
      if (last) out.push(...last, ...point);
      last = point;
    }
  }
  return out;
}
