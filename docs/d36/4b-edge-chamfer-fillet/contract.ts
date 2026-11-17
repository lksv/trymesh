// Contract of package 4b (D63): the chamfer and the fillet of edges. A draft for review, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine, the
// shared types of the preparatory step and the revolve of 4a, and states what the package adds: two
// feature types with their patches and fields, two face roles, two issue codes, the constants the
// spike fixed, and the parts of the recompute the step is made of. No query, no command, no section
// of the document, no member of the kernel port, no schema step.

import type { FeatureBase, Frame, Id, Patch, Solid, SolidKernel, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { NumberSpec } from '../../../packages/engine/src/catalog';
import type { FeatureTypeInfo } from '../../../packages/engine/src/features/module';
import type { ResolvedProfile, Step, StepContext } from '../../../packages/engine/src/recompute/state';
import type { Circle3 } from '../../../packages/engine/src/surfaces';
import type { EdgeNameAfter } from '../00-prep/contract';
import { FACE_ROLES } from '../00-prep/contract';
import type { FaceInfoD, RevolveExtent, RevolveSetup } from '../4a-revolve/contract';

// ================================================================ the features

// What both types share.
// - `body`: the body whose edges are chamfered or filleted. It keeps its ID; a feature that names it
//   later reads it with the new faces.
// - `edges`: at least one edge of that body, each named by its two faces as the query `body` lists
//   them (the canonical order is made by the validator), none twice. Each has to be:
//   - straight between two planar faces (kind `line`), the faces at more than 0.01 rad from flat
//     and from folded; or
//   - circular between two faces about one axis whose profile in a half plane through the axis is
//     a straight line: a plane across the axis, a cylinder, a cone (kind `circle`). Not a circle
//     with a sphere or a torus (the rim of a dome).
//   An edge ends at another edge of the feature that shares a face with it: smoothly (both end in
//   the plane across them), at the same angle to the shared face (both end in their mitre, the
//   plane through the vertex halving the angle of the two in that face), or, both convex at
//   a convex corner of that face and both straight, each in the plane of the other's other face;
//   else the feature is refused (an arc at an angle to another edge, the top loop of a D-shaped
//   boss). Or at one planar face, whose plane
//   the chamfer or fillet ends in (an arc: a plane through its axis), or runs on smoothly into the
//   next edge of a face (a line of an outline with round corners into the arc of the corner; also
//   across a seam where both faces of the edge continue into flush faces); that next edge has to be
//   in the same feature. A convex and a concave edge of one feature must not meet at a vertex. The
//   pieces of an edge (an earlier cut through it) need one blend.
// - A convex edge (the material inside the angle of the faces) is cut, a concave one gets material
//   added; one feature may hold both.
// - Faces: one new face per edge, `{ feature, role: 'chamfer' | 'fillet', edge: <the place of the
//   edge in `edges`, from 0> }`, exact: a plane (a chamfer of a straight edge), a cylinder (a fillet
//   of one), a cone, a plane across the axis or a cylinder (a chamfer of a circular edge), a torus
//   (a fillet of one; a sphere where the centre of its arc lies on the axis). The two faces of the
//   edge keep their names and get narrower; at an end where
//   the face it ends at lies behind the chamfer (the riser of a step) that face grows by what is
//   left in its plane, under its own name.
// - Where three fillets meet at a vertex the corner is a crease (0.225 r proud of a rolling ball at
//   the corner of a box); three chamfers meet exactly.
// - The feature creates no body and leaves no tool a pattern could repeat.
// - Errors: `brokenReference` (the body, or an edge it does not have), `unsupportedEdge` and
//   `blendDoesNotFit` (see `IssueCodes`), `invalidExpression` (the size), `kernelFailure`; with
//   package 3b, `importedTarget`. A feature in error changes nothing.
interface BlendBase extends FeatureBase {
  body: Id;
  edges: EdgeNameAfter[];
}
// A chamfer by one distance along both faces: the field `distance`, mm, above 0.
export interface ChamferFeature extends BlendBase {
  type: 'chamfer';
  distance: number;
}
// A fillet of one radius: the field `radius`, mm, above 0. The fillet meets each face at the
// setback `radius / tan(β / 2)` from the edge, β the angle between the faces on the side of the
// fillet (`radius` for a right angle).
export interface FilletFeature extends BlendBase {
  type: 'fillet';
  radius: number;
}
// What `updateFeature` may change. `edges` is a list and is replaced whole; nothing is removable.
export type ChamferPatch = Patch<Pick<ChamferFeature, 'body' | 'edges' | 'distance'>>;
export type FilletPatch = Patch<Pick<FilletFeature, 'body' | 'edges' | 'radius'>>;

export const CHAMFER_DISTANCE = { title: 'Distance', unit: 'mm', min: { value: 0, open: true } } as const satisfies NumberSpec;
export const FILLET_RADIUS = { title: 'Radius', unit: 'mm', min: { value: 0, open: true } } as const satisfies NumberSpec;

declare module '../00-prep/contract' {
  interface FeatureTypes {
    chamfer: ChamferFeature;
    fillet: FilletFeature;
  }
  interface FeaturePatches {
    chamfer: ChamferPatch;
    fillet: FilletPatch;
  }
  // The new face of an edge: the place of the edge in the list of the feature, from 0.
  interface FaceRoles {
    chamfer: { edge: number };
    fillet: { edge: number };
  }
  // `unsupportedEdge`, an error: an edge cannot be chamfered or filleted. `refs`: the edge, and the
  // second edge where the reason is a pair. The detail says which:
  // - its kind, or the surfaces of its faces (a sphere, a torus, a cylinder along a plane);
  // - its faces meet at less than 0.01 rad from flat or from folded;
  // - the side of a face along the edge is not clear (its triangles along it disagree);
  // - the pieces of the edge need different chamfers (another side of a face);
  // - it meets another edge of the feature at a vertex in a way the feature cannot join (an arc at
  //   an angle, different angles at a reflex corner), or their two tools leave a step there;
  // - an end has no face besides its own, two or more that are not a seam, a round face that does not continue a face
  //   of the edge, (a straight edge) a plane within 0.01 rad of the edge, (an arc) a plane that
  //   does not hold its axis;
  // - the edge runs on smoothly into the second edge in `refs`, which is not in the feature;
  // - a convex and a concave edge of the feature (both in `refs`) meet at a vertex.
  // `blendDoesNotFit`, an error: the chamfer or fillet does not fit. `refs`: the edge and the face
  // concerned. The detail says which:
  // - a face of the edge would vanish (a radius larger than the face is wide);
  // - the new face of the edge would vanish;
  // - the tool reached material it must not touch: next to a convex edge, within the size outside
  //   its faces (a slot narrower than the size, a piece of the body), or next to a concave edge
  //   a hollow just inside them (the foot of a boss that reaches the edge of the plate), seen in
  //   a face of the tool left in the result or in more volume taken than the tools' wedges hold;
  // - it reaches the axis of a circular edge;
  // - the ends of a straight piece meet within it;
  // - the tools would have more triangles than 4a's MAX_REVOLVE_TRIANGLES.
  interface IssueCodes {
    unsupportedEdge: true;
    blendDoesNotFit: true;
  }
}

export const BLEND_ROLES: Pick<typeof FACE_ROLES, 'chamfer' | 'fillet'> = {
  chamfer: { title: 'chamfer of an edge', parts: { edge: { title: 'the place of the edge in the list of the feature, from 0', kind: 'integer' } } },
  fillet: { title: 'fillet of an edge', parts: { edge: { title: 'the place of the edge in the list of the feature, from 0', kind: 'integer' } } },
};

const SHARED_SUMMARY =
  'The edges are named by their two faces, as the query `body` lists them: a straight edge between two planes, or a circular edge between a plane, a cylinder and a cone about one axis. A convex edge is cut, a concave one gets material added. ' +
  'An edge that runs on smoothly into another (a line of an outline with round corners) needs that edge in the same feature; a convex and a concave edge that meet at a vertex go into two features. ' +
  'Each edge gets one new face `{ feature, role, edge: <its place in edges, from 0> }`; the faces of the edge keep their names. The facts `setback/<i>` (how far from edge i the new face meets its faces) and `cut/<i>` (true where material was cut).';
export const CHAMFER_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Chamfer',
  summary: `Chamfers edges of one body by one distance along both faces of each edge. ${SHARED_SUMMARY} The face of a straight edge is a plane a sketch can stand on; of a circular edge a cone, or a plane across its axis or a cylinder.`,
  fields: [{ path: 'distance', spec: CHAMFER_DISTANCE }],
  bodies: 'none',
};
export const FILLET_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Fillet',
  summary: `Rounds edges of one body by one radius. ${SHARED_SUMMARY} The face of a straight edge is a cylinder, of a circular edge a torus, or a sphere where the centre of its arc lies on the axis. Where three fillets meet at a corner the corner is a crease, not a ball.`,
  fields: [{ path: 'radius', spec: FILLET_RADIUS }],
  bodies: 'none',
};
// What the two modules answer where the registry asks every type (features/module.ts): `createsBody`
// false, `namesFaces` true, `producesTool` false, no `bodySource`, no `generator`. `refs`: the body
// at `body` and the faces of every edge at `edges/<i>/a` and `edges/<i>/b` (`faceRefs`).

