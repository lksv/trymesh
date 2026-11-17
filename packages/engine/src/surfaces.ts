// What follows from the surfaces of two faces (D39, D58): the circles they meet in, and which of
// them an edge is.
import type { Surface, Vec3 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, len3, mul3, sub3, unit3 } from './util';

export interface Circle3 {
  center: Vec3;
  axis: Vec3; // unit, without a sign
  radius: number;
}

type Vec2 = [number, number];
const parallel = (a: Vec3, b: Vec3): boolean => len3(cross3(unit3(a), unit3(b))) <= Math.sin(ANGLE_TOLERANCE);
const zeroless = (p: Vec3): Vec3 => [p[0] + 0, p[1] + 0, p[2] + 0];
// The distance of a point from the line through `o` along the unit `u`.
const offAxis = (p: Vec3, o: Vec3, u: Vec3): number => {
  const d = sub3(p, o);
  return len3(sub3(d, mul3(u, dot3(d, u))));
};

// ---------------------------------------------------------------- curves in a half plane

// A surface about an axis cut by a half plane through the axis: a curve in the coordinates `(z, ρ)`
// of that half plane, `z` along the axis and `ρ` the distance from it. A plane across the axis is
// the line `z = const`, a cylinder the line `ρ = r`, a cone a ray from its apex, a sphere whose
// centre is on the axis a circle centred on it, a torus the circle of its tube, centred at its
// signed major radius.
type Curve2 = { kind: 'line'; p: Vec2; d: Vec2; ray: boolean } | { kind: 'circle'; c: Vec2; r: number };
interface Meeting {
  at: Vec2;
  sin: number; // the sine of the angle at which the two curves meet there
}

// The curve of a surface about the axis through `o` along the unit `u`, or undefined when the
// surface is not one about that axis.
function curveOf(s: Surface, o: Vec3, u: Vec3): Curve2 | undefined {
  const z = (p: Vec3): number => dot3(sub3(p, o), u);
  switch (s.kind) {
    case 'plane': {
      if (!parallel(s.normal, u)) return undefined;
      const n = unit3(s.normal);
      // where the axis meets the plane, as a plane across a round surface always met it
      return { kind: 'line', p: [dot3(n, sub3(s.origin, o)) / dot3(n, u), 0], d: [0, 1], ray: false };
    }
    case 'cylinder':
      return parallel(s.axis, u) && offAxis(s.origin, o, u) <= LENGTH_TOLERANCE ? { kind: 'line', p: [0, s.radius], d: [1, 0], ray: false } : undefined;
    case 'cone': {
      if (!parallel(s.axis, u) || offAxis(s.apex, o, u) > LENGTH_TOLERANCE) return undefined;
      const sign = Math.sign(dot3(unit3(s.axis), u));
      return { kind: 'line', p: [z(s.apex), 0], d: [sign * Math.cos(s.halfAngle), Math.sin(s.halfAngle)], ray: true };
    }
    case 'sphere':
      return offAxis(s.center, o, u) <= LENGTH_TOLERANCE ? { kind: 'circle', c: [z(s.center), 0], r: s.radius } : undefined;
    case 'torus':
      return parallel(s.axis, u) && offAxis(s.center, o, u) <= LENGTH_TOLERANCE ? { kind: 'circle', c: [z(s.center), s.majorRadius], r: s.minorRadius } : undefined;
    default:
      return undefined;
  }
}

const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];

