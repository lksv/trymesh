// Contract of package 4a (D58): the revolve. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and the shared
// types of the preparatory step and states what the package adds: a feature type with its patch,
// a kind of `AxisRef` for every user of an axis, two kinds of surfaces with the circles they meet
// others in, an issue code, the tool build, and the line of the revolve in the fillet's table of
// profile sources. No face role is added: a revolve names its faces as an extrusion of the same
// profile does.

import type { AxisRef, FeatureBase, Frame, Id, Input, IssueCode, Patch, ProfileSource, SolidKernel, Surface, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { FieldSpec, NumberSpec } from '../../../packages/engine/src/catalog';
import type { FeatureTypeInfo } from '../../../packages/engine/src/features/module';
import type { EntityShape } from '../../../packages/engine/src/query/entity';
import type { BuiltTool, ResolvedProfile, State } from '../../../packages/engine/src/recompute/state';
import type { Region } from '../../../packages/engine/src/sketch';
// Internal to the engine, not exported from its index: the exact description of a face.
import type { FaceInfo } from '../../../packages/engine/src/solid';
import type { Circle3 } from '../../../packages/engine/src/surfaces';
import type { EvaluationAfter, StateAfter } from '../00-prep/contract';
import type { PatternFeatureD } from '../2e-pattern-mirror/contract';

// ================================================================ the axis: a line of a sketch

// A new kind of `AxisRef`, for every user of an axis at once (the revolve, the circular and the
// linear pattern, a joint of the mechanism, the argument kind `axis` of a query such as `mass`):
// the line of a sketch, an own line (construction or not) or a projected one (an edge of a body
// projected as a line). The axis runs through the point `a` of the line in the direction from `a`
// to `b` (for a projected line: from `<line>/a` to `<line>/b`), so a positive angle turns by the
// right-hand rule about that direction.
// - A command verifies the sketch and that the line is a line of it (`requireRef` with the kind
//   `entity` and `accepts: ['line']`), as it verifies the point of `sketchPoint`.
// - In the recompute (`axis(ref, state)` of recompute/services.ts) a sketch that did not evaluate
//   or a line that has no place in it is `brokenReference` with the sketch or the line in `refs`;
//   a line whose ends are not further apart than `LENGTH_TOLERANCE` is `invalidAxis` with the line
//   in `refs` (for a pattern and a joint as much as for a revolve). A projected line whose edge is
//   gone keeps its last valid place in the sketch, and the axis follows it.
// - The references of the axis are the sketch and the line (`axisRefs`), and the names a section
//   of the document reserves (`namedBySections` of the mechanism) are the sketch and the line.
// In the code it is a member of `AxisRef` in types.ts; the draft cannot change that type, so it
// writes the union with it as `AxisRefD`.
export type SketchLineAxis = { kind: 'sketchLine'; sketch: Id; line: Id };
export type AxisRefD = AxisRef | SketchLineAxis;

// The resolution of an axis after this package: a point and a direction (not of unit length for
// a line: `b − a`), or the code of a problem with what it refers to and a detail.
export declare function axis(ref: AxisRefD, state: State): { point: Vec3; direction: Vec3 } | { code: IssueCode | 'invalidAxis'; refs: unknown[]; detail?: string };

// ================================================================ the feature

// The profile of a revolve: regions of a sketch (with their optional offset) or a wall along
// curves of a sketch. Not a generated profile: a gear turned about a line in its own plane is no
// part, and its sides are general curves.
export type RevolveProfile = Exclude<ProfileSource, { type: 'generated' }>;

// How far the profile turns.
// - `full`: a whole turn. The body has no caps.
// - `angle`: from `start` (field `extent/start`, radians, any value) by `angle` (field
//   `extent/angle`, radians, not zero, strictly between −2π and 2π). Both turn by the right-hand
//   rule about the direction of the axis; a negative angle turns the other way. The profile of
//   the sketch is where the turn is at the angle 0, so with a `start` of 0 the start cap lies in
//   the sketch plane. A turn symmetric about the sketch plane is `start: '-a / 2'`, `angle: 'a'`.
// A whole turn is the variant `full`, not an angle of 2π: the range of the field ends before it.
export type RevolveExtent = { type: 'full' } | { type: 'angle'; start: number; angle: number };

// The profile turned about an axis that lies in the plane of the profile's sketch.
// - `axis`: an `AxisRef`. It has to lie in the plane of the sketch: its direction within
//   `ANGLE_TOLERANCE` of the plane and a point of it within `LENGTH_TOLERANCE`; the line used is
//   its projection into the plane. A base axis serves a sketch on a base plane that holds it (Z
//   for XZ and YZ); a line of a sketch serves any plane, best a construction line of the
//   profile's own sketch, or the line of the profile that lies on the axis (the diameter that
//   closes a half circle). A non-construction line drawn along an edge of the profile overlaps it
//   and makes the sketch profile invalid.
// - The profile lies on one side of the axis; it may touch the axis in a curve that lies along it
//   (that curve makes no face) or in a point.
// - `operation`, `targets`: as for an extrusion: `new` has no target and makes the body with the
//   ID of the feature, `add` exactly one target, `cut` one or more, none twice.
// - The feature keeps a tool recipe for `add` and `cut`, so a pattern repeats a revolve; a copy of
//   a mirror is turned over by `applyTool` (D53), as every tool.
// - Errors: `brokenReference` (the sketch, a curve, the axis or a target is missing),
//   `noProfile` and `invalidProfile` (from the profile, as for an extrusion; also a tool that
//   would have more than `MAX_REVOLVE_TRIANGLES` triangles), `invalidAxis` (see `IssueCodes`),
//   `emptyResult` and `kernelFailure` as for an extrusion; the warning `noEffect` names the targets
//   the tool missed.
export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  profile: RevolveProfile;
  axis: AxisRefD;
  extent: RevolveExtent;
  operation: 'new' | 'add' | 'cut';
  targets?: Id[];
}
// What `updateFeature` may change, by the rules of an extrusion: a profile or an extent of the
// same `type` merges by field, another `type` replaces it and has to be complete; the axis is
// a reference and is replaced whole; a change to `new` drops the targets unless the patch gives
// them; `{ profile: { offset: null } }` removes the offset. `null` may remove the offset and the
// targets, nothing of the extent (a revolve has no taper and no gap).
export type RevolvePatch = Patch<Pick<RevolveFeature, 'profile' | 'axis' | 'extent' | 'operation' | 'targets'>>;

