// Contract of package 1e of D36 (decision D42): print queries. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.
//
// Fourth version, after the third and last round of reviews (design.md, "Reviews").
//
// As implemented (design.md, "As implemented"): the types and the pass are in
// packages/engine/src/query/print.ts; a face that is not planar is `notAvailable`, a direction
// without a length `invalidArguments`, and the nested arguments have titles.

import type { Id, Solid, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, FaceNameAfter, QuantitySpec, Truncated } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the arguments

// - `bodies`: every body is a print of its own, judged in every orientation; without the
//   argument all bodies of the state.
// - `orientations`: one to twelve ways to put a body on the bed. Each says what is up:
//   - `up`: a direction in the coordinates of the model (it need not be a unit vector);
//   - `onBed`: a planar face: "this face lies on the bed". A surface has no side; the frame of
//     a face has its normal pointing out of the body, and up is the opposite of it. The face
//     gives the direction for every body of the call; for the body it belongs to, the answer
//     says whether the face really lies on the bed (`onBed`: something of the body may reach
//     below it).
//   `turn` turns the body about the vertical. It changes only the size along x and y, for
//   a part that fits the bed only one way round.
// - `bed`: the printable space as three lengths above zero: x, y and the height. Without it
//   nothing is said about fitting. Three named numbers and not a `vector`, so that the range is
//   in the description and is checked before `run`.
// - `overhang`: how far a face that looks down may lean from the vertical before it counts as
//   an overhang: 45° by default. A face at exactly this angle is not one.
// - `minArea`: overhangs of a face smaller than this are counted in the totals and not listed.
// - `maxFaces`: the most faces in each list of a body in an orientation (the faces on the bed,
//   the overhanging faces), the largest first.
// The answer is bounded by these arguments: a fixed size and at most twice `maxFaces` faces for
// every body in every orientation, at most twelve orientations, and the bodies asked about.
const BED_LENGTH = { title: 'Length of the printable space', unit: 'mm', min: { value: 0, open: true } } as const satisfies QuantitySpec;
export const PRINT_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Each is a print of its own; without it all bodies.', optional: true },
  orientations: {
    kind: 'list',
    min: 1,
    max: 12,
    title: 'Orientations',
    summary: 'Each says what is up, by a direction or by the face that lies on the bed.',
    of: {
      kind: 'fields',
      fields: {
        by: { kind: 'oneOf', options: { up: { kind: 'vector' }, onBed: { kind: 'entity', accepts: ['face'] } } },
        turn: { kind: 'number', optional: true, spec: { title: 'Turn about the vertical', unit: 'rad', default: 0 } },
      },
    },
  },
  bed: {
    kind: 'fields',
    title: 'Bed',
    summary: 'The printable space in mm: x, y and the height.',
    optional: true,
    fields: { x: { kind: 'number', spec: BED_LENGTH }, y: { kind: 'number', spec: BED_LENGTH }, height: { kind: 'number', spec: BED_LENGTH } },
  },
  overhang: { kind: 'number', title: 'Overhang angle', summary: 'From the vertical.', optional: true, spec: { title: 'Overhang angle from the vertical', unit: 'rad', min: { value: 0 }, max: { value: Math.PI / 2 }, default: Math.PI / 4 } },
  minArea: { kind: 'number', title: 'Smallest overhang listed', optional: true, spec: { title: 'Smallest overhang of a face that is listed', unit: 'mm2', min: { value: 0 }, default: 1 } },
  maxFaces: { kind: 'number', title: 'Most faces', optional: true, spec: { title: 'Most faces in a list, per body and orientation', unit: 'count', integer: true, min: { value: 1 }, default: 20 } },
} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// One body in one orientation. The print frame has z up and the bed at the lowest point of the
// body.
// - `up`: the direction that is up, a unit vector in the coordinates of the model.
// - `size`: the box of the body in the print frame: along x, along y, and the height.
// - `fits`, with a bed: the height is within the bed's and the footprint within its x and y,
//   either way round (a quarter turn is free).
// - `onBed`, for an orientation given by a face and the body that face belongs to: whether the
//   face lies on the bed. False when something of the body reaches below it. It does not depend
//   on what the list of contact faces shows.
// - `contact`: the area that lies on the bed: the planar faces that look straight down (within
//   `ANGLE_TOLERANCE`) and reach the lowest point of the body. Only planar faces count:
//   a cylinder on its side touches the bed in a line, and the facet its polygon rests on is not
//   a contact. `area` and `count` are of all faces on the bed; `faces` lists the largest, at
//   most `maxFaces`.
// - `overhang`: what looks down and leans more than the overhang angle from the vertical, and is
//   not contact. `area` and `count` are of all overhanging faces; `small` of them are below
//   `minArea` and not listed for that reason; `faces` lists the others, the largest first, at
//   most `maxFaces`. `from`: the height above the bed where the overhang of that face starts.
// A list was cut by `maxFaces` when it is shorter than its count says: `contact.faces` than
// `contact.count`, `overhang.faces` than `overhang.count − overhang.small`.
export interface PrintOrientation {
  up: Vec3;
  size: Vec3; // mm
  fits?: boolean;
  onBed?: boolean;
  contact: { area: number; count: number; faces: { face: FaceNameAfter; area: number }[] }; // mm2
  overhang: { area: number; count: number; small: number; faces: { face: FaceNameAfter; area: number; from: number }[] }; // mm2, mm
}
// - `bodies`: every body asked about, with its orientations in the order of the argument.
// - `truncated`: when `maxFaces` cut any list: the faces listed of the faces there were to list
//   (on the bed, and overhanging by at least `minArea`), over all bodies and orientations.
export interface PrintReport extends Truncated {
  angle: number; // rad: the overhang angle used
  bodies: { body: Id; orientations: PrintOrientation[] }[];
}

