// Contract of package 2c (D46): the hole feature and the hardware catalogs. A draft for review,
// only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the
// engine and the shared types of the preparatory step and states what the package adds:
// a feature type with its patch, four face roles, an issue code, five data catalogs and a query.

import type { FeatureBase, Id, Input, NumberSpec, Patch } from '../../../packages/engine/src/index';
import type { ArgSpecs } from '../00-prep/contract';
import { FACE_ROLES } from '../00-prep/contract';
import type { PlainDistanceExtent } from '../2a-offset/contract';

// ================================================================ the feature

// The shape of one hole, a variant by kind. Every dimension is a numeric field (`shape/<name>`),
// so it takes an expression; a print compensation is a parameter added in it.
// The wider part (the head) is at the mouth of the hole, where the extent starts.
// - `plain`: a cylinder.
// - `counterbore`: a cylinder for the head (`headDiameter`, `headDepth`), then the bore.
// - `countersink`: a cone from `headDiameter` at the mouth down to the bore; `angle` is the
//   included angle of the cone (π/2 for a cone of 90°). The depth of the cone follows from the three.
// - `nutPocket`: a hexagon `acrossFlats` wide and `headDepth` deep, then the bore. `rotation` is
//   the angle of one corner of the hexagon from the X axis of the sketch, counter-clockwise.
export type HoleShape =
  | { type: 'plain'; diameter: number }
  | { type: 'counterbore'; diameter: number; headDiameter: number; headDepth: number }
  | { type: 'countersink'; diameter: number; headDiameter: number; angle: number }
  | { type: 'nutPocket'; diameter: number; acrossFlats: number; headDepth: number; rotation: number };

// The extent of a hole: two of the variants of a cut, without what does not fit a hole.
// - `distance`: `start` is the offset of the mouth from the sketch plane along its normal;
//   `distance` is the depth of the whole hole, head included, and its sign is the direction
//   (negative goes against the normal, which is into the body for a sketch on a face).
// - `throughAll`: from the sketch plane through all targets, `forward` or `backward`. Not `both`:
//   a hole has a mouth. The depth of the hole is then how far the targets reach from the sketch
//   plane on that side; the tool is longer by the overshoot of every "through all", which is
//   not part of the depth.
// No taper (2b) and no `upTo` (2f, deferred for holes).
export type HoleExtent = PlainDistanceExtent | { type: 'throughAll'; side: 'forward' | 'backward' };

// One feature makes the same hole at every listed point of one sketch, along the normal of the
// sketch plane, and cuts it out of the targets.
// - `points`: points of the sketch that are not projected geometry (its own points or its
//   `origin`), at least one, none twice. Their order does not matter to the result; face names
//   carry the point.
// - `targets`: one or more bodies, like a cut.
// - `label`: free text for people and for the parts list ("M3 countersunk screw"); the engine
//   never reads a dimension from it.
// - The feature keeps a tool recipe, so a pattern repeats it like a cut.
export interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  points: Id[];
  shape: HoleShape;
  extent: HoleExtent;
  targets: Id[];
  label?: string;
}
// What `updateFeature` may change. A shape with the same `type` merges by field, another `type`
// replaces it and has to be complete; `label: null` removes the label.
export type HolePatch = Patch<Pick<HoleFeature, 'sketch' | 'points' | 'shape' | 'extent' | 'targets' | 'label'>>;

// The numeric fields of the shape, as the registry describes them (`shape/<name>`).
const POSITIVE = { unit: 'mm', min: { value: 0, open: true } } as const;
export const HOLE_FIELDS = {
  diameter: { title: 'Diameter', ...POSITIVE },
  headDiameter: { title: 'Head diameter', ...POSITIVE },
  headDepth: { title: 'Head depth', ...POSITIVE },
  angle: { title: 'Angle of the countersink', unit: 'rad', min: { value: 0, open: true }, max: { value: Math.PI, open: true } },
  acrossFlats: { title: 'Across flats', ...POSITIVE },
  rotation: { title: 'Rotation', unit: 'rad' },
} as const satisfies Record<string, NumberSpec>;

// What the result of the feature publishes in `facts`.
export const HOLE_FACTS = {
  headDepth: 'the depth of the head along the hole in mm: given for a counterbore and a nut pocket, computed for a countersink; absent for a plain hole',
  depth: 'the depth of the whole hole in mm for the feature itself, not for its copies (for "through all": how far the targets reach from the mouth, without the overshoot of the tool; measured on the meshes of the targets, so with their float32 rounding)',
} as const;

// ================================================================ the unions