// The numeric fields of the extent.
export const REVOLVE_START = { title: 'Start angle', unit: 'rad' } as const satisfies NumberSpec;
export const REVOLVE_ANGLE = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI, open: true }, max: { value: 2 * Math.PI, open: true }, nonZero: true } as const satisfies NumberSpec;

// What the result of the feature publishes in `facts`, for the feature itself (not for its copies).
export const REVOLVE_FACTS = {
  axisPoint: 'a point of the axis the profile turned about, in model coordinates: the point of the axis reference projected into the plane of the sketch',
  axisDirection: 'the direction of that axis, a unit vector in model coordinates; a positive angle turns by the right-hand rule about it',
  steps: 'the number of equal steps the turn is divided into: the tool is a polygon of that many sides about the axis',
} as const;

// No tool of more triangles than this is built: `invalidProfile`, with a message that gives the
// count and says to raise the chord tolerance of the document or to divide the part. Measured: a
// tool of 1.7 million triangles took the kernel 27 s to cut (design.md, "Measured").
export const MAX_REVOLVE_TRIANGLES = 1_000_000;

declare module '../00-prep/contract' {
  interface FeatureTypes {
    revolve: RevolveFeature;
  }
  interface FeaturePatches {
    revolve: RevolvePatch;
  }
  // `invalidAxis`, an error: the axis cannot be used.
  // - The line of an axis of the kind `sketchLine` has no length (every user of an axis: a revolve,
  //   a pattern, a joint; `refs`: the line).
  // - A revolve: the axis does not lie in the plane of the profile's sketch (`refs`: the axis; the
  //   detail gives the angle to the plane or the distance from it).
  // - A revolve: the profile lies on both sides of the axis (`refs`: the axis, then a curve on
  //   each side; the detail names them and says by how much each crosses).
  interface IssueCodes {
    invalidAxis: true;
  }
  // The pattern of 2e with the new kind of axis. The pattern is owned by 2e's contract
  // (`PatternFeatureD`, with the `AxisRef` of today), which this one cannot restate; the command
  // with an axis of the new kind is merged here under a name of its own so that calls.ts can send it.
  interface Commands {
    addPatternAboutLine: { type: 'addFeature'; feature: Input<PatternAboutLine>; index?: number };
  }
}
// A circular pattern about a line of a sketch, or a linear one along it.
export type PatternAboutLine = Omit<PatternFeatureD, 'transform'> & {
  transform: { type: 'circular'; axis: AxisRefD; count: number; span: { type: 'full' } } | { type: 'linear'; direction: AxisRefD; count: number; span: { type: 'spacing'; spacing: number } };
};