// Where two curves of a half plane meet. Touching is tested on the distance, both ways, so that
// curves the solver left a hair apart or a hair across meet in the one point of touching:
// - a line whose distance from the centre of a circle differs from the radius by at most
//   `LENGTH_TOLERANCE` meets it at the foot of the perpendicular;
// - two circles whose distance differs from the sum or the difference of their radii by at most
//   that meet on the line of their centres, at the radius of the first from its centre.
// Two lines that are parallel and two concentric circles meet nowhere (one surface, or none).
function meet(a: Curve2, b: Curve2): Meeting[] {
  if (a.kind === 'circle' && b.kind === 'line') return meet(b, a);
  if (a.kind === 'line' && b.kind === 'line') {
    const [da, db] = [unit2(a.d), unit2(b.d)];
    const den = cross2(da, db);
    if (Math.abs(den) <= 1e-12) return [];
    const w: Vec2 = [b.p[0] - a.p[0], b.p[1] - a.p[1]];
    const s = cross2(w, db) / den;
    const t = cross2(w, da) / den;
    if ((a.ray && s < 0) || (b.ray && t < 0)) return [];
    return [{ at: [a.p[0] + s * da[0], a.p[1] + s * da[1]], sin: Math.abs(den) }];
  }
  if (a.kind === 'line' && b.kind === 'circle') {
    const d = unit2(a.d);
    const w: Vec2 = [b.c[0] - a.p[0], b.c[1] - a.p[1]];
    const along = w[0] * d[0] + w[1] * d[1];
    const across = Math.abs(cross2(d, w));
    if (across > b.r + LENGTH_TOLERANCE) return [];
    const steps = Math.abs(across - b.r) <= LENGTH_TOLERANCE ? [along] : [along - Math.sqrt(b.r * b.r - across * across), along + Math.sqrt(b.r * b.r - across * across)];
    const out: Meeting[] = [];
    for (const s of steps) {
      if (a.ray && s < 0) continue;
      const at: Vec2 = [a.p[0] + s * d[0], a.p[1] + s * d[1]];
      // the radial direction of the circle there; the sine is that of the line and the tangent
      const radial = unit2([at[0] - b.c[0], at[1] - b.c[1]]);
      out.push({ at, sin: steps.length === 1 ? 0 : Math.abs(d[0] * radial[0] + d[1] * radial[1]) });
    }
    return out;
  }
  const [p, q] = [a as Extract<Curve2, { kind: 'circle' }>, b as Extract<Curve2, { kind: 'circle' }>];
  const delta: Vec2 = [q.c[0] - p.c[0], q.c[1] - p.c[1]];
  const distance = Math.hypot(delta[0], delta[1]);
  if (distance <= LENGTH_TOLERANCE) return [];
  const u: Vec2 = [delta[0] / distance, delta[1] / distance];
  if (Math.abs(distance - (p.r + q.r)) <= LENGTH_TOLERANCE) return [{ at: [p.c[0] + u[0] * p.r, p.c[1] + u[1] * p.r], sin: 0 }];
  if (Math.abs(distance - Math.abs(p.r - q.r)) <= LENGTH_TOLERANCE) {
    const sign = p.r > q.r ? 1 : -1;
    return [{ at: [p.c[0] + u[0] * p.r * sign, p.c[1] + u[1] * p.r * sign], sin: 0 }];
  }
  if (distance > p.r + q.r || distance < Math.abs(p.r - q.r)) return [];
  const along = (distance * distance + p.r * p.r - q.r * q.r) / (2 * distance);
  const half = Math.sqrt(Math.max(0, p.r * p.r - along * along));
  const foot: Vec2 = [p.c[0] + u[0] * along, p.c[1] + u[1] * along];
  return [-1, 1].map((side): Meeting => {
    const at: Vec2 = [foot[0] - side * u[1] * half, foot[1] + side * u[0] * half];
    const [np, nq] = [unit2([at[0] - p.c[0], at[1] - p.c[1]]), unit2([at[0] - q.c[0], at[1] - q.c[1]])];
    return { at, sin: Math.abs(cross2(np, nq)) };
  });
}
const unit2 = (v: Vec2): Vec2 => {
  const length = Math.hypot(v[0], v[1]);
  return [v[0] / length, v[1] / length];
};

// ---------------------------------------------------------------- the circles of two surfaces

// The circles two surfaces meet in, with what `circleBetween` needs to choose among them.
// - `axis`: both are surfaces about one axis; each circle with the sine of the angle at which the
//   two curves meet there.
// - `tube`: a torus and a plane that holds its axis; the first circle lies towards `side` from the
//   axis in that plane, the second across it.
type Meetings = { kind: 'none' } | { kind: 'other'; circles: Circle3[] } | { kind: 'axis'; o: Vec3; u: Vec3; circles: Circle3[]; sin: number[] } | { kind: 'tube'; o: Vec3; u: Vec3; side: Vec3; circles: Circle3[] };

