// What follows from the surfaces of two faces alone (D39): the circle they meet in.
import type { Surface, Vec3 } from './types';
import { ANGLE_TOLERANCE, add3, cross3, dot3, len3, mul3, sub3, unit3 } from './util';

export interface Circle3 {
  center: Vec3;
  axis: Vec3; // unit, without a sign
  radius: number;
}

// The circle two surfaces meet in, exactly, or undefined when they do not meet in one. The rule
// is the one that gives an edge the kind `circle` (`edgeKind` in solid.ts): a plane across the
// axis of a cylinder, within `ANGLE_TOLERANCE`. The pairs with a cone come with the package that
// builds the first cone.
export function circleBetween(a: Surface, b: Surface): Circle3 | undefined {
  const [plane, round] = a.kind === 'plane' ? [a, b] : [b, a];
  if (plane.kind !== 'plane' || round.kind !== 'cylinder') return undefined;
  const [normal, axis] = [unit3(plane.normal), unit3(round.axis)];
  if (len3(cross3(normal, axis)) > Math.sin(ANGLE_TOLERANCE)) return undefined; // an ellipse, or two lines
  const along = dot3(normal, sub3(plane.origin, round.origin)) / dot3(normal, axis);
  const center = add3(round.origin, mul3(axis, along));
  return { center: [center[0] + 0, center[1] + 0, center[2] + 0], axis, radius: round.radius };
}