// What the registry says of the type (`info` of its module); the summary is what `describe_api`
// prints. The fields are the offset and the thickness of the profile (not the parameters of
// a generator) and the two of the extent.
export declare const PROFILE_FIELDS_OF_REVOLVE: FieldSpec[]; // `PROFILE_FIELD_SPECS` without `profile/params/*`
export const REVOLVE_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Revolve',
  summary:
    'Turns a profile of a sketch (regions, optionally with an offset, or a wall along curves) about an axis that lies in the plane of the sketch: a new body, an addition to a body or a cut from bodies. ' +
    'The axis is an AxisRef: a base axis in the plane of the sketch (Z for a sketch on XZ or YZ), or a line of a sketch (`sketchLine`), best a construction line. The profile lies on one side of the axis and may touch it. ' +
    'The extent is a whole turn (`full`) or `angle` from `start` (radians, by the right-hand rule about the axis). ' +
    'The faces are named as for an extrusion of the same profile: `side` per curve (a line gives a plane across the axis, a cylinder or a cone; an arc a sphere when its centre is on the axis, a torus otherwise), `startCap` and `endCap` for a partial turn; a curve on the axis makes no face.',
  fields: [
    ...PROFILE_FIELDS_OF_REVOLVE,
    { path: 'extent/start', spec: REVOLVE_START, when: { path: 'extent/type', equals: 'angle' } },
    { path: 'extent/angle', spec: REVOLVE_ANGLE, when: { path: 'extent/type', equals: 'angle' } },
  ],
  bodies: 'self',
};
// What the module answers where the registry asks every type (features/module.ts): `createsBody`
// for its own ID with the operation `new`; `namesFaces` true; `producesTool` for `add` and
// `cut`; no `generator` (a revolve takes no generated profile); no `bodySource`. `refs`: the
// profile (`profileRefs`), the axis (`axisRefs` at `axis`) and the targets.

// The fillet of a sketch corner (D52) patches the regions and walls of the features that read
// the sketch, by a table typed over the feature types (`PROFILE_SOURCES` in sketch-tools.ts). The
// line of the revolve:
export const PROFILE_SOURCE_OF_REVOLVE = (feature: RevolveFeature): ProfileSource => feature.profile;

// ================================================================ surfaces

