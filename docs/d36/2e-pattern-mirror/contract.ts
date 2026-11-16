// Contract of package 2e (D53): a linear pattern and a mirror, two more kinds of the transform of
// the pattern feature. A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// It imports the real types of the engine and states only what the package adds or changes: two
// variants of `PatternTransform`, their numeric fields, a reflection among the transforms, and one
// rule of `applyTool`. No feature type, no command, no query, no face role, no issue code and no
// upgrade step.

import type { AxisRef, FieldSpec, NumberSpec, Patch, PatternFeature, PatternTransform, RigidTransform, Vec3 } from '../../../packages/engine/src/index';
import type { PlaneRefAfter } from '../00-prep/contract';

// ================================================================ the transform

// The kind of today, unchanged: copies turned around an axis.
export type CircularTransform = PatternTransform;

// `linear`: copies shifted along a direction.
// - `direction`: an axis as a circular pattern has one (`AxisRef`: a base axis of the model, or the
//   normal of a sketch plane), of which only the direction is used; where the axis passes does not
//   matter, so for the normal of a sketch any point of it does (`origin`). A base axis points along
//   its positive half; a sketch gives the normal of its plane, which for a sketch on a face points
//   out of the body. Every later kind of `AxisRef` (the axis of a bore, a line) is a direction here
//   without a change of this package.
// - `count` (numeric field `transform/count`, the field of the circular pattern): an integer from 1
//   to 200 that includes the original; 1 is the original alone.
// - `span`, one of two:
//   - `spacing` (field `transform/span/spacing`, millimetres, not zero): the shift from one copy to
//     the next. Copy `k` is shifted by `k · spacing`, so a larger count leaves every copy where it
//     was and adds new ones at the far end. A negative spacing runs against the direction.
//   - `length` (field `transform/span/length`, millimetres, not zero): the distance between the
//     original and the last copy, so the step is `length / (count − 1)`, as the span `angle` of
//     a circular pattern is the angle between the first and the last copy. With a count of 1 there
//     is no copy and the length is not used.
// - The variant lists its fields; any other is an invalid command (`axis` belongs to the circular
//   pattern, `plane` to the mirror).
export interface LinearTransform {
  type: 'linear';
  direction: AxisRef;
  count: number;
  span: { type: 'spacing'; spacing: number } | { type: 'length'; length: number };
}

// `mirror`: one copy, the mirror image of the source in a plane.
// - `plane`: a base plane, a plane feature or a planar face of a body, referred to as a sketch
//   refers to its plane (`PlaneRef`; validated by `planeRef`, its references listed at
//   `transform/plane`, resolved in the state before the pattern). For a face it is the whole plane
//   the face lies in.
// - No count and no numeric field: the copy has the number 1, so a mirrored body is
//   `<pattern>/1` and a face of the copy carries `copy: [{ pattern, index: 1 }]`.
// - The copy is the mirror image as a set of points. What is told by a sense of rotation is
//   therefore reversed in it, and the names do not say so: a face name says which face of the
//   source it is the image of. The face `wallSide` of a curve with `side: 'left'` lies on the right
//   of the image of the curve; the flats of a nut pocket run clockwise where the source counts them
//   counter-clockwise.
// - Errors of the pattern: `brokenReference` (the plane, the body or the face is not in the state
//   before the pattern) and `nonPlanarFace`, with the plane in `refs`: the codes a sketch on that
//   plane would get.
export interface MirrorTransform {
  type: 'mirror';
  plane: PlaneRefAfter;
}

// The transform of a pattern after this package. In the code the two variants are members of
// `PatternTransform` in types.ts.
export type PatternTransformD = CircularTransform | LinearTransform | MirrorTransform;

// The pattern feature after this package. Nothing but the transform changes:
// - the source is a list of features that apply a tool, or one body, for every kind;
// - a pattern of a body creates the bodies `<pattern>/<number>` from 1 (`createsBody` of the
//   registry) and answers `bodySource` with its source, so a copy of any kind inherits the body
//   properties of its source (D48) and is listed in a link of the mechanism like any body (D49);
// - a pattern of features applies, for every copy and in the order of the list, the tool of each
//   source built in the frame of the copy to the targets of that source; the pattern is atomic.
export interface PatternFeatureD extends Omit<PatternFeature, 'transform'> {
  transform: PatternTransformD;
}
// What `updateFeature` may change, by the rules of today: a transform of the same `type` merges
// by field, another `type` replaces the transform and has to be complete (its expressions go with
// it), a reference (`direction`, `plane`) and a span of another type are replaced whole.
export type PatternPatchD = Patch<Pick<PatternFeatureD, 'source' | 'transform'>>;

