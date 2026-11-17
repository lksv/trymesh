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
