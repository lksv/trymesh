// The tools of a chamfer and a fillet of edges (D63): the profile of the corner of an edge, the prism
// of a straight piece and the revolve of a circular one, and the parts of them inside the wedge
// that the volume check measures. The step that uses them is recompute/edge-blend.ts; the rules are
// in docs/architecture/edge-blend.md.
import { type Region, segments } from '../sketch';
import { toWorld } from '../solid';
import type { Frame, Solid, SolidKernel, Vec2, Vec3 } from '../types';
import { LENGTH_TOLERANCE, add3, cross2, cross3, dot2, dot3, mul3, sub3 } from '../util';
import type { RevolveSetup } from './tool-revolve';

// An end of the blend that lies on a round face (a cylinder, a cone) is moved off it, away from the
// corner, until it is this many chord tolerances from it: a chamfer's end along the chamfer's own
// line (its surface stays exact), a fillet's along the normal of the face. An end on a plane stays
// on it. The polygon of a round face lies up to the chord tolerance inside its surface; a tool
// whose end stands on the exact surface grazes it (design of D63, "Measured", C).
export const BLEND_LIFT = 1.5;
// ... and at least this many bands of the kernel (its tolerance for flush faces, `bandOf` of
// recompute/body-boolean.ts): at a chord tolerance near the band (0.001 on a body of 100 mm) the
// lift of 1.5 chord tolerances left a step between the tools of a chain that the kernel refused or
// collapsed (design of D63, "As implemented").
export const BLEND_LIFT_BANDS = 2;
// The lift of a body: BLEND_LIFT chord tolerances, at least BLEND_LIFT_BANDS bands of the kernel.
export const liftOf = (chordTolerance: number, band: number): number => Math.max(BLEND_LIFT * chordTolerance, BLEND_LIFT_BANDS * band);
// The tool reaches past both faces: past a convex edge (outside the body) by max(size,
// BLEND_OVERSHOOT × chord tolerance), the size being the distance or the radius; past a concave
// edge (into the body) by BLEND_OVERSHOOT × chord tolerance only (the size pierced a wall thinner
// than it behind the corner).
export const BLEND_OVERSHOOT = 4;
// The smallest angle, in radians, between the faces of an edge and flat or folded, and between
// a straight edge and the plane its tool ends in.
export const BLEND_MIN_ANGLE = 0.01;
// What the overshoot faces of the tool of a piece may leave in the result, in mm² per mm of the
// length of the piece; a sliver up to that is given to the new face of the edge, more is
// `blendDoesNotFit`. A cap left where two tools meet (a smooth end, a mitre, the corner of two
// edges) goes to the blend of its edge up to BLEND_LIFT × chord tolerance × (size + overshoot)
// mm², the step the lift leaves between a lifted tool and one that is not; more is
// `unsupportedEdge` with both edges.
export const BLEND_SLIVER = 1e-4;
// The volume check: what the feature cut or added may exceed what the parts of its tools inside
// their wedges hold together by at most BLEND_VOLUME × the chord tolerance × the area of the
// strips the blends eat (twice the setback times the length of each piece), plus 10⁻³ mm³.
export const BLEND_VOLUME = 0.5;

export type BlendKind = 'chamfer' | 'fillet';

// The corner of a piece of an edge, in the plane across a straight edge or in the half plane
// through the axis of a circular one: the angle between the two faces on the side the tool goes,
// whether the material lies inside it (cut) or outside (added), and which of the faces `a` and `b`
// are round (the lift).
export interface BlendCorner {
  beta: number;
  convex: boolean;
  round: [boolean, boolean];
}

// The sides of the profile, in its order: the blend, then the overshoot past face `b`, round the
// corner, and back past face `a`.
export type BlendSide = 'blend' | 'pastB' | 'cornerB' | 'cornerA' | 'pastA';
export const BLEND_SIDES: readonly BlendSide[] = ['blend', 'pastB', 'cornerB', 'cornerA', 'pastA'];

// The profile of the tool, counter-clockwise, in the coordinates of the corner: the corner at the
// origin, face `a` along +x, face `b` along (cos β, sin β).
// - `points`, `keys`: the side from point k to point k + 1 is part of `keys[k]`.
// - `blend`: the exact line or circle of the blend, before the lift, from which its surface is
//   computed. `center` of a fillet is the centre of its arc.
// - `setback`: how far along each face from the corner the blend meets it.
// - `overshoot`: how far the tool reaches past the faces.
// - `wedge`: the part of the profile inside the wedge, closed along the two faces instead of past
//   them (the corner, the exact blend from face `a` to face `b`), counter-clockwise: what the
//   volume check measures.
export interface BlendProfile {
  points: Vec2[];
  keys: BlendSide[];
  blend: { type: 'line'; a: Vec2; b: Vec2 } | { type: 'round'; center: Vec2; radius: number };
  setback: number;
  overshoot: number;
  wedge: Vec2[];
}