// What the result publishes in `facts`, `<i>` the place of the edge in the list.
export const BLEND_FACTS = {
  'setback/<i>': 'mm: how far from edge i the chamfer or fillet meets each of the two faces of the edge, along them (the distance of a chamfer; radius / tan(β / 2) of a fillet, β the angle of the faces on its side)',
  'cut/<i>': 'true where material was cut away (a convex edge), false where it was added (a concave edge)',
} as const;

// ================================================================ what the spike fixed

// An end of the blend that lies on a round face (a cylinder, a cone; a sphere or a torus at the end
// of an arc) is moved off it, away from the corner, until it is this many chord tolerances from it:
// a chamfer's end along the chamfer's own line (its surface stays exact), a fillet's along the
// normal of the face. An end on a plane stays on it. The polygon of a round face lies up to the chord tolerance inside its surface; a tool
// whose end stands on the exact surface grazes it (measured: 7.5 % of 3 600 random edges refused,
// ledges in the rest; with the lift along the normal none of 7 192, and along the chamfer's line
// none of 3 592 either). Along the line the end moves 1.5 × tol / sin((π − β)/2).
export const BLEND_LIFT = 1.5;
// The tool reaches past both faces: past a convex edge (outside the body) by max(size,
// BLEND_OVERSHOOT × chord tolerance), the size being the distance or the radius (measured: smaller
// fixed overshoots leave caps and strips of the tool); past a concave edge (into the body) by
// BLEND_OVERSHOOT × chord tolerance only (the size pierced a wall thinner than it behind the corner).
export const BLEND_OVERSHOOT = 4;
// The smallest angle, in radians, between the faces of an edge and flat or folded, and between
// a straight edge and the plane of a face it ends at.
export const BLEND_MIN_ANGLE = 0.01;
// What the overshoot faces of the tool of an edge may leave in the result, in mm² per mm of the
// length of the edge; a sliver up to that is given to the new face of the edge, more is
// `blendDoesNotFit`. Measured: 0 in every case that fits.
// A cap left where two tools meet (a smooth end, a mitre, the corner of two edges) goes to the blend
// of its edge up to BLEND_LIFT × chord tolerance × (size + overshoot) mm², the step the lift leaves
// between a lifted tool and one that is not; more is `unsupportedEdge` with both edges.
export const BLEND_SLIVER = 1e-4;
// The volume check: what the feature cut or added may exceed what the parts of its tools inside
// their wedges hold together (the profile closed along the two faces, the parts united, the cut
// and the added material each) by at most BLEND_VOLUME × the chord
// tolerance × the area of the strips the blends eat (twice the setback times the length of each
// piece), plus 10⁻³ mm³; more is `blendDoesNotFit` (material swallowed by the overshoot). Measured:
// at most 0.28 of the bound on 3 592 random single edges, twice; equal to the last digit with mitres.
export const BLEND_VOLUME = 0.5;