declare module '../00-prep/contract' {
  interface FeatureTypes {
    pattern: PatternFeatureD;
  }
  interface FeaturePatches {
    pattern: PatternPatchD;
  }
}

// ================================================================ the numeric fields

export const PATTERN_SPACING = { title: 'Spacing', unit: 'mm', nonZero: true } as const satisfies NumberSpec;
export const PATTERN_LENGTH = { title: 'Length', unit: 'mm', nonZero: true } as const satisfies NumberSpec;
// `PATTERN_COUNT` and `PATTERN_ANGLE` of features/pattern.ts stay as they are.
export declare const PATTERN_COUNT: NumberSpec;
export declare const PATTERN_ANGLE: NumberSpec;

// The fields of the pattern as the registry lists them (`FEATURE_TYPE_INFO.pattern.fields`). The
// count is listed once per kind that has one, as `extent/start` is listed once per variant of the
// extent that has it: a condition names one value, and a mirror has no count.
export const PATTERN_FIELDS: FieldSpec[] = [
  { path: 'transform/count', spec: PATTERN_COUNT, when: { path: 'transform/type', equals: 'circular' } },
  { path: 'transform/span/angle', spec: PATTERN_ANGLE, when: { path: 'transform/span/type', equals: 'angle' } },
  { path: 'transform/count', spec: PATTERN_COUNT, when: { path: 'transform/type', equals: 'linear' } },
  { path: 'transform/span/spacing', spec: PATTERN_SPACING, when: { path: 'transform/span/type', equals: 'spacing' } },
  { path: 'transform/span/length', spec: PATTERN_LENGTH, when: { path: 'transform/span/type', equals: 'length' } },
];

// ================================================================ the transforms of the copies

// solid.ts, next to `rotation` and `shift`: the reflection in the plane through `point` with the
// normal `normal` (any length, either sense). An isometry with the determinant −1; applied twice it
// is the identity.
export declare function reflection(point: Vec3, normal: Vec3): RigidTransform;
// Does a transform mirror (is its determinant negative)? `transformSolid` asks it already, to turn
// the triangles of a mirrored body over; `applyTool` asks it for a tool (below).
export declare function mirrors(transform: RigidTransform): boolean;

// What `transformsOf` of features/pattern.ts answers for the kinds, the original excluded:
// - linear: `shift(direction, k · step)` for `k` from 1 to `count − 1`;
// - mirror: `[reflection(origin, normal)]` of the frame of the plane.
// A transform of a pattern is thus an isometry that may mirror. The transform of a link of the
// mechanism (`LinkResult.transform`, the same type) never does: it is composed of turns and shifts.

// ================================================================ a tool in a mirrored placement

// `ToolRecipe.build(targets, firstFaceId, placement)` (recompute/state.ts) keeps its signature and
// its meaning: the tool is built in the frame of the copy, `transformFrame(placement.transform,
// frame)`, so that what it measures ("through all", the way to the plane of `upTo`) is measured
// where the copy stands. The rule this package adds, in one place:
//
// - A build places every vertex by the frame it is given and winds its triangles as for
//   a right-handed frame. It does not look at the handedness of the frame.
// - In a mirrored placement the frame is left-handed, the vertices are the mirror image and every
//   triangle faces inwards. `applyTool` (recompute/services.ts) turns the triangles of such a tool
//   over right after `build`, before the booleans.
// - The descriptions of the faces (`BuiltTool.faces`) need nothing: a plane, a cylinder and
//   a swept surface carry no side, and the axis of a cone is a vector the frame maps like any other.
//
// So `buildPrism`, `buildStack` and every later build (the revolve of 4a) stay as they are, and
// a build that would correct the winding itself must not: the tool would be turned twice, and the
// kernel refuses a tool that faces inwards (`kernelFailure`), so the mistake cannot pass silently.
export const MIRRORED_TOOL = 'applyTool turns the triangles of a tool over when its placement mirrors' as const;

// ================================================================ what the package does not add

// - No upgrade step: a build without the package refuses a transform of a type it does not know
//   (`patternFeature` lists the types: "transform.type: čeká se jedna z hodnot circular", an invalid
//   document on load), and the two variants list their own fields, so a later field of them is
//   refused by this build in turn.
// - No issue code: a mirror plane fails like the plane of a sketch; a copy fails as copies do today.
// - No face role and no change of a face name: a face of a copy is the name of its source with the
//   tag of the copy, for every kind.
// - Nothing in `AxisRef` and nothing in `PlaneRef`.