// The unit directions of the profile: `ua` along face a, `ub` along face b, `mA` across face a away
// from the wedge, `mB` across face b away from it, and `k`, the corner of the overshoot for an
// overshoot of 1 (k · mA = k · mB = 1).
function directions(beta: number): { ua: Vec2; ub: Vec2; mA: Vec2; mB: Vec2; k: Vec2 } {
  const ua: Vec2 = [1, 0];
  const ub: Vec2 = [Math.cos(beta), Math.sin(beta)];
  const mA: Vec2 = [0, -1];
  const mB: Vec2 = [-Math.sin(beta), Math.cos(beta)];
  const det = mA[0] * mB[1] - mA[1] * mB[0];
  const k: Vec2 = [(mB[1] - mA[1]) / det, (mA[0] - mB[0]) / det];
  return { ua, ub, mA, mB, k };
}

// The default overshoot of a corner (see BLEND_OVERSHOOT): BLEND_OVERSHOOT chord tolerances, or
// the same share of the lift where the lift is held up by the band of the kernel (`liftOf`).
export const overshootOf = (size: number, convex: boolean, lift: number): number => {
  const least = (BLEND_OVERSHOOT / BLEND_LIFT) * lift;
  return convex ? Math.max(size, least) : least;
};

// The profile of the tool of a corner. `overshoot` replaces the default one (shortened towards the
// axis of a circular edge); `lift` is how far an end on a round face is moved off it (`liftOf`).
// The arc of a fillet is divided for half the chord tolerance.
export function blendProfile(kind: BlendKind, size: number, corner: BlendCorner, chordTolerance: number, options: { overshoot?: number; lift?: number } = {}): BlendProfile {
  const lift = options.lift ?? BLEND_LIFT * chordTolerance;
  const overshoot = options.overshoot ?? overshootOf(size, corner.convex, lift);
  const { beta } = corner;
  const { ua, ub, mA, mB, k } = directions(beta);
  const setback = kind === 'chamfer' ? size : size / Math.tan(beta / 2);
  const ta: Vec2 = [setback * ua[0], setback * ua[1]];
  const tb: Vec2 = [setback * ub[0], setback * ub[1]];
  const exact: Vec2[] = [ta];
  let blend: BlendProfile['blend'] = { type: 'line', a: ta, b: tb };
  if (kind === 'fillet') {
    const reach = size / Math.sin(beta / 2);
    const center: Vec2 = [reach * Math.cos(beta / 2), reach * Math.sin(beta / 2)];
    const start = Math.atan2(ta[1] - center[1], ta[0] - center[0]);
    const sweep = -(Math.PI - beta); // from face a to face b about the centre, on the side of the corner
    const n = segments(Math.abs(sweep), size, chordTolerance / 2);
    for (let i = 1; i < n; i++) exact.push([center[0] + size * Math.cos(start + (sweep * i) / n), center[1] + size * Math.sin(start + (sweep * i) / n)]);
    blend = { type: 'round', center, radius: size };
  }
  exact.push(tb);
  const lifted = [...exact];
  if (kind === 'chamfer') {
    // along the chamfer's own line, past the face, until the end is `lift` off it
    const along: Vec2 = [(ta[0] - tb[0]) / Math.hypot(ta[0] - tb[0], ta[1] - tb[1]), (ta[1] - tb[1]) / Math.hypot(ta[0] - tb[0], ta[1] - tb[1])];
    if (corner.round[0]) {
      const s = lift / Math.abs(dot2(along, mA));
      lifted[0] = [ta[0] + s * along[0], ta[1] + s * along[1]];
    }
    if (corner.round[1]) {
      const s = lift / Math.abs(dot2(along, mB));
      lifted[lifted.length - 1] = [tb[0] - s * along[0], tb[1] - s * along[1]];
    }
  } else {
    if (corner.round[0]) lifted[0] = [ta[0] + lift * mA[0], ta[1] + lift * mA[1]];
    if (corner.round[1]) lifted[lifted.length - 1] = [tb[0] + lift * mB[0], tb[1] + lift * mB[1]];
  }
  const points: Vec2[] = [...lifted, [tb[0] + overshoot * mB[0], tb[1] + overshoot * mB[1]], [overshoot * k[0], overshoot * k[1]], [ta[0] + overshoot * mA[0], ta[1] + overshoot * mA[1]]];
  const keys: BlendSide[] = [...lifted.slice(1).map((): BlendSide => 'blend'), 'pastB', 'cornerB', 'cornerA', 'pastA'];
  return { points, keys, blend, setback, overshoot, wedge: [[0, 0], ...exact] };
}