// ================================================================ the recompute

export type BlendKind = 'chamfer' | 'fillet';

// The step of both types (recompute/edge-blend.ts), in this order (design.md, "Recompute"): the
// body, the edges, their kind, their pieces, the corner of each piece, its ends, the mixed
// vertices, the profile, the tools, the booleans (the cut tools united and subtracted, then the
// added ones united and joined), the checks per piece on the temporary face numbers, the
// renumbering, the result with one face per edge and the facts.
export declare function blendStep(kind: BlendKind, feature: Id, body: Id, edges: EdgeNameAfter[], size: number, context: StepContext): Step;

// The corner of a piece of an edge, in the plane across a straight edge or in the half plane
// through the axis of a circular one.
// - `beta`: the angle between the two faces on the side the tool goes, (BLEND_MIN_ANGLE,
//   π − BLEND_MIN_ANGLE). The directions along the faces are exact (from `FaceInfo`); their signs
//   come from the triangles of each face along the segments of the piece, whose insides lie on the
//   left of their sides i → j, n × (pⱼ − pᵢ), summed weighted by area; an unclear sum refuses.
// - `convex`: the material lies inside the angle (the direction along `b` points to the inside of
//   `a`): cut; otherwise added.
// - `round`: whether face `a` and face `b` are round (the lift).
export interface BlendCorner {
  beta: number;
  convex: boolean;
  round: [boolean, boolean];
}

