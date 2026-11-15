// Contract of package 1e of D36 (decision D42): print queries. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.

import type { Id, Solid, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, FaceNameAfter, Truncated } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the arguments

// - `bodies`: every body is a print of its own, judged in every orientation; without the
//   argument all bodies of the state.
// - `orientations`: one to twelve ways to put a body on the bed. Each says what is up:
//   - `up`: a direction in the coordinates of the model (it need not be a unit vector);
//   - `onBed`: a planar face: "this face lies on the bed". A surface has no side; the frame of
//     a face has its normal pointing out of the body, and up is the opposite of it. The face
//     gives the direction for every body of the call; for the body it belongs to, the answer
//     shows whether the face really is the contact (something of the body may reach below it).
//   `turn` turns the body about the vertical. It changes only the size along x and y, for
//   a part that fits the bed only one way round.
// - `bed`: the printable space as three lengths: x, y and the height. Without it nothing is
//   said about fitting.
// - `overhang`: how far a face that looks down may lean from the vertical before it counts as
//   an overhang: 45° by default. A face at exactly this angle is not one.
// - `minArea`: overhangs of a face smaller than this are counted in the totals and not listed.
// - `maxFaces`: the most faces listed per body and orientation, the largest overhang first.
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
  bed: { kind: 'vector', title: 'Bed', summary: 'The printable space in mm: x, y and the height.', optional: true },
  overhang: { kind: 'number', title: 'Overhang angle', summary: 'From the vertical.', optional: true, spec: { title: 'Overhang angle from the vertical', unit: 'rad', min: { value: 0 }, max: { value: Math.PI / 2 }, default: Math.PI / 4 } },
  minArea: { kind: 'number', title: 'Smallest overhang listed', optional: true, spec: { title: 'Smallest overhang of a face that is listed', unit: 'mm2', min: { value: 0 }, default: 1 } },
  maxFaces: { kind: 'number', title: 'Most faces', optional: true, spec: { title: 'Most faces listed per body and orientation', unit: 'count', integer: true, min: { value: 1 }, default: 20 } },
} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// One body in one orientation. The print frame has z up and the bed at the lowest point of the
// body.
// - `up`: the direction that is up, a unit vector in the coordinates of the model.
// - `size`: the box of the body in the print frame: along x, along y, and the height.
// - `fits`, with a bed: the height is within the bed's and the footprint within its x and y,
//   either way round (a quarter turn is free).
// - `contact`: the area that lies on the bed, per face. Only planar faces count: a cylinder on
//   its side touches the bed in a line, and the facet its polygon rests on is not a contact.
// - `overhang`: what looks down and leans more than the overhang angle from the vertical, and is
//   not contact. `area` and `count` are of all faces; `faces` lists the ones of at least
//   `minArea`, the largest first, at most `maxFaces`. `from`: the height above the bed where
//   the overhang of that face starts.
export interface PrintOrientation {
  up: Vec3;
  size: Vec3; // mm
  fits?: boolean;
  contact: { area: number; faces: { face: FaceNameAfter; area: number }[] }; // mm2
  overhang: { area: number; count: number; faces: { face: FaceNameAfter; area: number; from: number }[] }; // mm2, mm
}
// - `bodies`: every body asked about, with its orientations in the order of the argument.
// - `truncated`: when `maxFaces` cut a list: faces listed of faces that had at least `minArea`.
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
// - A triangle is contact when its face is planar (`planar` says which), it looks straight down
//   within `ANGLE_TOLERANCE`, and all its corners are within the precision of the coordinates
//   (1e-5 of the largest coordinate of the body, at least 1e-5 mm) of the lowest point.
// - Otherwise it overhangs when it looks down and leans from the vertical by more than `angle`
//   plus `ANGLE_TOLERANCE`.
export interface PrintPass {
  size: Vec3;
  contact: Map<number, number>; // face → mm2
  overhang: Map<number, { area: number; from: number }>;
}
export declare function printPass(solid: Solid, frame: PrintFrame, angle: number, planar: (face: number) => boolean): PrintPass;