// The overshoot points of a profile as functions of the overshoot `o`: `at + o · along`, in the
// order pastB, the corner, pastA. For the shortening towards the axis of a circular edge.
export function overshootPoints(kind: BlendKind, size: number, beta: number): { at: Vec2; along: Vec2 }[] {
  const { ub, mA, mB, k } = directions(beta);
  const setback = kind === 'chamfer' ? size : size / Math.tan(beta / 2);
  return [
    { at: [setback * ub[0], setback * ub[1]], along: mB },
    { at: [0, 0], along: k },
    { at: [setback, 0], along: mA },
  ];
}

// ---------------------------------------------------------------- a straight piece

// A plane a tool ends in: a point of it and its normal (any length, either sense).
export interface EndPlane {
  point: Vec3;
  normal: Vec3;
}

// A point of the profile carried along the edge (Z = X × Y of `frame`) to a plane.
function carried(p: Vec2, frame: Frame, plane: EndPlane): Vec3 {
  const at = toWorld(frame, p[0], p[1]);
  const z = cross3(frame.x, frame.y);
  const s = dot3(sub3(plane.point, at), plane.normal) / dot3(z, plane.normal);
  return add3(at, mul3(z, s));
}

// The shortest length along the edge of a prism between its two end planes, over the points of the
// profile: at or below zero the two ends cross within the profile.
export function prismLength(points: readonly Vec2[], frame: Frame, ends: readonly [EndPlane, EndPlane]): number {
  const z = cross3(frame.x, frame.y);
  let shortest = Infinity;
  for (const p of points) shortest = Math.min(shortest, dot3(sub3(carried(p, frame, ends[1]), carried(p, frame, ends[0])), z));
  return shortest;
}

