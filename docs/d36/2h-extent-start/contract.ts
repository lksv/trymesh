// Contract of package 2h (D66): the start of an extent at a plane or a planar face. A draft for
// review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). The extent of today is in the
// code (2a, 2b, 2f and 2c are implemented), so this contract imports the real `Extent`,
// `HoleExtent`, `ExtrudeFeature` and `HoleFeature` and states only what the package adds: one
// optional field `from` on every variant of the extent and of the extent of a hole, a fact, an
// upgrade step, and the parts of the recompute the steps call. No feature type, no face role, no
// command, no query, no numeric field, no issue code (`invalidExtent` of D47 gets a second meaning).
//
// Third version, after rounds 1 and 2 of the reviews (design.md, "Reviews").

import type { Extent, ExtrudeFeature, Frame, HoleExtent, HoleFeature, Id, Input, Patch, Solid } from '../../../packages/engine/src/index';
import type { EndPlane, ThroughAll } from '../../../packages/engine/src/recompute/extent';
import { UP_TO_MIN_ANGLE } from '../../../packages/engine/src/recompute/extent';
import type { Region } from '../../../packages/engine/src/sketch';
import { LENGTH_TOLERANCE } from '../../../packages/engine/src/util';
import type { PlaneRefAfter, UpgradeStep } from '../00-prep/contract';

// ================================================================ the field

// `from` (optional): the reference plane the extent starts from, instead of the sketch plane. A
// base plane, a plane feature or a planar face of a body, referred to as a sketch refers to its
// plane; for a face it is the whole plane the face lies in (the profile need not lie over the face).
// - Without `from` nothing changes: the extent starts from the sketch plane, as today.
// - With `from`, `start` (the field `extent/start`, as today) is the offset of the start from that
//   plane, along the normal of the sketch plane (not of the face: its sign means what it means
//   without `from`, and the normal of a face, a plane feature or a base plane may point either
//   way). The tool starts at the effective start, the level of the plane plus `start`, and lies in
//   the plane only when `start` is 0. `distance` is measured from the effective start, as today.
//   So `{ from: <the top of the plate>, start: 0, distance: 12 }` is a boss on the plate, and
//   `{ from: <the top>, start: -0.6, distance: -3 }` a cavity under a skin of 0.6.
// - The plane has to be parallel to the sketch plane: its level along the normal of the sketch may
//   differ over the exact outline of the start by no more than the length tolerance (1e-6 mm). The
//   tool then is the tool of today with the start at the effective start, every face and its name
//   included. A tilted plane is refused (`invalidExtent`), not built; deferred (design.md).
// - The plane is resolved at every recompute of the feature, in the state before it, so the start
//   follows the face when the model changes. The level is measured once, for the feature itself;
//   a copy made by a pattern of features carries its start with it, as it carries its sketch plane:
//   the copy starts at the image of the face, not at the face itself. (The end of `upTo` does not
//   move with a copy, so a mirrored post from the top of a plate up to a lid starts at the image of
//   the top, the underside of the plate, and runs up through the plate to the lid.) A pattern of
//   a body copies the body as it is.
// - On every variant. `distance` (with or without a taper; the taper holds from the effective
//   start). `upTo`: the tool runs from the effective start to the end plane, and the refusals of
//   D47 apply to the effective start (a plane `from` equal to the end plane with `start: 0` is the
//   plane through the start; with `start: -2` a tool 2 mm long). `throughAll` with `forward` or
//   `backward` only (from the effective start through all targets on that side); `from` with
//   `both` is an invalid command, both sides of any start being all of the targets.
//   For the extrusion and for the hole (its mouth is at the effective start).
// - A command verifies the reference as for `upTo`: the body, the feature that named the face and
//   the patterns in its copy tags exist and come before the feature. `moveFeature` keeps the
//   feature after them (the references are listed under `extent/from`).
// - `updateFeature`: `{ extent: { from: <ref> } }` sets or replaces the reference (a reference is
//   never merged), `{ extent: { from: null } }` removes it, also where the extent has none (the
//   extrusion by `removableFromExtent`, the hole by its own predicate, for `extent/from` only).
// - Errors of the feature: `brokenReference` (the plane, the body or the face is not in the state
//   before the feature) and `nonPlanarFace`, with `from` in `refs`; `invalidExtent` (below).
export interface ExtentStart {
  from?: PlaneRefAfter;
}