declare module '../00-prep/contract' {
  interface FeatureTypes {
    hole: HoleFeature;
  }
  interface FeaturePatches {
    hole: HolePatch;
  }
  // The faces of a hole are named by what they are, not by a count of sections, so that the bore
  // keeps its name when a plain hole becomes a counterbore.
  // - `holeBore`: the bore at the point (a cylinder).
  // - `holeHead`: the side of the head at the point: the cylinder of a counterbore, the cone of
  //   a countersink.
  // - `holeFlat`: one side of the hexagon of a nut pocket (a plane). `flat` counts from 1,
  //   counter-clockwise, starting at the corner `rotation` points to.
  // - `holeSeat`: the planar step between head and bore. The seats of all points of one feature
  //   lie in one plane and are one face, as the caps of an extrusion are.
  // The mouth and the bottom are `startCap` and `endCap`, one face each for all points.
  interface FaceRoles {
    holeBore: { point: Id };
    holeHead: { point: Id };
    holeFlat: { point: Id; flat: number };
    holeSeat: {};
  }
  // `invalidHole`, an error: the dimensions do not make a hole.
  // - the head is not wider than the bore (for a nut pocket: the bore does not fit between the flats);
  // - the head is as deep as the hole or deeper. For "through all" the hole is as deep as the
  //   targets reach from the mouth, and the overshoot of the tool does not count; the bore has
  //   to be left more than the resolution of the kernel (1e-4 of the largest coordinate) of
  //   that reach. Whether a head that is too deep is this error is decided by what its tool
  //   did: if it cut a target, it is; if it changed none (the targets do not pass the mouth),
  //   the feature has the warning `noEffect`, as a cut that misses.
  //   The reach is that of the whole targets, not of the material under each point: a head that
  //   passes through a thin plate of a body that reaches deeper elsewhere is not detected.
  // - two points are so close that their holes would overlap; `refs` name the points.
  interface IssueCodes {
    invalidHole: true;
  }
  interface Catalogs {
    clearanceHoles: ClearanceHoleRow;
    socketHeadScrews: SocketHeadScrewRow;
    countersunkScrews: CountersunkScrewRow;
    hexNuts: HexNutRow;
    heatSetInserts: HeatSetInsertRow;
  }
  interface Queries {
    hardwareHole: { spec: typeof HARDWARE_HOLE_ARGS; result: HardwareHole };
  }
}

export const HOLE_ROLES: Pick<typeof FACE_ROLES, 'holeBore' | 'holeHead' | 'holeFlat' | 'holeSeat'> = {
  holeBore: { title: 'Bore of a hole', parts: { point: { title: 'Point', kind: 'text' } } },
  holeHead: { title: 'Head of a hole', parts: { point: { title: 'Point', kind: 'text' } } },
  holeFlat: { title: 'Flat of a nut pocket', parts: { point: { title: 'Point', kind: 'text' }, flat: { title: 'Flat, from 1', kind: 'integer' } } },
  holeSeat: { title: 'Seat of a hole', parts: {} },
};

// ================================================================ the catalogs

// One catalog per standard, so that `source` names one document and no row has an empty cell
// (the standards do not cover the same sizes). Rows are keyed by the thread, "M3"; `thread` is
// its nominal diameter. Lengths in millimetres, the angle in radians. The numbers are typed in
// from the sources named in design.md, never from memory.
//
// The columns are a proposal, written without the standards at hand: what a hole needs from
// each. Whether a standard has exactly these (three series of clearance holes; one head angle
// per size; a largest head diameter) is confirmed when its text is read, and a column that
// does not match is changed then, with the branch of `hardwareHole` that reads it.
export interface ClearanceHoleRow {
  thread: number;
  fine: number; // three series of clearance holes, tightest first; names and count to confirm
  medium: number;
  coarse: number;
}
export interface SocketHeadScrewRow {
  thread: number;
  headDiameter: number; // the largest the standard allows: a counterbore has to take it
  headHeight: number;
}
export interface CountersunkScrewRow {
  thread: number;
  headDiameter: number; // the largest the standard allows
  headAngle: number; // the included angle of the head
}
export interface HexNutRow {
  thread: number;
  acrossFlats: number; // the largest the standard allows
  thickness: number;
}
// No standard: typical values of one named maker's data sheet, and the catalog says so.
export interface HeatSetInsertRow {
  thread: number;
  holeDiameter: number;
  holeDepth: number; // the least depth of the hole
  length: number;
}

// ================================================================ the query

// What composes a hole from the catalogs: the tool the backlog asks for, as a query, so that the
// app's form and an AI through the tool `query` fill the fields the same way. It reads no state.
// - `use`: what the hole is for. `clearance`: a plain hole for the thread. `socketHead`:
//   a counterbore for a socket head cap screw. `countersunk`: a countersink for a countersunk
//   screw. `nutPocket`: a pocket for a hex nut with a clearance hole. `heatSetInsert`: a plain
//   hole for an insert, with its depth.
// - `size`: a row of the catalogs. A size a catalog does not have answers `notAvailable`.
// - `fit`: the clearance series of the through hole, `medium` when left out.
// - `allowance`: an expression added to every diameter and to the size across flats, such as the
//   name of a parameter that compensates the printer. With it those fields come back as
//   expressions (the number of the catalog, " + ", the allowance); without it as numbers.
// - The angle of a countersink always comes back as an expression in degrees ("deg(…)"), so
//   that it survives the rounding of a tool's answer (six decimal places) and a person reads
//   the angle the standard prints.
export const HARDWARE_HOLE_ARGS = {
  use: { kind: 'choice', options: ['clearance', 'socketHead', 'countersunk', 'nutPocket', 'heatSetInsert'], title: 'What the hole is for' },
  size: { kind: 'text', title: 'Size', summary: 'A row of the catalogs, such as "M3".' },
  fit: { kind: 'choice', options: ['fine', 'medium', 'coarse'], title: 'Clearance series of the through hole', summary: 'Without it medium.', optional: true },
  allowance: { kind: 'text', title: 'Allowance', summary: 'An expression added to every diameter and to the size across flats.', optional: true },
} as const satisfies ArgSpecs;
export interface HardwareHole {
  shape: Input<HoleShape>; // goes into `shape` of a hole feature as it is
  label: string; // "M3 countersunk screw"
  depth?: number; // heatSetInsert: the least depth of the hole, for `extent.distance`
  from: string[]; // the catalogs the numbers came from, by name
}

// ================================================================ what the package does not add

// - No upgrade step: a build without the package refuses a feature of a type it does not know.
// - No command: the feature is added, changed and removed by the commands of every feature.
// - No section of the document: the label and the numbers are in the feature.