// The prism of a profile along a straight edge (design of D63, "Recompute", 9): the profile placed
// in `frame` (its origin a point of the edge, X along face `a`, Y across towards face `b`), every
// vertex carried along Z = X × Y to the plane of each end, `ends[0]` the end at the smaller Z; the
// two ends triangulated by the kernel, two triangles per side of the profile. Closed and facing
// outwards. `sides[k]` is the face number of the side from point k to point k + 1, `caps` those of
// the two ends.
export function edgePrism(points: readonly Vec2[], sides: readonly number[], frame: Frame, ends: readonly [EndPlane, EndPlane], caps: readonly [number, number], kernel: Pick<SolidKernel, 'triangulate'>): Solid {
  const n = points.length;
  const positions: number[] = [];
  for (const end of ends) for (const p of points) positions.push(...carried(p, frame, end));
  const triangles: number[] = [];
  const faceIds: number[] = [];
  const flat = kernel.triangulate([Float64Array.from(points.flat())]);
  for (let i = 0; i < flat.length; i += 3) {
    triangles.push(flat[i], flat[i + 2], flat[i + 1], n + flat[i], n + flat[i + 1], n + flat[i + 2]);
    faceIds.push(caps[0], caps[1]);
  }
  for (let k = 0; k < n; k++) {
    const [i, j] = [k, (k + 1) % n];
    triangles.push(i, j, n + j, i, n + j, n + i);
    faceIds.push(sides[k], sides[k]);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}
export const prismTriangles = (count: number): number => 2 * count + 2 * (count - 2);

// ---------------------------------------------------------------- a circular piece

// Where the corner of a circular edge lies in the half plane (ρ, z) through its axis: the edge's
// point, the unit direction of face `a` there, and the unit direction across it towards face `b`.
export interface CornerPlace {
  point: Vec2;
  alongA: Vec2;
  acrossTowardsB: Vec2;
}
export const placed = (place: CornerPlace, p: Vec2): Vec2 => [place.point[0] + p[0] * place.alongA[0] + p[1] * place.acrossTowardsB[0], place.point[1] + p[0] * place.alongA[1] + p[1] * place.acrossTowardsB[1]];

// The signed area of a closed polygon (positive counter-clockwise).
const signedArea = (points: readonly Vec2[]): number => points.reduce((sum, p, i) => sum + cross2(p, points[(i + 1) % points.length]), 0) / 2;

// A profile carried into (ρ, z) as the one region of a revolve, counter-clockwise: where the place
// mirrors it, its n points are reversed, points'[i] = points[n − 1 − i], and its keys with them,
// keys'[i] = keys[(n − 2 − i) mod n].
export function revolveRegion(place: CornerPlace, points: readonly Vec2[], keys: readonly string[]): Region {
  let xy = points.map((p) => placed(place, p));
  let curves = [...keys];
  if (signedArea(xy) < 0) {
    const n = xy.length;
    xy = xy.map((_, i) => xy[n - 1 - i]);
    curves = curves.map((_, i) => keys[(((n - 2 - i) % n) + n) % n]);
  }
  return { ref: { outerLoop: [] }, outer: { xy: xy.flat(), keys: xy.map((_, i) => `p${i}`), curves }, holes: [] };
}

// The setup of 4a's revolve for one region in a frame whose Y is the axis and whose X is the
// radial direction at the start of the turn: the profile lies on the side of +X (the right of the
// axis), the steps by 4a's rule (half the chord tolerance at the largest radius of the profile),
// the triangles as 4a counts them.
export function blendRevolveSetup(region: Region, sweep: number, full: boolean, chordTolerance: number): RevolveSetup {
  const xy = region.outer.xy;
  let largest = 0;
  for (let i = 0; i < xy.length; i += 2) largest = Math.max(largest, xy[i]);
  const steps = segments(sweep, largest, chordTolerance / 2);
  const count = xy.length / 2;
  let triangles = 0;
  for (let k = 0; k < count; k++) triangles += (2 - [k, (k + 1) % count].filter((i) => xy[2 * i] <= LENGTH_TOLERANCE).length) * steps;
  if (!full) triangles += 2 * (count - 2);
  return { regions: [region], axis: { point: [0, 0], direction: [0, 1], side: -1 }, steps, triangles };
}

// ---------------------------------------------------------------- run-outs (D67)

// An edge may end at a round face C it crosses, past which the tool changes nothing (a convex edge
// into C's air, a concave edge into C's material): the tool then runs on past the end until its
// corner lies beyond C by the lift (a run-out). The rules are in docs/architecture/edge-blend.md,
// "Run-outs (D67)"; the design is docs/d36/4c-blend-round-ends/design.md.

// The least angle between an edge (its tangent, for an arc) and the tangent plane of C where the
// edge's line or circle meets C exactly, in radians. Below it the end is refused (`unsupportedEdge`).
// Read at the mesh vertex instead, a crossing of 12° looked like 8° at the chord tolerance 0.05.
export const BLEND_MIN_CROSSING = (10 * Math.PI) / 180;
// The bound of the void check (mm³): what the part of a tool past its end may take beyond C
// (convex) or add there (concave). Every accepted case measured exactly 0; the least a regression
// had to be refused at was 1.9 × 10⁻⁴ mm³.
export const BLEND_RUN_OUT_VOID = 1e-5;
// A non-empty result of the void check under the bound is accepted only where the kernel's
// uncertainty for it, its band times the result's area, is under the bound too.
export const runOutUncertain = (band: number, resultArea: number): boolean => band * resultArea > BLEND_RUN_OUT_VOID;
// The polygon of the region beyond a cylinder has sides enough to keep its sagitta at most this
// share of the chord tolerance; where the cap of `segments` (4 096) leaves it larger, the run-out
// is refused (a radius absurd for the chord tolerance).
export const RUN_OUT_REGION_SAGITTA = 0.25;
export function runOutRegionSides(radius: number, chordTolerance: number): number | undefined {
  const budget = RUN_OUT_REGION_SAGITTA * chordTolerance;
  const n = segments(2 * Math.PI, radius, budget);
  return radius * (1 - Math.cos(Math.PI / n)) <= budget * (1 + 1e-9) ? n : undefined;
}

// How a piece goes on past an end, exactly: a translation for a straight piece (`point` the end, the
// unit `direction` past it, t in mm); a rotation for an arc about the line (`center`, unit `axis`) by
// `sense` · t radians (`point` the curve's point at t = 0 and `radius` its distance from the axis).
// Started at the middle of a piece, the same motion is the curve whose roots with C are solved.
export type Motion =
  | { kind: 'translation'; point: Vec3; direction: Vec3 }
  | { kind: 'rotation'; center: Vec3; axis: Vec3; radius: number; point: Vec3; sense: 1 | -1 };
// C as a run-out sees it: a cylinder by its axis line (unit `axis`) and radius, or a plane by a point
// and its unit normal.
export type RunOutFace = { kind: 'cylinder'; point: Vec3; axis: Vec3; radius: number } | { kind: 'plane'; origin: Vec3; normal: Vec3 };

const TWO_PI = 2 * Math.PI;
const norm = (x: number): number => ((x % TWO_PI) + TWO_PI) % TWO_PI;
const acrossOf = (v: Vec3, axis: Vec3): Vec3 => sub3(v, mul3(axis, dot3(v, axis)));
const unit = (v: Vec3): Vec3 => mul3(v, 1 / Math.hypot(v[0], v[1], v[2]));
// Two unit directions across a unit axis, e1 × e2 = axis.
export function basisAcross(axis: Vec3): [Vec3, Vec3] {
  const e1 = unit(Math.abs(axis[0]) < 0.9 ? cross3(axis, [1, 0, 0]) : cross3(axis, [0, 1, 0]));
  return [e1, cross3(axis, e1)];
}

// A point carried by a motion to the parameter t.
export function moved(motion: Motion, q: Vec3, t: number): Vec3 {
  if (motion.kind === 'translation') return add3(q, mul3(motion.direction, t));
  const { center, axis, sense } = motion;
  const angle = sense * t;
  const v = sub3(q, center);
  const along = mul3(axis, dot3(v, axis));
  const radial = sub3(v, along);
  return add3(center, add3(along, add3(mul3(radial, Math.cos(angle)), mul3(cross3(axis, radial), Math.sin(angle)))));
}
// The unit tangent of the curve of a motion (its own point carried) at t.
export function wayAt(motion: Motion, t: number): Vec3 {
  if (motion.kind === 'translation') return motion.direction;
  const at = moved(motion, motion.point, t);
  return mul3(unit(cross3(motion.axis, acrossOf(sub3(at, motion.center), motion.axis))), motion.sense);
}
// C's implicit function (outside a cylinder positive, on the side of a plane's normal positive) and
// its unit gradient.
export const implicit = (face: RunOutFace, x: Vec3): number => {
  if (face.kind === 'plane') return dot3(sub3(x, face.origin), face.normal);
  const r = acrossOf(sub3(x, face.point), face.axis);
  return dot3(r, r) - face.radius * face.radius;
};
export const gradient = (face: RunOutFace, x: Vec3): Vec3 => (face.kind === 'plane' ? face.normal : unit(acrossOf(sub3(x, face.point), face.axis)));

// The real roots of A t² + B t + C, ascending.
function roots(A: number, B: number, C: number): number[] {
  if (Math.abs(A) < 1e-15) return Math.abs(B) < 1e-15 ? [] : [-C / B];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].sort((x, y) => x - y);
}