// Two kinds of surfaces, published in `Surface` (types.ts) and kept in `FaceInfo` (solid.ts):
// - `sphere`: the side of an arc whose centre lies on the axis (within `LENGTH_TOLERANCE`), its
//   centre that point of the axis.
// - `torus`: the side of an arc whose centre lies off the axis: `center` is the point of the axis
//   nearest to the centre of the arc, `axis` the direction of the axis (no sign), `minorRadius`
//   the radius of the arc, `majorRadius` the distance of the centre of the arc from the axis,
//   signed: positive when the centre lies on the side of the axis the face lies on, negative when
//   it lies across the axis (an ogive, a lemon: a part of a spindle torus). In every half plane
//   through the axis that the face lies in, the centre of the tube is the point `majorRadius` from
//   the axis towards that half plane. A ring torus is positive; the sign is what tells the two
//   parts of a spindle torus apart, which meet a plane in different circles.
// Neither can carry a sketch (`nonPlanarFace`). A general surface stays what no feature makes.
export type SphereSurface = { kind: 'sphere'; center: Vec3; radius: number };
export type TorusSurface = { kind: 'torus'; center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number };
export type SurfaceD = Surface | SphereSurface | TorusSurface;
export type FaceInfoD = FaceInfo | { planar: false; surface: 'sphere'; center: Vec3; radius: number } | { planar: false; surface: 'torus'; center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number };
// The evaluation and the state with the surfaces of this package, for calls.ts.
export type EvaluationD = Omit<EvaluationAfter, 'faceSurfaces'> & { faceSurfaces: SurfaceD[] };
export type StateD = Omit<StateAfter, 'evaluation'> & { evaluation: EvaluationD };

// The circles two surfaces meet in (surfaces.ts), exact, computed from the two surfaces alone. The
// pairs of today keep their answers (measured on 20 000 random pairs: the same circle, or none,
// for every one). New:
// - a sphere and any plane: one circle; two spheres: one circle about the line of their centres;
// - surfaces about one axis (a plane across it, a cylinder, a cone on the half its axis points
//   along, a sphere whose centre is on it, a torus by its signed major radius): the meeting points
//   of their curves in a half plane through the axis (a line, a ray, a circle), off the axis, up
//   to two circles. Touching is tested on the distance, both ways: a line whose distance from the
//   centre of a circle, or two circles whose distance from each other, differs from the radius,
//   or from the sum or the difference of the radii, by at most `LENGTH_TOLERANCE` meet in the one
//   point of touching (an arc tangent to its neighbour, as a fillet of a sketch makes it, whether
//   the solver left the two a hair apart or a hair across);
// - a torus and a plane that holds its axis: the two circles of the tube in that plane.
// Two faces of one surface, and surfaces that meet in no circle, give none.
export declare function circlesBetween(a: SurfaceD, b: SurfaceD): Circle3[];
// The circle of an edge: the only one of `circlesBetween`, or, of two, the one every point of the
// edge (`points`: three numbers a point, the segments of the edge) lies nearer to than half its
// distance to the other; undefined when there is none, when a point does not (the edge is two
// circles, or two circles too close for the polygons of the mesh to tell apart), or when there
// are two and no points. It does not depend on how the edge is divided or cut short. `edgeKind` and `projectEdge` (solid.ts), the
// description of a body and the shape of an entity (query/body.ts, query/entity.ts) and the
// circles of a section (query/section.ts) all pass the points they have; the kind of an edge is
// therefore decided after its segments are collected.
export declare function circleBetween(a: SurfaceD, b: SurfaceD, points?: ArrayLike<number>): Circle3 | undefined;

// What an entity of a query is (query/entity.ts) gets the two shapes. `convex`: the material is
// on the side of the centre (a ball) or of the centre of the tube (a ring; taken by the signed
// major radius); false for a ball socket and a groove. Measured from a sphere is from its centre;
// from a torus from its axis, as from a cylinder.
export type EntityShapeD = EntityShape | { is: 'sphere'; center: Vec3; radius: number; convex: boolean } | { is: 'torus'; center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number; convex: boolean };

