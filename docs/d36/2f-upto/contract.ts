// Contract of package 2f (D47): the extent up to a plane or a planar face. A draft for review,
// only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It adds one variant to the extent of
// the extrusion that 2a-offset/contract.ts declares for track B, and one issue code.

import type { NumberSpec } from '../../../packages/engine/src/index';
import type { PlaneRefAfter } from '../00-prep/contract';

// ================================================================ the variant

// `upTo`: the tool starts at `start` (as the distance extent: the offset of its start from the
// sketch plane along the normal) and ends in a plane.
// - `plane`: a planar face of a body, a plane feature or a base plane, referred to as a sketch
//   refers to its plane. For a face it is the whole plane the face lies in: the tool ends there
//   also where its profile passes beside the face itself.
// - The plane may be tilted against the sketch plane; the end cap then lies in it and the length
//   differs from point to point. Side faces and their names are those of a straight extrusion.
// - The direction is not given: the tool runs from its start to the plane, on whichever side of
//   the start the plane lies. The result of the feature says which (`UP_TO_FACTS`).
// - `gap` (numeric field `extent/gap`, millimetres, default 0): the plane is taken moved by that
//   much towards the start, so a positive gap leaves that distance, measured across the plane,
//   between the end of the tool and the plane; a negative one passes the plane by as much.
// - The plane is resolved every time the tool is built, in the model the tool is applied to:
//   the length follows the face when the model changes, and a copy made by a pattern runs from
//   its own start to the same plane (the plane does not move with the copy).
// - For every operation (`new`, `add`, `cut`); it needs no target to measure. No taper.
// - Errors of the feature: `brokenReference` (the plane or the face is not in the model),
//   `nonPlanarFace`, and `invalidExtent` below.
declare module '../2a-offset/contract' {
  interface ExtentVariants {
    upTo: { type: 'upTo'; plane: PlaneRefAfter; start: number; gap?: number };
  }
}
export const EXTENT_GAP = { title: 'Gap before the plane', unit: 'mm', default: 0 } as const satisfies NumberSpec;

// ================================================================ the issue code

// `invalidExtent`, an error: the tool cannot reach the plane.
// - the plane is parallel to the direction of the extrusion (within the angle tolerance);
// - the plane passes through the start of the tool, or touches it: some point of the profile at
//   the start is on the other side of the plane than the rest, or closer to it than the length
//   tolerance. (A plane that lies wholly on one side is reached, whichever side it is.)
declare module '../00-prep/contract' {
  interface IssueCodes {
    invalidExtent: true;
  }
}

// ================================================================ what the result says

// Published in `facts` of the feature result (next to the facts of a profile generator, if the
// profile has one), so that a caller can read the length the plane gave.
export const UP_TO_FACTS = {
  lengthMin: 'the shortest length of the tool along the normal of the sketch plane, in mm',
  lengthMax: 'the longest one; equal to lengthMin when the plane is parallel to the sketch plane',
  forward: 'true when the tool runs along the normal of the sketch plane from its start, false when against it',
} as const;

// ================================================================ what the package does not add

// - No upgrade step: a build without the package refuses an extent of a type it does not know
//   (`extrudeFeature` in document.ts lists the types), and the new variant lists its own fields,
//   so a later field of it will be refused by this build in turn.
// - No feature type, no face role, no command, no query.
