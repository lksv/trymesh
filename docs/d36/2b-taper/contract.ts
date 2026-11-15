// Contract of package 2b (D45): taper on extrusion. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It adds one field to the distance extent of the
// extrusion that 2a-offset/contract.ts declares for track B, and one upgrade step.

import type { NumberSpec, Vec3 } from '../../../packages/engine/src/index';
import type { Surface, UpgradeStep } from '../00-prep/contract';

// ================================================================ the field

// `taper` (numeric field `extent/taper`, radians, between −π/2 and π/2, neither included): the
// angle between a side face and the direction of the extrusion.
// - The profile at the start of the extent (at `start`, not at the sketch plane) is the profile
//   of the sketch, with its `profile/offset` if it has one. The profile at the end is that
//   profile moved by `|distance| · tan(taper)`, with the rule of the offset of 2a.
// - Positive widens away from the start, the same sign as the offset: outer loops grow towards
//   the end and holes shrink. It does not depend on the sign of `distance`.
// - A side from a line is a plane, tilted by the angle; a side from an arc or a circle is a cone
//   with the half angle `|taper|` (`Surface` of the preparatory step). The names of the faces
//   are those of the straight extrusion.
// - Absent means none, and the tool is then the prism of today.
// - Not with a generated profile (it has no curves to move) and not on the extents `throughAll`
//   and `upTo`, where the size of the far end would depend on the targets: both are invalid
//   commands when the field is present.
// - The errors are those of the offset, for the profile at the end: `invalidProfile`.
declare module '../2a-offset/contract' {
  interface DistanceExtentFields {
    taper?: number;
  }
}
export const EXTENT_TAPER = { title: 'Taper', unit: 'rad', min: { value: -Math.PI / 2, open: true }, max: { value: Math.PI / 2, open: true }, default: 0 } as const satisfies NumberSpec;

// ================================================================ the version of the schema

// A field of an extent is dropped on load, without a word, by a build that does not know it
// (`extrudeFeature` in document.ts reads `start` and `distance` and nothing else). So the field
// gets a step although there is nothing to convert: a build without the step refuses the
// document.
export const TAPER_UPGRADE: UpgradeStep = { name: '2b-taper', run: (document) => document };

// ================================================================ circles between surfaces

// The rule of 00-prep/contract.ts for circular edges ("Kinds of edges"), as the one function
// both `edgeKind` and `projectEdge` of solid.ts ask: the circle two surfaces meet in, or nothing.
// - a plane across the axis of a cylinder or of a cone;
// - a cylinder and a cone about one axis;
// - two cones about one axis that differ in the apex or in the half angle.
// The radius has to be above `LENGTH_TOLERANCE`, and for a cone the circle has to lie on the
// half the cone's `axis` points along. Anything else, two faces of one surface included, is
// undefined, and the edge is `other`.
//
// A stand-in: the engine has it over its internal `FaceInfo`, and package 1b needs the same
// function over `Surface` for the circles of a body description (design.md, "Needs from the
// preparatory step").
export interface Circle3 {
  center: Vec3;
  axis: Vec3; // unit, without a sign
  radius: number;
}
export declare function circleBetween(a: Surface, b: Surface): Circle3 | undefined;

// ================================================================ what the package does not add

// - No feature type, no face role, no command, no query, no issue code.
// - `Surface` already has the cone; the package is the first to make faces of that kind.