// The real types carry `from` since the implementation (as `PlaneRef`); the contract states it with
// `PlaneRefAfter` of the preparatory step, so it takes the variants without it.
type Distance = Omit<Extract<Extent, { type: 'distance' }>, 'from'>;
type UpTo = Omit<Extract<Extent, { type: 'upTo' }>, 'from'>;
type ThroughAllExtent = Omit<Extract<Extent, { type: 'throughAll' }>, 'from'>;
// As types.ts has it: one member per variant, `from` optional on each; the rule "`from` only
// with forward or backward" is in the comment and in the validator, not in the type, so that
// `extent.from` reads on every variant (calls.ts checks the rule with a stricter type of its own).
export type ExtentH = (Distance | UpTo | ThroughAllExtent) & ExtentStart;
export type HoleExtentH = (Omit<Extract<HoleExtent, { type: 'distance' }>, 'from'> | Omit<Extract<HoleExtent, { type: 'throughAll' }>, 'from'>) & ExtentStart;

export type ExtrudeFeatureH = Omit<ExtrudeFeature, 'extent'> & { extent: ExtentH };
export type HoleFeatureH = Omit<HoleFeature, 'extent'> & { extent: HoleExtentH };
export type ExtrudePatchH = Patch<Pick<ExtrudeFeatureH, 'profile' | 'extent' | 'operation' | 'targets'>>;
export type HolePatchH = Patch<Pick<HoleFeatureH, 'sketch' | 'points' | 'shape' | 'extent' | 'targets' | 'label'>>;

// The extrusion and the hole are declared by 2a and 2c in the maps of the preparatory step, under
// their names, and a name is taken once. The commands that carry the changed features go into the
// map of commands instead (the way 4a adds a pattern about a line).
declare module '../00-prep/contract' {
  interface Commands {
    addExtrudeFrom: { type: 'addFeature'; feature: Input<ExtrudeFeatureH>; index?: number };
    updateExtrudeFrom: { type: 'updateFeature'; id: Id; patch: ExtrudePatchH };
    addHoleFrom: { type: 'addFeature'; feature: Input<HoleFeatureH>; index?: number };
    updateHoleFrom: { type: 'updateFeature'; id: Id; patch: HolePatchH };
  }
}

// ================================================================ the issue code

// `invalidExtent` (D47) gets a second meaning: the extent cannot start in its plane `from`.
// - The plane is parallel to the direction of the extrusion or within `UP_TO_MIN_ANGLE` of it (the
//   test and the angle of D47).
// - The plane is tilted against the sketch plane: its level differs over the exact outline of the
//   start by more than `START_LEVEL_SPREAD`. The detail says by how much and what to do (put the
//   sketch on that face, or on a plane parallel to the start).
// `refs`: the plane `from`. The general text of the code (`MESSAGE`) becomes "The extent cannot use
// its plane: the tool cannot reach the plane it is to end in, or cannot start in its start plane."
// It covers the extrusion and the hole.
export const START_MIN_ANGLE: typeof UP_TO_MIN_ANGLE = UP_TO_MIN_ANGLE;
export const START_LEVEL_SPREAD: typeof LENGTH_TOLERANCE = LENGTH_TOLERANCE;

// ================================================================ what the result says

// Published in `facts` of the feature (next to the facts of a profile generator, of `upTo` and of
// a hole) when the extent has `from`, for the feature itself, not for its copies.
export const START_FACTS = {
  startLevel: 'the effective start: its level along the normal of the sketch plane, measured from it, in mm (the level of the plane `from` plus `start`)',
} as const;
// With `from`, the facts that measure from the start measure from the effective start: `lengthMin`
// and `lengthMax` of `upTo`, and `depth` of a hole through all (how far the targets reach from the
// mouth, not from the sketch plane).

// ================================================================ the upgrade step

