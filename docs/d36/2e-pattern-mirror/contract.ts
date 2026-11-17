// Contract of package 2e (D53): a linear pattern and a mirror, two more kinds of the transform of
// the pattern feature. A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// It imports the real types of the engine and states only what the package adds or changes: two
// variants of `PatternTransform`, their numeric fields, a reflection among the transforms, and one
// rule of `applyTool`. No feature type, no command, no query, no face role and no upgrade step; no
// issue code for the two kinds (the grid, below, adds one).
//
// The grid (an addition to D53 of 2026-11-17, designed in grid.md) is marked "the grid" below: a
// second direction of the variant `linear`, the numbers of its copies, its numeric fields and one
// error code. Written against `master` at 633a6ca, where the two variants above are implemented.

import type { AxisRef, FieldSpec, Id, NumberSpec, Patch, PatternFeature, PatternTransform, RigidTransform, Vec3 } from '../../../packages/engine/src/index';
import type { PlaneRefAfter } from '../00-prep/contract';

// ================================================================ the transform

// The kind of today, unchanged: copies turned around an axis. (Since 2e is implemented the type of
// the engine holds all three kinds; the grid changes the variant `linear`, so the variant of the
// engine is taken for `circular` alone.)
export type CircularTransform = Extract<PatternTransform, { type: 'circular' }>;

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
// - `second` (the grid): a second direction, see `SecondDirection`. Without it the pattern is a row,
//   as before the grid.
export interface LinearTransform {
  type: 'linear';
  direction: AxisRef;
  count: number;
  span: LinearSpan;
  second?: SecondDirection;
}
export type LinearSpan = { type: 'spacing'; spacing: number } | { type: 'length'; length: number };

// ================================================================ the grid: a second direction

// The second direction of a linear pattern: the row of the first direction is repeated along it.
// - `direction`, `count`, `span`: as for the first direction, each with its own value. The numeric
//   fields are `transform/second/count`, `transform/second/span/spacing` and
//   `transform/second/span/length`. `count` includes the row of the original; 1 is that row alone.
// - The places of the grid are the pairs (i, j): i steps along `direction` (0 … count − 1) and
//   j steps along `second.direction` (0 … second.count − 1). The place (0, 0) is the original; every
//   other place is one copy, shifted by `i · step + j · second step`.
// - The number of the copy at (i, j) is `i + GRID_STRIDE · j` (`copyNumber`): the row of the
//   original has the numbers 1 … count − 1 of a pattern of one direction, the next row starts at
//   1000, the one after at 2000. A number does not depend on the counts, so with the span `spacing`
//   in both directions a larger count adds copies and moves none, and what refers to a copy
//   (`<pattern>/<number>`, a face tagged `index: <number>`, a link) keeps meaning the same place.
//   The numbers have gaps; `FeatureResult.bodies` lists the copies that exist, in the order of
//   their numbers, which is the order they are made in (row by row).
// - `count × second.count` is at most `MAX_PATTERN_PLACES`, and no two places may be one place:
//   at most the length tolerance of the engine apart (1e-6 mm; the original is a place). Places
//   meet when the two directions are parallel and steps of the two add up to the same shift (5 and
//   5 meet, 5 and 6 over 4 × 3 places do not), or when a step is shorter than the tolerance. The
//   places are compared, not the meshes: places further apart than the tolerance and closer than
//   the step of float32 at their coordinates give copies that are one mesh, and are accepted.
//   A linear pattern without `second` is not compared (the row of today). Both rules are judged by
//   the recompute, where the values of expressions and the directions are known: the error
//   `invalidPattern` of the pattern.
// - Listed fields only (`onlyFields`): a field of the first direction's variant (`type`, `second`)
//   or of another kind is an invalid command.
// - `updateFeature`: a patch `{ transform: { second: { … } } }` merges by field with the second
//   direction the pattern has, or is the new one and has to be complete; `{ second: null }` removes
//   it (accepted also on a row) and its expressions with it.
export interface SecondDirection {
  direction: AxisRef;
  count: number;
  span: LinearSpan;
}

// The stride of the numbers of a grid (features/pattern.ts, exported by the engine). Above the
// largest step of the first direction (`MAX_PATTERN_COUNT − 1`, 199), and part of the meaning of
// every document with a grid: it is never changed, and the bound of a count can grow to 1000 at
// most (the steps 0 … 999).
export const GRID_STRIDE = 1000;
// A pattern has at most this many places, the original included, in a row or in a grid: the bound
// of a count, for the product of the two counts (features/pattern.ts, exported by the engine).
export const MAX_PATTERN_PLACES = 200;
// Two helpers of this contract and of calls.ts, not exports of the engine: the number of the copy
// `first` steps along the first direction and `second` steps along the second ((0, 0) is the
// original and has none), and the body of that copy of a pattern of a body.
export const copyNumber = (first: number, second: number): number => first + GRID_STRIDE * second;
export const copyBody = (pattern: Id, first: number, second: number): Id => `${pattern}/${copyNumber(first, second)}`;