// The parameters t ≥ 0 at which the curve of a motion meets C's surface, ascending: a line and a
// cylinder of any axis (a quadratic), a line and a plane, a circle and a cylinder or a plane parallel
// to its axis (in the plane across the axis: two circles, a circle and a line; t in [0, 2π)).
export function rootsAlong(curve: Motion, face: RunOutFace): number[] {
  let found: number[];
  if (curve.kind === 'translation') {
    const { point: p, direction: u } = curve;
    if (face.kind === 'cylinder') {
      const w = acrossOf(sub3(p, face.point), face.axis);
      const v = acrossOf(u, face.axis);
      found = roots(dot3(v, v), 2 * dot3(w, v), dot3(w, w) - face.radius * face.radius);
    } else {
      const nu = dot3(u, face.normal);
      found = Math.abs(nu) < 1e-15 ? [] : [dot3(sub3(face.origin, p), face.normal) / nu];
    }
  } else {
    const [e1, e2] = basisAcross(curve.axis);
    const to2 = (x: Vec3): Vec2 => [dot3(sub3(x, curve.center), e1), dot3(sub3(x, curve.center), e2)];
    const p2 = to2(curve.point);
    const rho = Math.hypot(p2[0], p2[1]);
    const from = Math.atan2(p2[1], p2[0]);
    let psis: number[] = [];
    if (face.kind === 'cylinder') {
      const c = to2(face.point);
      const d = Math.hypot(c[0], c[1]);
      if (d > 1e-12) {
        const k = (d * d + rho * rho - face.radius * face.radius) / (2 * rho * d);
        if (Math.abs(k) <= 1) psis = [1, -1].map((g) => Math.atan2(c[1], c[0]) + g * Math.acos(k));
      }
    } else {
      const n2: Vec2 = [dot3(face.normal, e1), dot3(face.normal, e2)];
      const m = Math.hypot(n2[0], n2[1]);
      if (m > 1e-12) {
        const k = dot3(sub3(face.origin, curve.center), face.normal) / m / rho;
        if (Math.abs(k) <= 1) psis = [1, -1].map((g) => Math.atan2(n2[1], n2[0]) + g * Math.acos(k));
      }
    }
    found = psis.map((psi) => norm(curve.sense * (psi - from)));
  }
  return found.filter((t) => t > 0).sort((x, y) => x - y);
}

// ------------------------------------------------ exact sets of the parameter

