// Contract of package 5c (D60): a plane tilted about a line and the midplane of two planes.
// A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the
// real types of the engine and the shared types of the preparatory step and states what the
// package adds: two optional fields of the plane feature, a third kind of an axis, an issue code,
// an upgrade step, and the two frames as functions of the step.

import type { AxisRef, FeatureBase, Frame, Id, NumberSpec, Patch, Vec3 } from '../../../packages/engine/src/index';
import type { PlaneRefAfter, UpgradeStep } from '../00-prep/contract';

// ================================================================ the third kind of an axis

// An axis (`AxisRef`) gets the kind `sketchLine`: a line of a sketch, its own (construction or not)
// or projected (an edge of a body projected as a line; its ends are `<id>/a` and `<id>/b`). The
// axis goes through the solved end `a` towards the solved end `b`, in model coordinates by the
// frame of the sketch.
// - Every consumer of an axis takes it: a circular pattern turns about the line, a linear pattern
//   runs along it, a joint of the mechanism turns about it or slides along it (its result reports
//   the end `a` as the origin of the axis), the tilt of a plane turns about it, a query takes it
//   (the mass about an axis).
// - A command verifies the sketch and that `line` is a line of it (an entity of the kind `line`,
//   own or projected); a circle or a point is an invalid command.
// - In the recompute: a sketch or a line that is no longer there is `brokenReference`; a line
//   shorter than the length tolerance has no direction and is `invalidAxis`, with the line in
//   `refs`.
export type SketchLineAxis = { kind: 'sketchLine'; sketch: Id; line: Id };
export type AxisRefAfter = AxisRef | SketchLineAxis;

// ================================================================ the plane feature

// A plane of its own, built in this order:
// 1. `base`: a base plane, a plane feature or a planar face of a body (the whole plane it lies in).
// 2. `midplaneWith` (optional): the plane halfway between the base and this plane. For parallel
//    planes the plane in the middle; for planes at an angle the plane that bisects the angle,
//    through the line where they meet. Of the two bisecting planes, with n1 and n2 the normals of
//    the base and of the second plane: when n1 · n2 ≤ 0 (the normals look away from each other,
//    as the two faces of a slab or the two sides of a drafted rib) the one with the normal
//    n1 − n2, otherwise (they look the same way) the one with the normal n1 + n2. Its normal is
//    therefore on the side of the base's, and its axes are those of the base turned by the
//    smallest rotation onto it. Where the two normals pass through a right angle the choice
//    switches; two planes at a right angle have no middle that is meant.
// 3. `tilt` (optional): the plane through `axis`, turned by `angle` from the plane of steps 1 and
//    2 about the axis (radians, the right-hand rule about the direction of the axis: a base axis
//    points along its positive half, a sketch line from `a` to `b`, a sketch point along the
//    normal of its sketch). The axis must be parallel to that plane (within 1e-4 rad); it need not
//    lie in it. With the angle 0 the plane is parallel to the base and contains the axis. A point
//    of the base plane on the axis keeps its coordinates in a sketch on the tilted plane.
//    The numeric field is `tilt/angle`, from −π to π; `deg(30)` in an expression.
// 4. `offset`: moved along the normal of the plane of steps 1 to 3.
// A plane with neither optional field is the plane offset from its base, as before.
// - `updateFeature`: `{ midplaneWith: null }` and `{ tilt: null }` remove them; `{ tilt: { angle } }`
//   changes the angle of a tilt (the axis is a reference and is replaced whole), and on a plane
//   without a tilt it is an invalid command (a tilt is given whole). `setField` reaches
//   `tilt/angle` only on a plane that has a tilt.
// - Errors: `brokenReference` and `nonPlanarFace` with the base or the second plane in `refs`;
//   `brokenReference` with the sketch or the line of the axis; `invalidAxis` with the axis in
//   `refs` when its line has no length or it is not parallel to the plane (the detail gives the
//   angle).
// - A tilted plane makes a joint about an axis askew to the axes of the model easy to model; such
//   a joint is the known limit of the mechanism (each pair across it costs seconds in the kernel).
export interface PlaneFeatureC extends FeatureBase {
  type: 'plane';
  base: PlaneRefAfter;
  offset: number;
  midplaneWith?: PlaneRefAfter;
  tilt?: { axis: AxisRefAfter; angle: number };
}
// What `updateFeature` may change.
export type PlanePatchC = Patch<Pick<PlaneFeatureC, 'base' | 'offset' | 'midplaneWith' | 'tilt'>>;

export const TILT_ANGLE = { title: 'Tilt angle', unit: 'rad', min: { value: -Math.PI }, max: { value: Math.PI } } as const satisfies NumberSpec;
// The numeric fields of the plane, as the registry lists them (`FEATURE_TYPE_INFO.plane.fields`).
export const PLANE_FIELDS = [
  { path: 'offset', spec: { title: 'Offset', unit: 'mm' } },
  { path: 'tilt/angle', spec: TILT_ANGLE },
] as const;
// What `null` in a patch may remove although the plane does not have it.
export const PLANE_REMOVABLE = [['midplaneWith'], ['tilt']] as const;

declare module '../00-prep/contract' {
  interface FeatureTypes {
    plane: PlaneFeatureC;
  }
  interface FeaturePatches {
    plane: PlanePatchC;
  }
  // `invalidAxis`, an error: the line of a `sketchLine` axis is shorter than the length tolerance
  // (for every consumer of an axis), or the axis of a tilt is not parallel to the plane it tilts.
  interface IssueCodes {
    invalidAxis: true;
  }
}

// ================================================================ the frames, as the step builds them

// The line of an axis as `axis()` of recompute/services.ts resolves it: a point and a unit direction.
export interface AxisLine {
  point: Vec3;
  direction: Vec3;
}
// What the step reports when a part cannot be built: the code, the references and a detail.
export interface PlaneProblem {
  code: 'invalidAxis';
  refs: unknown[];
  detail: string;
}

// The midplane of two frames (step 2): the rule of the bisector above; the frame of `base` turned
// by the smallest rotation that takes its normal to the normal of the midplane, its origin carried
// along that normal into the midplane. Never fails.
export declare function midplaneFrame(base: Frame, second: Frame): Frame;

// The tilted frame (step 3): `frame` moved along its normal until it contains the point of the
// axis, then turned about the axis by `angle` (its origin about the point of the axis, its x, y and
// normal as directions). The direction of the axis is first made exactly parallel to the plane.
// Fails when the sine of the angle between the axis and the plane is above sin(1e-4).
export declare function tiltedFrame(frame: Frame, axis: AxisLine, angle: number): Frame | PlaneProblem;

// `axis()` of recompute/services.ts with the third kind: for a `sketchLine`, the end `a` and the
// unit direction towards `b`, or `invalidAxis` for a line shorter than the length tolerance.
export type AxisOutcome = AxisLine | { code: 'brokenReference' | 'invalidAxis'; refs: unknown[] };

// ================================================================ the upgrade step

// Converts nothing: a build without it would drop `midplaneWith` and `tilt` from a plane without
// a word (the validator of the plane rebuilds it from the fields it knows), so it has to refuse
// the document instead. The branch counts it in `SCHEMA_PENDING` until the merge.
export const MORE_PLANES_STEP: UpgradeStep = { name: '5c-more-planes', run: (o) => o };

// ================================================================ what the package does not add

// - No feature type, no face role, no command, no query, no section of the document.
// - No change of `PlaneRef`: a midplane or a tilted plane is a plane feature, referred to as
//   `{ kind: 'plane', feature }` by a sketch, a mirror, an extent `upTo`, a split and a query.