// The variants `distance` and `throughAll` of a build without the package drop a key they do not
// know, so a document with `from` would load there with every such tool at the sketch plane,
// without a word. The step converts nothing; a build without it refuses the document. Counted in
// `SCHEMA_PENDING` on the branch; the version it raises master to is decided by the order of the
// merge against the steps of step 6.
export const EXTENT_START_STEP: UpgradeStep = { name: '2h-extent-start', run: (document) => document };

// ================================================================ the recompute

// The level of the reference plane `from` in the frame the feature is built in (recompute/extent.ts,
// beside `upToSpan`): the middle of its extremes over the exact outline at the start, or a refusal
// with its detail. Not the fact `startLevel`, which adds `start`.
// - The plane is resolved by `frame(ref, state)` as the end plane of `upTo` is (`EndPlane`: a point
//   and a unit normal in model coordinates).
// - The outline is given by its exact curves, in the coordinates of the sketch: a line by its two
//   ends, a circle or an arc by its whole circle (the extremes of a linear function on a circle are
//   the centre's value ± r · |gradient|, so a circle needs no tessellation; an arc is tested on its
//   whole circle, which can only be stricter), a curve without an exact form (a generated side, a
//   spline of step 6) by the vertices of its polyline, which is what is built for it (such
//   a profile has no taper). Every vertex the builds make (the prism, the rings of a taper however
//   they resample a circle, the stacks of a hole) lies on these curves, so a plane accepted here
//   is parallel within the tolerance at every built vertex.
export type ExactCurve = { type: 'line'; a: [number, number]; b: [number, number] } | { type: 'circle'; center: [number, number]; radius: number } | { type: 'points'; xy: readonly number[] };
export type PlaneLevel = (plane: EndPlane, frame: Frame, outline: readonly ExactCurve[]) => { level: number } | { detail: string };
// The exact curves of the start of an extrusion: the `exact` curves of the loops of its regions
// (`Loop.exact`, the curves the polylines were divided from, as the taper reads them; for unoffset
// regions their ends are where `detectProfile` joined coincident ends, which may differ from the
// solved sketch by the join tolerance), each line by its ends, each arc or circle by its circle, and
// the actual end point of every curve as a point as well; a loop without `exact` (a generated
// profile, a spline) by its vertices. A hole gives its circles and the corners of its hexagon itself.
export type ExactStart = (regions: readonly Region[]) => ExactCurve[];

// The extent the builds see, made once by the step of the feature: `from` resolved. For `distance`
// and `upTo` `start` is raised by the level (the effective start); "through all" is unchanged and
// the level goes to `toolSpan` / `throughAll` as their argument `start`. The same function serves
// the extrusion and the hole (whose mouth is then `start` of a distance, or the level for "through
// all").
export type WithoutFrom<E> = E extends unknown ? Omit<E, 'from'> : never;
export type ResolveStart = <E extends ExtentH | HoleExtentH>(extent: E, level: number) => WithoutFrom<E>;

// "Through all" from a start, its argument passed explicitly by every caller (0 without `from`):
// the interval runs from `start` to the farthest target on the side, plus the overshoot; `reach` is
// measured from `start` (zero when no target passes it on that side: the tool then misses them,
// `noEffect`); `scale` includes the coordinates of the start. `both` is always called with 0.
// Call sites: `toolSpan` (from the build of the extrusion), the build of the hole and its fact
// `depth` (with the mouth); the resolution test of the hole (`both`) keeps 0.
export type ThroughAllFrom = (side: 'forward' | 'backward' | 'both', frame: Frame, targets: Solid[], start: number) => ThroughAll;
// The scale of the guards of a hole against the resolution of the kernel (the head and a blind bore
// must be longer than `1e-4 · scale`): the largest coordinate of the targets, of the sketch plane and
// of the tool itself, its mouth and its far end in the frame of the feature. Apart from
// `throughAll`, whose `both` keeps the start 0. The hole resolves its mouth before these guards.
export type ToolScale = (frame: Frame, targets: Solid[], mouth: number, far: number) => number;
export type ToolSpanFrom = (extent: Exclude<Extent, { type: 'upTo' }>, frame: Frame, targets: Solid[], start: number) => [number, number];