type Interval = [number, number];
// The intersection of sets of closed intervals within [0, limit].
function intersectAll(sets: Interval[][], limit: number): Interval[] {
  let current: Interval[] = [[0, limit]];
  for (const set of sets) {
    const next: Interval[] = [];
    for (const [a, b] of current) for (const [c, d] of set) if (Math.max(a, c) <= Math.min(b, d)) next.push([Math.max(a, c), Math.min(b, d)]);
    current = next;
    if (!current.length) return [];
  }
  return current.sort((x, y) => x[0] - y[0]);
}
const clip = (list: Interval[], limit: number): Interval[] => list.map(([x, y]): Interval => [Math.max(0, x), Math.min(limit, y)]).filter(([x, y]) => x <= y);
// t where p + t·u lies inside (`inside`) or outside a cylinder of radius r about the line (o, unit a).
function lineCylinder(p: Vec3, u: Vec3, o: Vec3, a: Vec3, r: number, inside: boolean, limit: number): Interval[] {
  const w = acrossOf(sub3(p, o), a);
  const v = acrossOf(u, a);
  const [A, B, C] = [dot3(v, v), 2 * dot3(w, v), dot3(w, w) - r * r];
  if (A < 1e-15) return C <= 0 === inside ? [[0, limit]] : [];
  const t = roots(A, B, C);
  if (t.length < 2) return inside ? [] : [[0, limit]];
  return clip(inside ? [[t[0], t[1]]] : [[-Infinity, t[0]], [t[1], Infinity]], limit);
}
// t where p + t·u lies on the side n · x ≥ h of a plane (n unit, x relative to the plane's origin).
function linePlane(p: Vec3, u: Vec3, o: Vec3, n: Vec3, h: number, limit: number): Interval[] {
  const [s, nu] = [dot3(sub3(p, o), n), dot3(u, n)];
  if (Math.abs(nu) < 1e-15) return s >= h ? [[0, limit]] : [];
  const t = (h - s) / nu;
  return clip(nu > 0 ? [[t, Infinity]] : [[-Infinity, t]], limit);
}
// The angles t, from `from` in the sense `sense`, at which a point at the radius rho about the origin
// of the plane across the axis has cos(φ − α) ≥ k (its angle φ within acos k of α).
function arcWithin(from: number, sense: 1 | -1, alpha: number, k: number, limit: number): Interval[] {
  if (k > 1) return [];
  if (k <= -1) return [[0, limit]];
  const half = Math.acos(k);
  const lo = norm(sense * (alpha - from) - half);
  return clip([[lo - TWO_PI, lo + 2 * half - TWO_PI], [lo, lo + 2 * half]], limit);
}
// ... inside (or outside) a circle of radius r about c of that plane.
function circleCircle(rho: number, from: number, sense: 1 | -1, c: Vec2, r: number, inside: boolean, limit: number): Interval[] {
  const d = Math.hypot(c[0], c[1]);
  if (d < 1e-12 || rho < 1e-12) return (Math.hypot(rho, d) <= r) === inside ? [[0, limit]] : [];
  const k = (d * d + rho * rho - r * r) / (2 * rho * d);
  const alpha = Math.atan2(c[1], c[0]);
  if (inside) return arcWithin(from, sense, alpha, k, limit);
  // outside: the angle farther than acos k from α, i.e. within π − acos k of α + π
  return arcWithin(from, sense, alpha + Math.PI, -k, limit).filter(([x, y]) => y >= x);
}
// ... on the side n · x ≥ h of a line of that plane (n unit).
function circlePlane(rho: number, from: number, sense: 1 | -1, n: Vec2, h: number, limit: number): Interval[] {
  if (rho < 1e-12) return h <= 0 ? [[0, limit]] : [];
  return arcWithin(from, sense, Math.atan2(n[1], n[0]), h / rho, limit);
}
// The distance of the origin from a segment of the plane.
function originToSegment(a: Vec2, b: Vec2): number {
  const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = dot2(ab, ab);
  const s = l2 > 0 ? Math.max(0, Math.min(1, -dot2(a, ab) / l2)) : 0;
  return Math.hypot(a[0] + s * ab[0], a[1] + s * ab[1]);
}
function containsOrigin(polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if (a[1] > 0 !== b[1] > 0 && 0 < ((b[0] - a[0]) * -a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
// Where a moving polygon of the plane across a cylinder's axis (at the origin) stays clear of the
// disc of radius R: its membership changes only where a vertex lies at R from the origin or a side's
// line at R or 0 (`criticals`, exact roots), so the pieces between them are tested at their middles.
function clearOf(at: (t: number) => Vec2[], criticals: number[], R: number, limit: number): Interval[] {
  const cuts = [0, ...criticals.filter((t) => t > 0 && t < limit).sort((x, y) => x - y), limit];
  const clear = (t: number): boolean => {
    const poly = at(t);
    return !containsOrigin(poly) && poly.every((p, i) => originToSegment(p, poly[(i + 1) % poly.length]) >= R);
  };
  const out: Interval[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (cuts[i + 1] - cuts[i] < 1e-12) continue;
    if (!clear((cuts[i] + cuts[i + 1]) / 2)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - cuts[i]) < 1e-12) last[1] = cuts[i + 1];
    else out.push([cuts[i], cuts[i + 1]]);
  }
  return out;
}
// The critical parameters of a polygon translated by t·v: a vertex at distance R (a quadratic), a
// side's line at distance R or 0 (linear).
function translationCriticals(poly: readonly Vec2[], v: Vec2, R: number): number[] {
  const out: number[] = [];
  for (const p of poly) out.push(...roots(dot2(v, v), 2 * dot2(p, v), dot2(p, p) - R * R));
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(l > 1e-12)) return;
    const n: Vec2 = [-(q[1] - p[1]) / l, (q[0] - p[0]) / l];
    const nv = dot2(n, v);
    if (Math.abs(nv) > 1e-15) for (const h of [R, -R, 0]) out.push((h - dot2(n, p)) / nv);
  });
  return out;
}
// The critical angles of a polygon turned by sense · t about the origin against a disc of radius R
// about c: a vertex at R from c (two circles), a side's line at R or 0 from c (a circle and a line),
// solved in the polygon's frame where c turns the other way.
function rotationCriticals(poly: readonly Vec2[], c: Vec2, sense: 1 | -1, R: number): number[] {
  const rc = Math.hypot(c[0], c[1]);
  if (rc < 1e-12) return [];
  const phi = Math.atan2(c[1], c[0]);
  const angles: number[] = [];
  for (const p of poly) {
    const d = Math.hypot(p[0], p[1]);
    if (d < 1e-15) continue;
    const k = (rc * rc + d * d - R * R) / (2 * rc * d);
    if (Math.abs(k) <= 1) for (const s of [1, -1]) angles.push(Math.atan2(p[1], p[0]) + s * Math.acos(k));
  }
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(l > 1e-12)) return;
    const n: Vec2 = [-(q[1] - p[1]) / l, (q[0] - p[0]) / l];
    for (const h of [R, -R, 0]) {
      const k = (dot2(n, p) + h) / rc;
      if (Math.abs(k) <= 1) for (const s of [1, -1]) angles.push(Math.atan2(n[1], n[0]) + s * Math.acos(k));
    }
  });
  // c turned by −sense · t lies at the angle ψ: t = sense · (φ − ψ), taken in [0, 2π)
  return angles.map((psi) => norm(sense * (phi - psi)));
}

