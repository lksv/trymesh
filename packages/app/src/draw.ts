// What the scene of the app is drawn with: its colours, and points of a plane as lines in the world.
import type { Frame, Vec2, Vec3 } from '@trymesh/engine';

export const COLOR = { edge: 0x26303c, select: 0xf97316, hover: 0x0ea5e9, sketch: 0x1d4ed8, determined: 0x1c2430, implied: 0x7c3aed, idle: 0x5b7aa8, construction: 0xb45309, external: 0xa21caf, rubber: 0x64748b, plane: 0x8b9bb4, region: 0x2563eb, clash: 0xdc2626 };

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