declare module '../00-prep/contract' {
  // `invalidPattern`, an error of a pattern, reported by the recompute:
  // - the grid has more places than `MAX_PATTERN_PLACES`: `refs` are the fields
  //   `transform/count` and `transform/second/count`, the detail says the product;
  // - two places of a grid would be one place: `refs` are the paths of what the places are computed
  //   from (`transform/direction`, `transform/count`, the numeric field of the span,
  //   `transform/span/spacing` or `transform/span/length`, and the same three under
  //   `transform/second/`); the detail names the two copies (or the copy and the original), and
  //   is all a user is told, so the step has to hand it on.
  // The pattern is in error as a whole and the model stays as it was before it.
  interface IssueCodes {
    invalidPattern: true;
  }
}

// `mirror`: one copy, the mirror image of the source in a plane.
// - `plane`: a base plane, a plane feature or a planar face of a body, referred to as a sketch
//   refers to its plane (`PlaneRef`; validated by `planeRef`, its references listed at
//   `transform/plane`, resolved in the state before the pattern). For a face it is the whole plane
//   the face lies in.
// - No count and no numeric field: the copy has the number 1, so a mirrored body is
//   `<pattern>/1` and a face of the copy carries `copy: [{ pattern, index: 1 }]`. The registry
//   knows it: `createsBody` of a pattern of a body answers true for the local name `1` alone when
//   the transform is a mirror (for the other kinds for every number from 1, as today, because
//   a count may be an expression). A command that brings in `<mirror>/2` as a body is therefore
//   invalid. A document may still hold such an ID (after a change of the kind); each place reports
//   it as a body that is not there (a feature `brokenReference`, a projected edge the warning
//   `brokenProjection`, a link `missing`). The number in the copy tag of a FACE is not checked
//   against the kind: `copy: [{ pattern: <a mirror>, index: 2 }]` is a valid command and an issue
//   of the recompute, as an index beyond a count is.
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
//   registry; a mirror only `<pattern>/1`) and answers `bodySource` with its source, so a copy of any kind inherits the body
//   properties of its source (D48) and is listed in a link of the mechanism like any body (D49);
// - a pattern of features applies, for every copy and in the order of the list, the tool of each
//   source built in the frame of the copy to the targets of that source; the pattern is atomic.
export interface PatternFeatureD extends Omit<PatternFeature, 'transform'> {
  transform: PatternTransformD;
}
// A change of the kind keeps the IDs of the copies and the tags of their faces: what refers to
// copy 1 then refers to the copy of the new kind.
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
  // the grid: the fields of the second direction. Its count is listed once per span it can have
  // (a condition names one value, and a pattern without a second direction has neither).
  { path: 'transform/second/count', spec: PATTERN_COUNT, when: { path: 'transform/second/span/type', equals: 'spacing' } },
  { path: 'transform/second/span/spacing', spec: PATTERN_SPACING, when: { path: 'transform/second/span/type', equals: 'spacing' } },
  { path: 'transform/second/count', spec: PATTERN_COUNT, when: { path: 'transform/second/span/type', equals: 'length' } },
  { path: 'transform/second/span/length', spec: PATTERN_LENGTH, when: { path: 'transform/second/span/type', equals: 'length' } },
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
// The grid: the function answers the copies with their numbers instead of a bare list, because the
// number of a copy is no longer its position in the list. For a grid, row by row:
// `{ transform: compose(shift(direction, i · step), shift(second.direction, j · second step)),
// index: copyNumber(i, j) }` for j from 0, i from 0, without (0, 0). The step of a direction is its
// `spacing`, or `length / (count − 1)`. (`PatternCopy` is the name for the implementation; the
// prototype called it `Copy`.)
export interface PatternCopy {
  transform: RigidTransform;
  index: number; // the number of the copy: `<pattern>/<index>`, `copy: [{ pattern, index }]`, `refs: [{ copy: index, … }]`
}
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
//   refused by this build in turn. The grid is such a field: `master` refuses a document with
//   `transform.second` ("a transform of the type linear has no such field", measured), so the grid
//   has no step either; the second direction lists its fields in turn.
// - No issue code for the two kinds: a mirror plane fails like the plane of a sketch; a copy fails
//   as copies do today. (The grid adds `invalidPattern`, above.)
// - No face role and no change of a face name: a face of a copy is the name of its source with the
//   tag of the copy, for every kind.
// - Nothing in `AxisRef` and nothing in `PlaneRef`.