const roundAxis = (s: Surface): { o: Vec3; u: Vec3 } | undefined =>
  s.kind === 'cone' ? { o: s.apex, u: unit3(s.axis) } : s.kind === 'cylinder' ? { o: s.origin, u: unit3(s.axis) } : s.kind === 'torus' ? { o: s.center, u: unit3(s.axis) } : undefined;

function meetings(a: Surface, b: Surface): Meetings {
  const sphere = a.kind === 'sphere' ? a : b.kind === 'sphere' ? b : undefined;
  if (sphere) {
    const other = sphere === a ? b : a;
    // a sphere and any plane: one circle, none where the plane touches the sphere
    if (other.kind === 'plane') {
      const n = unit3(other.normal);
      const d = dot3(sub3(sphere.center, other.origin), n);
      if (Math.abs(d) >= sphere.radius - LENGTH_TOLERANCE) return { kind: 'none' };
      return { kind: 'other', circles: [{ center: zeroless(sub3(sphere.center, mul3(n, d))), axis: n, radius: Math.sqrt(sphere.radius * sphere.radius - d * d) }] };
    }
    // two spheres: about the line of their centres
    if (other.kind === 'sphere') {
      const between = sub3(other.center, sphere.center);
      if (len3(between) <= LENGTH_TOLERANCE) return { kind: 'none' };
      return about(a, b, sphere.center, unit3(between));
    }
  }
  const torus = a.kind === 'torus' ? a : b.kind === 'torus' ? b : undefined;
  if (torus) {
    const other = torus === a ? b : a;
    const u = unit3(torus.axis);
    // a torus and a plane that holds its axis: the two circles of the tube in that plane
    if (other.kind === 'plane' && Math.abs(dot3(unit3(other.normal), u)) <= Math.sin(ANGLE_TOLERANCE) && Math.abs(dot3(sub3(torus.center, other.origin), unit3(other.normal))) <= LENGTH_TOLERANCE) {
      const n = unit3(other.normal);
      const side = unit3(cross3(u, n));
      if (torus.minorRadius <= LENGTH_TOLERANCE) return { kind: 'none' };
      const circles = [1, -1].map((sign): Circle3 => ({ center: zeroless(add3(torus.center, mul3(side, sign * torus.majorRadius))), axis: n, radius: torus.minorRadius }));
      return { kind: 'tube', o: torus.center, u, side, circles };
    }
  }
  // Surfaces about one axis. The axis of a cone first, then of a cylinder, then of a torus, so that
  // the circle of a pair the engine knew before the sphere and the torus keeps its axis.
  const line = [a, b].find((s) => s.kind === 'cone') ?? [a, b].find((s) => s.kind === 'cylinder') ?? [a, b].find((s) => s.kind === 'torus');
  const axis = line && roundAxis(line);
  return axis ? about(a, b, axis.o, axis.u) : { kind: 'none' };
}

// The circles of two surfaces about the axis through `o` along `u`: the points their curves meet in
// a half plane, off the axis by more than `LENGTH_TOLERANCE`. A point on the axis is none, and so
// is one across it (not on the face); it is never folded back.
function about(a: Surface, b: Surface, o: Vec3, u: Vec3): Meetings {
  const [ca, cb] = [curveOf(a, o, u), curveOf(b, o, u)];
  if (!ca || !cb) return { kind: 'none' };
  const circles: Circle3[] = [];
  const sin: number[] = [];
  for (const { at, sin: angle } of meet(ca, cb)) {
    const [z, rho] = at;
    if (rho <= LENGTH_TOLERANCE) continue;
    circles.push({ center: zeroless(add3(o, mul3(u, z))), axis: u, radius: rho });
    sin.push(angle);
  }
  return { kind: 'axis', o, u, circles, sin };
}