// The profile of the tool, counter-clockwise, in the coordinates of the corner: the corner at the
// origin, face `a` along +x, face `b` along (cos β, sin β).
// - `points`, `keys`: the side from point k to point k + 1 is part of the face `keys[k]`: the blend
//   (the chamfer's line, or the fillet's arc divided for half the chord tolerance), then the
//   overshoot past `b`, round the corner, and back past `a`.
// - `blend`: the exact line or circle of the blend, before the lift, from which its surface is
//   computed.
// - `setback`: how far along each face from the corner the blend meets it.
// The ends of the blend on a round face are lifted (BLEND_LIFT); the overshoot is
// max(size, BLEND_OVERSHOOT × chordTolerance) past a convex edge and BLEND_OVERSHOOT ×
// chordTolerance past a concave one.
export type BlendSide = 'blend' | 'pastB' | 'cornerB' | 'cornerA' | 'pastA';
export interface BlendProfile {
  points: Vec2[];
  keys: BlendSide[];
  blend: { type: 'line'; a: Vec2; b: Vec2 } | { type: 'round'; center: Vec2; radius: number };
  setback: number;
}
export declare function blendProfile(kind: BlendKind, size: number, corner: BlendCorner, chordTolerance: number): BlendProfile;

// Where the tool of a piece of a straight edge ends: the mitre with another edge of the feature at
// the same angle, the plane of the other edge's face at a convex corner, the plane of the face at
// the end, or the plane across the edge at a smooth end or a seam.
export interface EndPlane {
  point: Vec3;
  normal: Vec3;
}
// A face of a tool of a piece, by its temporary number (`firstFaceId` + its index): the blend (with
// its exact surface), an overshoot face, or the cap at one of the two ends of the piece.
export type BlendToolFace = { part: 'blend'; info: FaceInfoD } | { part: 'overshoot'; side: Exclude<BlendSide, 'blend'> } | { part: 'end'; end: 0 | 1 };
export interface BlendTool {
  solid: Solid;
  faces: BlendToolFace[];
}

// The tool of a piece of a straight edge (recompute/tool-edge.ts): the profile placed in `frame`
// (its origin a point of the edge, X along face `a`, Y across towards face `b`, the normal along
// the edge, X × Y), every vertex carried along the edge to the plane of each end; the two ends
// triangulated by the kernel, two triangles per side of the profile. Closed, facing outwards in
// a right-handed frame. Each end plane crosses the edge at more than BLEND_MIN_ANGLE; where the two
// would cross within the profile the caller has refused it (`blendDoesNotFit`).
export declare function edgePrism(profile: BlendProfile, frame: Frame, ends: [EndPlane, EndPlane], firstFaceId: number, kernel: Pick<SolidKernel, 'triangulate'>): BlendTool;

// The tool of a piece of a circular edge is 4a's `buildRevolve` with this setup: the profile, and its
// exact blend, carried from the coordinates of the corner into (ρ, z) by `place` (the edge's point
// in (ρ, z), the unit direction of face `a` there, and the unit direction across it towards face
// `b`; where those two are a left-handed pair in (ρ, z) the profile is mirrored, so its n points
// are reversed, points'[i] = points[n − 1 − i], and its keys with them, keys'[i] =
// keys[(n − 2 − i) mod n], to keep it counter-clockwise, as a `Region` must be), as the one
// region of a `RevolveSetup` in a frame whose origin is the centre of the circle,
// X the radial direction at the start of the piece (for a whole circle the model's X projected
// across the axis, its Y where the axis is within 0.1 rad of X) and Y the axis, turned by a whole
// turn or by the arc of the piece. 4a's rules give the blend its surface: a cone, a plane across
// the axis or a cylinder for a chamfer, a torus with a signed major radius or a sphere for
// a fillet. `sideOf` gives the blend its exact
// shape (the line of the chamfer, the circle of the fillet), so that 4a computes its surface;
// the faces of the result are those of 4a's build: the caps of a partial turn, then the sides in
// the order of their keys. An overshoot towards the axis is shortened to stay at half the distance
// of the blend from it; a blend that reaches the axis has been refused (`blendDoesNotFit`).
export interface CornerPlace {
  point: Vec2;
  alongA: Vec2;
  acrossTowardsB: Vec2;
}
export interface BlendRevolve {
  setup: RevolveSetup;
  extent: RevolveExtent;
  frame: Frame;
  sideOf: ResolvedProfile['sideOf'];
}
export declare function blendRevolveSetup(profile: BlendProfile, place: CornerPlace, circle: Circle3, piece: { start: Vec3; angle?: number }, chordTolerance: number): BlendRevolve;

// The unit normal of a surface at a point of it (solid.ts), without a sign: for a smooth end (a face
// that continues a face of the edge has the same normal at the end point).
export declare function normalAt(info: FaceInfoD, point: Vec3): Vec3;
