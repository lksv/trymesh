// What the scene of the app is drawn with: its colours, and points of a plane as lines in the world.
import type { Frame, Vec2, Vec3 } from '@trymesh/engine';
import type { HalfSpace } from './viewport';

export const COLOR = { edge: 0x26303c, select: 0xf97316, hover: 0x0ea5e9, sketch: 0x1d4ed8, determined: 0x1c2430, implied: 0x7c3aed, idle: 0x5b7aa8, construction: 0xb45309, external: 0xa21caf, rubber: 0x64748b, plane: 0x8b9bb4, region: 0x2563eb, clash: 0xdc2626, cut: 0x7a8794 };

export const toWorld = (frame: Frame, u: number, v: number): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2],
];

export function pushPolyline(out: number[], frame: Frame, points: Vec2[]): void {
  for (let i = 0; i + 1 < points.length; i++) out.push(...toWorld(frame, points[i][0], points[i][1]), ...toWorld(frame, points[i + 1][0], points[i + 1][1]));
}

// Uzavřená smyčka (dvojice souřadnic v rovině) jako úsečky ve světě.
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