// The side of C a set of points has to keep to: inside (or outside) a cylinder of `radius` about C's
// axis, or on the side of `normal` of a plane by at least `offset`.
type SideOf = { kind: 'cylinder'; point: Vec3; axis: Vec3; radius: number; inside: boolean } | { kind: 'plane'; origin: Vec3; normal: Vec3; offset: number };

// The parameters t in [0, limit] at which every point carried by `motion` lies on `side`; outside a
// cylinder (a region that is not convex) the whole polygon of the points as well, in the plane across
// the cylinder's axis, exactly. A rotation is about an axis parallel to the cylinder's or the plane's.
function onSide(points: readonly Vec3[], motion: Motion, side: SideOf, limit: number): Interval[] {
  const sets: Interval[][] = [];
  if (motion.kind === 'translation') {
    const u = motion.direction;
    if (side.kind === 'plane') for (const p of points) sets.push(linePlane(p, u, side.origin, side.normal, side.offset, limit));
    else {
      for (const p of points) sets.push(lineCylinder(p, u, side.point, side.axis, side.radius, side.inside, limit));
      if (!side.inside) {
        const [f1, f2] = basisAcross(side.axis);
        const poly = points.map((x): Vec2 => [dot3(sub3(x, side.point), f1), dot3(sub3(x, side.point), f2)]);
        const v: Vec2 = [dot3(u, f1), dot3(u, f2)];
        sets.push(clearOf((t) => poly.map((p): Vec2 => [p[0] + t * v[0], p[1] + t * v[1]]), translationCriticals(poly, v, side.radius), side.radius, limit));
      }
    }
  } else {
    const { center, axis, sense } = motion;
    const [e1, e2] = basisAcross(axis);
    const to2 = (x: Vec3): Vec2 => [dot3(sub3(x, center), e1), dot3(sub3(x, center), e2)];
    const poly = points.map(to2);
    if (side.kind === 'plane') {
      const n2: Vec2 = [dot3(side.normal, e1), dot3(side.normal, e2)];
      const m = Math.hypot(n2[0], n2[1]);
      const h = (side.offset + dot3(sub3(side.origin, center), side.normal)) / m;
      for (const p of poly) sets.push(circlePlane(Math.hypot(p[0], p[1]), Math.atan2(p[1], p[0]), sense, [n2[0] / m, n2[1] / m], h, limit));
    } else {
      const c = to2(side.point);
      for (const p of poly) sets.push(circleCircle(Math.hypot(p[0], p[1]), Math.atan2(p[1], p[0]), sense, c, side.radius, side.inside, limit));
      if (!side.inside) {
        const turned = (t: number): Vec2[] =>
          poly.map((p): Vec2 => {
            const [cs, sn] = [Math.cos(sense * t), Math.sin(sense * t)];
            return [p[0] * cs - p[1] * sn - c[0], p[0] * sn + p[1] * cs - c[1]];
          });
        sets.push(clearOf(turned, rotationCriticals(poly, c, sense, side.radius), side.radius, limit));
      }
    }
  }
  return intersectAll(sets, limit);
}

// C seen from beyond it: `beyondInside` for a cylinder (the side past the end is its inside); a
// plane's normal points beyond.
const beyondSide = (face: RunOutFace, beyondInside: boolean, by: number): SideOf =>
  face.kind === 'plane' ? { kind: 'plane', origin: face.origin, normal: face.normal, offset: by } : { kind: 'cylinder', point: face.point, axis: face.axis, radius: beyondInside ? face.radius - by : face.radius + by, inside: beyondInside };
