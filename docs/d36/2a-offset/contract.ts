// Contract of package 2a (D44): profile offset and a wall from a line. A draft for review, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine
// and the shared types of the preparatory step and states what the package adds.
//
// This file also owns the one declaration of the changed extrusion that the four packages of
// track B share (2a, 2b, 2c, 2f): `extrude` in `FeatureTypes` and `FeaturePatches`. The other
// packages add to it through the two interfaces `DistanceExtentFields` and `ExtentVariants`
// below, by declaration merging, so that each contract still states only what it adds. In the
// code these are members of the unions `ProfileSource` and `Extent` of types.ts.

import type { FeatureBase, Id, NumberSpec, Patch, ProfileSource, RegionRef } from '../../../packages/engine/src/index';
import { FACE_ROLES } from '../00-prep/contract';

// ================================================================ the profile source

// Regions of a sketch, as today, with an optional offset.
// - `offset` (numeric field `profile/offset`, millimetres, either sign): the outline of the
//   selected regions moved by that much. Positive grows the profile: outer loops move outwards
//   and holes shrink. Absent means no offset; a document without the field is the document of
//   today and its mesh does not change.
// - The outline is the boundary of the selected regions taken together: a curve shared by two
//   selected regions is not part of it (the same rule as for side faces today), so a rectangle
//   with circles inside it, all selected, is offset as the plain rectangle.
// - Every curve of the outline maps to one curve: a line to a parallel line, an arc or a circle
//   to one with the same centre and another radius, joined to its neighbours where the two moved
//   curves meet (a mitre). Side faces keep their names (`side` with the curve) and their exact
//   surfaces.
// - The feature ends in the error `invalidProfile` when a curve vanishes or turns round, when two
//   moved neighbours do not meet, when loops touch or cross after the offset or their nesting
//   changes. The topology of the outline never changes.
export interface RegionsProfile {
  type: 'regions';
  sketch: Id;
  regions: RegionRef[];
  offset?: number;
}

// A generated profile, unchanged. It has no offset: its sides are general curves.
export type GeneratedProfile = Extract<ProfileSource, { type: 'generated' }>;

// A wall along curves of a sketch: a chain of curves offset to both sides by half the thickness.
// - `curves`: own curves of the sketch (lines, arcs, or one circle), construction curves included,
//   stored sorted. They have to form one chain: each joined to the next at an end point (the same
//   point, or points held together by a satisfied coincident constraint), no branch. An open
//   chain gives one closed loop with a straight end at each free end; a closed chain (a circle,
//   a closed loop of lines and arcs) gives a band with a hole.
// - `thickness` (numeric field `profile/thickness`, millimetres, positive): the width of the
//   wall, half of it to each side of the chain.
// - The source reads the solved curves only. It does not need the sketch to have closed regions
//   or a valid profile: the centre line of a rib ends on the wall it stiffens, which would
//   invalidate a profile of regions unless the line is a construction line.
// - Corners are mitres, as for the offset; the errors are the same (`invalidProfile`), and
//   a curve that is no longer in the sketch is a `brokenReference`.
export interface WallProfile {
  type: 'wall';
  sketch: Id;
  curves: Id[];
  thickness: number;
}

export type ProfileSourceB = RegionsProfile | GeneratedProfile | WallProfile;

// The numeric fields the package adds, as the registry describes them. A field whose description
// has a default may be left out of a command and of the document; `setField` accepts its address
// also while the feature does not have it (design.md, "An optional numeric field").
export const PROFILE_OFFSET = { title: 'Offset', unit: 'mm', default: 0 } as const satisfies NumberSpec;
export const WALL_THICKNESS = { title: 'Thickness', unit: 'mm', min: { value: 0, open: true } } as const satisfies NumberSpec;

// ================================================================ the extent (shared by track B)

// What the distance extent has beyond `start` and `distance`. Package 2b adds the taper here.
export interface DistanceExtentFields {}
// The variants of the extent by their `type`. Package 2f adds `upTo` here.
export interface ExtentVariants {
  distance: { type: 'distance'; start: number; distance: number } & DistanceExtentFields;
  throughAll: { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };
}
export type ExtentB = ExtentVariants[keyof ExtentVariants];
// The distance extent as today, without what 2b adds: the extent of a hole (2c) is built from it.
export type PlainDistanceExtent = { type: 'distance'; start: number; distance: number };

// ================================================================ the extrusion (shared by track B)

export interface ExtrudeFeatureB extends FeatureBase {
  type: 'extrude';
  profile: ProfileSourceB;
  extent: ExtentB;
  operation: 'new' | 'add' | 'cut';
  targets?: Id[]; // as today: none for new, exactly one for add, one or more for cut
}
// What `updateFeature` may change of it: the same four fields as today. A variant with the same
// `type` merges by field, so `{ profile: { offset: 2 } }` sets the offset and
// `{ profile: { offset: null } }` removes it.
export type ExtrudePatchB = Patch<Pick<ExtrudeFeatureB, 'profile' | 'extent' | 'operation' | 'targets'>>;

declare module '../00-prep/contract' {
  interface FeatureTypes {
    extrude: ExtrudeFeatureB;
  }
  interface FeaturePatches {
    extrude: ExtrudePatchB;
  }
  // The faces of a wall. Every curve of the chain makes two side faces, so `side` with the curve
  // would name both.
  // - `wallSide`: `side` is the side of the curve in its own direction (a line from its point `a`
  //   to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre). It
  //   does not depend on the order of `curves` or on which end the chain is walked from.
  // - `wallEnd`: the straight end of an open chain; `point` is the sketch point the chain ends at,
  //   as the end curve names it.
  // The caps are `startCap` and `endCap`, as for any extrusion.
  interface FaceRoles {
    wallSide: { curve: Id; side: 'left' | 'right' };
    wallEnd: { point: Id };
  }
}

// The entries of the catalog of roles for the two.
export const WALL_ROLES: Pick<typeof FACE_ROLES, 'wallSide' | 'wallEnd'> = {
  wallSide: { title: 'Side of a wall', parts: { curve: { title: 'Curve', kind: 'text' }, side: { title: 'Side of the curve (left or right)', kind: 'text' } } },
  wallEnd: { title: 'End of a wall', parts: { point: { title: 'Point', kind: 'text' } } },
};

// ================================================================ what the package does not add

// - No issue code: the errors are `invalidProfile` (with a text that names the curves),
//   `brokenReference` and `noProfile`, which exist.
// - No upgrade step: a build without the package refuses a profile source with a field or a type
//   it does not know (`PROFILE_FIELDS` and the list of types in `profileSource`, document.ts).
// - No command and no query.