// A query whose argument is an axis (the kind `axis`, `mass` with `about`): `checkArgs` checks the
// sketch and the line of a `sketchLine` before `run`, as it checks the point of a `sketchPoint`;
// the context passes a line without length on as `invalidAxis` instead of `brokenReference`.
export interface RefProblemD {
  problem: 'brokenReference' | 'nonPlanarFace' | 'invalidAxis';
}

// ================================================================ the tool

// The profile prepared for the turn, once per recompute step (recompute/tool-revolve.ts), in the
// coordinates of the sketch.
// - `regions`: the exact outline of the profile (`ResolvedProfile.outline()`) divided again for
//   half the chord tolerance (`outlineRegions`), so that with the turn divided for the other half
//   the mesh is within the chord tolerance of the exact body.
// - `axis`: the axis projected into the plane of the sketch: a point, a unit direction, and the
//   side of it the profile lies on (+1 on the left of the direction, −1 on the right).
// - `steps`: the turn is divided into that many equal steps, by the rule of an arc (`segments` of
//   sketch.ts) at the largest distance of a vertex of `regions` from the axis, for half the chord
//   tolerance (at most 4096, where the tolerance is no longer kept, as for an arc).
// - `triangles`: how many the tool will have; above `MAX_REVOLVE_TRIANGLES` the setup refuses.
export interface RevolveAxis {
  point: Vec2;
  direction: Vec2;
  side: 1 | -1;
}
export interface RevolveSetup {
  regions: Region[];
  axis: RevolveAxis;
  steps: number;
  triangles: number;
}
export type RevolveProblem = { code: 'invalidAxis' | 'invalidProfile'; refs: unknown[]; message: string };
export declare function revolveSetup(profile: ResolvedProfile, line: { point: Vec3; direction: Vec3 }, ref: AxisRefD, extent: RevolveExtent, chordTolerance: number): RevolveSetup | RevolveProblem;

// The closed mesh of the profile turned about the axis, placed by `frame` (the frame of the sketch,
// or of a copy of a pattern). Every vertex is placed through `toWorld(frame, u, v, w)` from
// coordinates of the sketch, so in the left-handed frame of a mirrored copy the mesh is the
// mirror image facing inwards, and `applyTool` turns it over (D53); the build does not correct it.
// - The plane of a side from a line across the axis: the origin at the start `a` of the line turned
//   to the start of the turn, Y the normal of the half plane of the profile there in the direction
//   the angle grows (`cos(start)·side·ŵ − sin(start)·e`, not depending on `a`); the caps: the
//   frame of the sketch turned to the start and to the end.
// - A vertex of the profile on the axis is one vertex of the mesh; every other one is placed at
//   `steps` angles of a whole turn, or at `steps + 1` of a partial one.
// - Every edge of the polylines of the profile (each with the key of its curve) between two
//   neighbouring angles gives two triangles, one where an end lies on the axis, none where both do.
// - A partial turn has the two caps: the regions triangulated by the kernel once (the cache
//   `triangulation`, shared by the builds of copies), placed at the start and at the end.
// - The winding: the triangles of a side are wound `(p_j, q_j, q_j+1)`, `(p_j, q_j+1, p_j+1)` for an
//   edge from `p` to `q` and the angles `j`, `j+1`, turned over when the profile lies on the right
//   of the axis or the angle is negative, not when both; the start cap keeps the winding of the
//   triangulation when the profile lies on the right of the axis for a positive angle (or on the
//   left for a negative one), the end cap in the other case.
// - The faces: `startCap`, `endCap` (a partial turn only), then the sides in the order of their
//   keys, named by `sideOf` of the profile; a key whose edges all lie on the axis has no face.
export declare function buildRevolve(feature: Id, setup: RevolveSetup, extent: RevolveExtent, frame: Frame, sideOf: ResolvedProfile['sideOf'], firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>): BuiltTool;