declare module '../00-prep/contract' {
  interface Queries {
    print: { spec: typeof PRINT_ARGS; result: PrintReport };
  }
}
export const PRINT_UNITS = { angle: 'rad', size: 'mm', area: 'mm2', from: 'mm' } as const satisfies ResultUnits;

// ---------------------------------------------------------------- the pass over triangles

// The print frame of an orientation: x, y and up, unit vectors in the coordinates of the model.
// - By a direction: x is the X axis of the model laid into the bed (its part across `up`), or
//   the Y axis when `up` is within 45° of X; y completes the frame.
// - By a face: x is the x of the frame of the face.
// - `turn` then turns x and y about up.
export interface PrintFrame {
  x: Vec3;
  y: Vec3;
  up: Vec3;
}

// One pass over the triangles of a body: its box in the frame, and per face the area in contact
// with the bed and the area that overhangs with the height it starts at.
// - `normalOf`: the normal of a planar face, out of the body (from `context.frame`); undefined
//   for a face that is not planar, and for a planar face the context gives no frame for (its
//   triangles are then judged one by one, like those of a round face). A triangle of a planar
//   face looks where its face looks; only a triangle of another face is judged by its own
//   normal. A long thin triangle of a flat face has a normal that float32 coordinates spoil by
//   more than `ANGLE_TOLERANCE` once the body is not aligned with the axes of the model, and
//   the face is known exactly.
// - A planar face is contact as a whole, with all its area, when it looks straight down (its
//   normal against `up` within `ANGLE_TOLERANCE`) and its lowest corner is within `precision`
//   of the lowest point of the body. `precision` is the precision of the coordinates
//   (`coordinatePrecision` of 1b over the body).
//   - The direction is tested as well as the height: on a body thinner than the precision the
//     top and the sides are that low too.
//   - The face is judged as a whole, by its lowest corner, and not triangle by triangle with
//     every corner at the lowest point: that would ask a face of size L to be level within
//     `precision / L`, some hundred times tighter than `ANGLE_TOLERANCE`, and a direction typed
//     with five digits would turn the whole bottom face into an overhang.
// - A triangle that is not contact overhangs when it looks down and leans from the vertical by
//   more than `angle` plus `ANGLE_TOLERANCE`.
export interface PrintPass {
  size: Vec3;
  contact: Map<number, number>; // face → mm2
  overhang: Map<number, { area: number; from: number }>;
}
export declare function printPass(solid: Solid, frame: PrintFrame, angle: number, normalOf: (face: number) => Vec3 | undefined, precision: number): PrintPass;