const ownSide = (face: RunOutFace, beyondInside: boolean, by: number): SideOf =>
  face.kind === 'plane' ? { kind: 'plane', origin: face.origin, normal: mul3(face.normal, -1), offset: -by } : { kind: 'cylinder', point: face.point, axis: face.axis, radius: beyondInside ? face.radius - by : face.radius + by, inside: !beyondInside };

// The reach of a run-out, exactly: the least t in [0, limit] at which every point of the profile's
// `wedge` (3D, at the end), carried by `motion`, lies beyond C by the lift (outside a cylinder the
// whole wedge polygon too). Undefined: no such t (a bridge).
export function reachPast(wedge: readonly Vec3[], motion: Motion, face: RunOutFace, beyondInside: boolean, lift: number, limit: number): number | undefined {
  const found = onSide(wedge, motion, beyondSide(face, beyondInside, lift), limit);
  return found.length ? found[0][0] : undefined;
}

// Where the void check starts on the piece, as the parameter of `back` (the motion from the end
// back along the piece): the first t at which the whole tool profile (3D, at the end) lies on the own
// side of the region beyond C by `offset` (the polygon too where that side is not convex, outside a
// cylinder), then back by `margin` within the stretch where it stays clear, at most to its middle.
// Undefined: the profile is nowhere clear within the piece.
export function checkFrom(profile: readonly Vec3[], back: Motion, face: RunOutFace, beyondInside: boolean, offset: number, pieceSpan: number, margin: number): number | undefined {
  const found = onSide(profile, back, ownSide(face, beyondInside, offset), pieceSpan);
  if (!found.length) return undefined;
  const [a, b] = found[0];
  return Math.min(a + margin, (a + b) / 2);
}

// ------------------------------------------------ the solids of the void check

// A box along a unit direction: the square of half side `half` about `center` across it, from
// `from` to `to` along it; every face numbered `number`.
export function boxAlong(direction: Vec3, center: Vec3, from: number, to: number, half: number, number: number, kernel: Pick<SolidKernel, 'triangulate'>): Solid {
  const [x, y] = basisAcross(direction);
  const square: Vec2[] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const frame: Frame = { origin: center, x, y, normal: direction };
  return edgePrism(square, square.map(() => number), frame, [{ point: add3(center, mul3(direction, from)), normal: direction }, { point: add3(center, mul3(direction, to)), normal: direction }], [number, number], kernel);
}
// A prism of a polygon (counter-clockwise or not) in the plane across a unit axis through `origin`
// (its coordinates along the basis of `basisAcross`, or of `x` and `axis × x`), from `from` to `to`
// along the axis; every face numbered `number`.
export function polygonPrism(polygon: readonly Vec2[], origin: Vec3, axis: Vec3, from: number, to: number, number: number, kernel: Pick<SolidKernel, 'triangulate'>, x?: Vec3): Solid {
  const [e1, e2] = x ? [x, cross3(axis, x)] : basisAcross(axis);
  const area = polygon.reduce((sum, p, i) => sum + cross2(p, polygon[(i + 1) % polygon.length]), 0);
  const ccw = area >= 0 ? polygon : [...polygon].reverse();
  const frame: Frame = { origin, x: e1, y: e2, normal: axis };
  return edgePrism(ccw, ccw.map(() => number), frame, [{ point: add3(origin, mul3(axis, from)), normal: axis }, { point: add3(origin, mul3(axis, to)), normal: axis }], [number, number], kernel);
}
// The region beyond C by `offset` within a box about `middle` of half size `size`: inside a cylinder
// the prism of the inscribed polygon of `sides` sides and radius r − offset; outside it the box less
// the prism of the circumscribed polygon of radius r + offset; past a plane (its normal pointing
// beyond) the box beyond it by the offset. Its faces are numbered from `number` on (two numbers).
export function runOutRegion(face: RunOutFace, beyondInside: boolean, offset: number, sides: number, middle: Vec3, size: number, number: number, kernel: Pick<SolidKernel, 'triangulate' | 'boolean'>): Solid {
  if (face.kind === 'plane') {
    const h = dot3(sub3(face.origin, middle), face.normal) + offset;
    return boxAlong(face.normal, middle, h, Math.max(h, 0) + 2 * size, size, number, kernel);
  }
  const s0 = dot3(sub3(middle, face.point), face.axis);
  const radius = beyondInside ? face.radius - offset : (face.radius + offset) / Math.cos(Math.PI / sides);
  const disc = Array.from({ length: sides }, (_, i): Vec2 => [radius * Math.cos((TWO_PI * i) / sides), radius * Math.sin((TWO_PI * i) / sides)]);
  const prism = polygonPrism(disc, face.point, face.axis, s0 - 2 * size, s0 + 2 * size, number, kernel);
  if (beyondInside) return prism;
  const box = boxAlong(face.axis, add3(face.point, mul3(face.axis, s0)), -size, size, size, number + 1, kernel);
  return kernel.boolean('difference', box, prism);
}