// Every circle two surfaces meet in, exactly, from the two surfaces alone (D58). At most two:
// - two faces of one surface give none;
// - a sphere and a plane: one circle, none where the plane touches the sphere within
//   `LENGTH_TOLERANCE`; two spheres: one, about the line of their centres;
// - two surfaces about one axis (a plane across it, a cylinder, a cone on the half its `axis`
//   points along, a sphere whose centre is on it, a torus by its signed major radius): where their
//   curves meet in a half plane through the axis, off the axis;
// - a torus and a plane that holds its axis: the two circles of the tube in that plane;
// - nothing else (two cylinders, a plane and a round surface at an angle, a swept or a general
//   surface). The radius of a circle is above `LENGTH_TOLERANCE`.
export function circlesBetween(a: Surface, b: Surface): Circle3[] {
  const found = meetings(a, b);
  return found.kind === 'none' ? [] : found.circles;
}

// The circle two faces meet in, or undefined when they meet in none, or in one of two that cannot
// be told apart. The rule gives an edge the kind `circle` (`edgeKind` in solid.ts):
// - the only circle of `circlesBetween`;
// - of two circles about one axis, the one the points of the edge say (`points`: three numbers
//   a point, the segments of the edge; `tolerance`: the chord tolerance of the document). The mesh
//   of an edge does not lie on its circle: each face is a polygon within the tolerance of its
//   surface, and where the two meet at a small angle θ the edge moves along them by about
//   `tolerance / sin θ`. So each circle has a reach, `2 · tolerance / sin θ` plus the precision of
//   the coordinates of the points; the two are told apart only when their distance in the half
//   plane is more than the sum of their reaches, and then the chosen one is the circle every point
//   lies within the reach of. Otherwise undefined: an edge that cannot be told is `other`, never
//   a wrong circle.
// - a torus and a plane that holds its axis: the side of the axis the points lie on (points on the
//   axis, within `LENGTH_TOLERANCE` plus the precision of the coordinates, left out); points on
//   both sides give undefined. The circle is the one centred at the signed major radius towards
//   that side.
// - two possible and no points or no tolerance: undefined.
export function circleBetween(a: Surface, b: Surface, points?: ArrayLike<number>, tolerance?: number): Circle3 | undefined {
  const found = meetings(a, b);
  if (found.kind === 'none' || found.circles.length === 0) return undefined;
  if (found.circles.length === 1) return found.circles[0];
  if (!points || points.length < 3 || tolerance === undefined || found.kind === 'other') return undefined;
  let largest = 1;
  for (let i = 0; i < points.length; i++) largest = Math.max(largest, Math.abs(points[i]));
  const precision = 1e-6 * largest;
  const pointAt = (i: number): Vec3 => [points[i], points[i + 1], points[i + 2]];
  if (found.kind === 'tube') {
    let side = 0;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const p = pointAt(i);
      if (offAxis(p, found.o, found.u) <= LENGTH_TOLERANCE + precision) continue;
      const sign = Math.sign(dot3(sub3(p, found.o), found.side));
      if (sign === 0) continue;
      if (side !== 0 && sign !== side) return undefined;
      side = sign;
    }
    return side === 0 ? undefined : found.circles[side > 0 ? 0 : 1];
  }
  // the coordinates of a point and of a circle in the half plane through the axis
  const { o, u, circles, sin } = found;
  const half = (p: Vec3): Vec2 => [dot3(sub3(p, o), u), offAxis(p, o, u)];
  const places = circles.map((circle) => [dot3(sub3(circle.center, o), u), circle.radius] as Vec2);
  const reach = sin.map((angle) => (angle > 0 ? (2 * tolerance) / angle : Infinity) + precision);
  if (Math.hypot(places[0][0] - places[1][0], places[0][1] - places[1][1]) <= reach[0] + reach[1]) return undefined;
  let chosen = -1;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const [z, rho] = half(pointAt(i));
    const within = places.findIndex((place, k) => Math.hypot(z - place[0], rho - place[1]) <= reach[k]);
    if (within < 0 || (chosen >= 0 && within !== chosen)) return undefined;
    chosen = within;
  }
  return chosen < 0 ? undefined : circles[chosen];
}
