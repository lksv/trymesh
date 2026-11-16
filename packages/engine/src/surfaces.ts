// What follows from the surfaces of two faces alone (D39): the circle they meet in.
import type { Surface, Vec3 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, len3, mul3, sub3, unit3 } from './util';

export interface Circle3 {
  center: Vec3;
  axis: Vec3; // unit, without a sign
  radius: number;
}

type Round = Extract<Surface, { kind: 'cylinder' | 'cone' }>;
const parallel = (a: Vec3, b: Vec3): boolean => len3(cross3(unit3(a), unit3(b))) <= Math.sin(ANGLE_TOLERANCE);
const pointOf = (round: Round): Vec3 => (round.kind === 'cylinder' ? round.origin : round.apex);
// Two surfaces about one axis: the directions are parallel and a point of one axis lies on the other.
function coaxial(a: Round, b: Round): boolean {
  if (!parallel(a.axis, b.axis)) return false;
  const axis = unit3(a.axis);
  const apart = sub3(pointOf(b), pointOf(a));
  return len3(sub3(apart, mul3(axis, dot3(apart, axis)))) <= LENGTH_TOLERANCE;
}
const zeroless = (p: Vec3): Vec3 => [p[0] + 0, p[1] + 0, p[2] + 0];
const circle = (center: Vec3, axis: Vec3, radius: number): Circle3 | undefined => (radius > LENGTH_TOLERANCE ? { center: zeroless(center), axis, radius } : undefined);

// The circle two surfaces meet in, exactly, or undefined when they do not meet in one. The rule
// gives an edge the kind `circle` (`edgeKind` in solid.ts):
// - a plane across the axis of a cylinder or of a cone (for a cone, on the half its `axis` points
//   along);
// - a cylinder and a cone about one axis;
// - two cones about one axis, where their radii are equal on the halves of both.
// The radius has to be above `LENGTH_TOLERANCE` (a plane through the apex is no circle). Two
// cylinders, also on one axis, two faces of one surface and everything else: undefined.
export function circleBetween(a: Surface, b: Surface): Circle3 | undefined {
  if (a.kind === 'plane' || b.kind === 'plane') {
    const [plane, round] = a.kind === 'plane' ? [a, b] : [b, a];
    if (plane.kind !== 'plane' || (round.kind !== 'cylinder' && round.kind !== 'cone')) return undefined;
    const [normal, axis] = [unit3(plane.normal), unit3(round.axis)];
    if (!parallel(normal, axis)) return undefined; // an ellipse, a hyperbola, or two lines
    const along = dot3(normal, sub3(plane.origin, pointOf(round))) / dot3(normal, axis);
    const center = add3(pointOf(round), mul3(axis, along));
    if (round.kind === 'cylinder') return circle(center, axis, round.radius);
    return along > 0 ? circle(center, axis, along * Math.tan(round.halfAngle)) : undefined;
  }
  if ((a.kind !== 'cylinder' && a.kind !== 'cone') || (b.kind !== 'cylinder' && b.kind !== 'cone') || !coaxial(a, b)) return undefined;
  if (a.kind === 'cylinder' && b.kind === 'cylinder') return undefined;
  if (a.kind === 'cylinder' || b.kind === 'cylinder') {
    const [cylinder, cone] = (a.kind === 'cylinder' ? [a, b] : [b, a]) as [Extract<Surface, { kind: 'cylinder' }>, Extract<Surface, { kind: 'cone' }>];
    const axis = unit3(cone.axis);
    return circle(add3(cone.apex, mul3(axis, cylinder.radius / Math.tan(cone.halfAngle))), axis, cylinder.radius);
  }
  // Two cones. Along the common direction `u` (that of `a`), the apex of `a` at 0 and that of `b`
  // at `p`; each face lies on the half its axis points along (`sa`, `sb`), where its radius is
  // `s · sa · tan(A)` and `(s − p) · sb · tan(B)`.
  const [p1, p2] = [a as Extract<Surface, { kind: 'cone' }>, b as Extract<Surface, { kind: 'cone' }>];
  const u = unit3(p1.axis);
  const p = dot3(sub3(p2.apex, p1.apex), u);
  const [sa, sb] = [1, Math.sign(dot3(unit3(p2.axis), u))];
  const [ta, tb] = [Math.tan(p1.halfAngle), Math.tan(p2.halfAngle)];
  const denominator = sa * ta - sb * tb;
  if (Math.abs(denominator) <= 1e-12) return undefined; // one surface, or cones that never meet
  const s = (-sb * p * tb) / denominator;
  if (!(s * sa > 0 && (s - p) * sb > 0)) return undefined;
  return circle(add3(p1.apex, mul3(u, s)), u, s * sa * ta);
}
