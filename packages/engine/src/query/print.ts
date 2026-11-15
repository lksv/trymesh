// The query `print` (D42): how a body prints in given orientations: its size against the bed,
// the area that lies on the bed and the area that overhangs, per named face.
import { coordinatePrecision } from '../mesh-distance';
import type { FaceName, Id, Solid, Truncated, Vec3 } from '../types';
import { ANGLE_TOLERANCE, cross3, dot3, len3, mul3, sub3 } from '../util';
import type { ArgSpecs, RunArgsOf } from './args';
import { type QueryContext, QueryFailure, type QuerySpec } from './spec';

// ---------------------------------------------------------------- the arguments

// - `bodies`: every body is a print of its own, judged in every orientation; without the
//   argument all bodies of the state. A body named twice is judged once.
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
//   nothing is said about fitting.
// - `overhang`: how far a face that looks down may lean from the vertical before it counts as
//   an overhang: 45° by default. A face at exactly this angle is not one.
// - `minArea`: overhangs of a face smaller than this are counted in the totals and not listed.
// - `maxFaces`: the most faces in each list of a body in an orientation (the faces on the bed,
//   the overhanging faces), the largest first.
// The answer is bounded by these arguments: a fixed size and at most twice `maxFaces` faces for
// every body in every orientation, at most twelve orientations, and the bodies asked about.
const BED_LENGTH = { title: 'Length of the printable space', unit: 'mm', min: { value: 0, open: true } } as const;
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
        by: {
          kind: 'oneOf',
          title: 'What is up',
          options: {
            up: { kind: 'vector', title: 'Direction', summary: 'The direction that is up, in the coordinates of the model' },
            onBed: { kind: 'entity', accepts: ['face'], title: 'Face on the bed', summary: 'A planar face that lies on the bed; up is the opposite of its normal out of the body' },
          },
        },
        turn: { kind: 'number', title: 'Turn', summary: 'About the vertical; it changes only the size along x and y', optional: true, spec: { title: 'Turn about the vertical', unit: 'rad', default: 0 } },
      },
    },
  },
  bed: {
    kind: 'fields',
    title: 'Bed',
    summary: 'The printable space in mm: x, y and the height.',
    optional: true,
    fields: { x: { kind: 'number', title: 'x', spec: BED_LENGTH }, y: { kind: 'number', title: 'y', spec: BED_LENGTH }, height: { kind: 'number', title: 'Height', spec: BED_LENGTH } },
  },
  overhang: { kind: 'number', title: 'Overhang angle', summary: 'From the vertical: a face that looks down and leans more than this is an overhang.', optional: true, spec: { title: 'Overhang angle from the vertical', unit: 'rad', min: { value: 0 }, max: { value: Math.PI / 2 }, default: Math.PI / 4 } },
  minArea: { kind: 'number', title: 'Smallest overhang listed', summary: 'A smaller overhang of a face is counted, not listed.', optional: true, spec: { title: 'Smallest overhang of a face that is listed', unit: 'mm2', min: { value: 0 }, default: 1 } },
  maxFaces: { kind: 'number', title: 'Most faces', summary: 'In each list, per body and orientation.', optional: true, spec: { title: 'Most faces in a list, per body and orientation', unit: 'count', integer: true, min: { value: 1 }, default: 20 } },
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
  contact: { area: number; count: number; faces: { face: FaceName; area: number }[] }; // mm2
  overhang: { area: number; count: number; small: number; faces: { face: FaceName; area: number; from: number }[] }; // mm2, mm
}
// - `bodies`: every body asked about, with its orientations in the order of the argument.
// - `truncated`: when `maxFaces` cut any list: the faces listed of the faces there were to list
//   (on the bed, and overhanging by at least `minArea`), over all bodies and orientations.
export interface PrintReport extends Truncated {
  angle: number; // rad: the overhang angle used
  bodies: { body: Id; orientations: PrintOrientation[] }[];
}

declare module './spec' {
  interface Queries {
    print: { spec: typeof PRINT_ARGS; result: PrintReport };
  }
}

// ---------------------------------------------------------------- the frame of an orientation

// The print frame of an orientation: x, y and up, unit vectors in the coordinates of the model,
// right-handed (x × y = up).
// - By a direction: x is the X axis of the model laid into the bed (its part across `up`), or
//   the Y axis when `up` is within 45° of X either way; y completes the frame. So the same
//   question gives the same box.
// - By a face: x is the x of the frame of the face.
// - `turn` then turns x and y about up.
export interface PrintFrame {
  x: Vec3;
  y: Vec3;
  up: Vec3;
}
const unit = (vector: Vec3): Vec3 => mul3(vector, 1 / len3(vector));
export function frameOfDirection(direction: Vec3): PrintFrame {
  const up = unit(direction);
  const axis: Vec3 = Math.abs(up[0]) > Math.SQRT1_2 ? [0, 1, 0] : [1, 0, 0];
  const x = unit(sub3(axis, mul3(up, dot3(axis, up))));
  return { x, y: cross3(up, x), up };
}
export function turned(frame: PrintFrame, turn: number): PrintFrame {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const mix = (a: Vec3, b: Vec3, p: number, q: number): Vec3 => [a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q];
  return { x: mix(frame.x, frame.y, c, s), y: mix(frame.x, frame.y, -s, c), up: frame.up };
}

// ---------------------------------------------------------------- the pass over triangles

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
//   (`coordinatePrecision` over the body).
//   - The direction is tested as well as the height: on a body thinner than the precision the
//     top and the sides are that low too.
//   - The face is judged as a whole, by its lowest corner, and not triangle by triangle with
//     every corner at the lowest point: that would ask a face of size L to be level within
//     `precision / L`, some hundred times tighter than `ANGLE_TOLERANCE`, and a direction typed
//     with five digits would turn the whole bottom face into an overhang.
// - What is not contact overhangs when it looks down and leans from the vertical by more than
//   `angle` plus `ANGLE_TOLERANCE`: a planar face as a whole, by its normal; a triangle of
//   another face by its own. The lean of a face is the angle of its normal below the horizontal:
//   nothing for a wall, a right angle for a ceiling.
// - `from`: the lowest corner of what overhangs of a face, above the lowest point of the body.
// A triangle without an area looks nowhere and adds nothing.
export interface PrintPass {
  size: Vec3;
  contact: Map<number, number>; // face → mm2
  overhang: Map<number, { area: number; from: number }>;
}
export function printPass(solid: Solid, frame: PrintFrame, angle: number, normalOf: (face: number) => Vec3 | undefined, precision: number): PrintPass {
  const { positions: p, triangles, faceIds } = solid;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  // the box in the frame
  const [low, high]: [Vec3, Vec3] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  const axes = [frame.x, frame.y, frame.up];
  for (let i = 0; i < p.length / 3; i++) {
    const point = at(i);
    for (let k = 0; k < 3; k++) {
      const along = dot3(point, axes[k]);
      low[k] = Math.min(low[k], along);
      high[k] = Math.max(high[k], along);
    }
  }
  const size: Vec3 = p.length ? [high[0] - low[0], high[1] - low[1], high[2] - low[2]] : [0, 0, 0];
  const bed = low[2]; // the height of the lowest point of the body

  // down by more than the overhang angle: the sine of the lean is the part of the normal along down
  const leans = (normal: Vec3): boolean => Math.asin(Math.min(1, Math.max(-1, -dot3(normal, frame.up)))) > angle + ANGLE_TOLERANCE;
  const straightDown = (normal: Vec3): boolean => dot3(normal, frame.up) < 0 && len3(cross3(normal, frame.up)) <= Math.sin(ANGLE_TOLERANCE);

  // per planar face: its area and its lowest corner; per other face: what overhangs of it
  const planar = new Map<number, { normal: Vec3; area: number; lowest: number }>();
  const overhang = new Map<number, { area: number; from: number }>();
  const normals = new Map<number, Vec3 | undefined>();
  for (let t = 0; t < faceIds.length; t++) {
    const face = faceIds[t];
    const [a, b, c] = [at(triangles[3 * t]), at(triangles[3 * t + 1]), at(triangles[3 * t + 2])];
    const own = cross3(sub3(b, a), sub3(c, a));
    const doubled = len3(own);
    if (!(doubled > 0)) continue;
    const area = doubled / 2;
    const lowest = Math.min(dot3(a, frame.up), dot3(b, frame.up), dot3(c, frame.up));
    if (!normals.has(face)) normals.set(face, normalOf(face));
    const normal = normals.get(face);
    if (normal) {
      const whole = planar.get(face);
      if (whole) [whole.area, whole.lowest] = [whole.area + area, Math.min(whole.lowest, lowest)];
      else planar.set(face, { normal, area, lowest });
    } else if (leans(mul3(own, 1 / doubled))) {
      const part = overhang.get(face);
      if (part) [part.area, part.from] = [part.area + area, Math.min(part.from, lowest - bed)];
      else overhang.set(face, { area, from: lowest - bed });
    }
  }
  const contact = new Map<number, number>();
  for (const [face, whole] of planar) {
    if (straightDown(whole.normal) && whole.lowest - bed <= precision) contact.set(face, whole.area);
    else if (leans(whole.normal)) overhang.set(face, { area: whole.area, from: whole.lowest - bed });
  }
  return { size, contact, overhang };
}

// ---------------------------------------------------------------- the entry

type Orientation = RunArgsOf<typeof PRINT_ARGS>['orientations'][number];

// What is up in an orientation, and for one given by a face, which face of which body it was.
// A face is resolved through the context, so its frame is in the pose the query is asked about
// and its normal points out of the body.
interface Placed {
  frame: PrintFrame;
  onBed?: { body: Id; face: number };
}
function placedOf(context: QueryContext, orientation: Orientation, index: number): Placed {
  const { by } = orientation;
  if (by.up) {
    if (!(Math.hypot(...by.up) > 0)) throw new QueryFailure('invalidArguments', `orientations[${index}].by.up: a direction needs a length`, ['orientations', index, 'by', 'up']);
    return { frame: turned(frameOfDirection(by.up), orientation.turn) };
  }
  const at = ['orientations', index, 'by', 'onBed'];
  const face = context.frame({ kind: 'face', body: by.onBed.body, face: by.onBed.face });
  const number = context.face(by.onBed.face);
  if ('problem' in face || number === undefined) {
    throw new QueryFailure('notAvailable', `orientations[${index}].by.onBed: ${'problem' in face && face.problem === 'nonPlanarFace' ? 'the face is not planar: only a planar face can lie on the bed' : 'the face is not in the state asked about'}`, at);
  }
  const up: Vec3 = [0 - face.normal[0], 0 - face.normal[1], 0 - face.normal[2]];
  return { frame: turned({ x: face.x, y: cross3(up, face.x), up }, orientation.turn), onBed: { body: by.onBed.body, face: number } };
}

export const print: QuerySpec<typeof PRINT_ARGS, PrintReport> = {
  title: 'Print check',
  summary:
    'How a body prints in given orientations: its size against the bed, the area that lies on the bed and the area that overhangs, per named face. Several orientations in one call can be compared. An orientation is a direction that is up, or the planar face that lies on the bed. It does not know bridges, wall thickness or supports.',
  returns:
    '`angle`: the overhang angle used (rad). `bodies`: for every body its `orientations` in the order asked, each with `up` (unit vector), `size` (mm: x, y, height in the print frame), `fits` (with a bed; the footprint either way round), ' +
    '`onBed` (for an orientation given by a face, on the body of that face: whether the face lies on the bed; false when something of the body reaches below it), ' +
    '`contact` (`area` in mm2 and `count` of all planar faces that look straight down and reach the lowest point of the body; `faces`: the largest, with their areas; a round face never counts) and ' +
    '`overhang` (`area` in mm2 and `count` of all faces that look down and lean from the vertical by more than the angle; `small`: how many of them are below `minArea` and not listed; `faces`: the others, the largest first, each with `area` and `from`, the height in mm above the bed where it starts). ' +
    'Each list holds at most `maxFaces` faces, so the answer is at most 2 × `maxFaces` faces per body and orientation; `truncated` when `maxFaces` cut any list.',
  args: PRINT_ARGS,
  units: { angle: 'rad', size: 'mm', area: 'mm2', from: 'mm' },
  run(context, args) {
    const { bed } = args; // three lengths above zero: the description says so and the check of the arguments made sure
    const placed = args.orientations.map((orientation, index) => placedOf(context, orientation, index));
    const names = context.state.evaluation.faceNames;
    let [shown, total] = [0, 0];
    // a list cut to `maxFaces`, counted
    const listed = <T>(list: T[]): T[] => {
      shown += Math.min(list.length, args.maxFaces);
      total += list.length;
      return list.slice(0, args.maxFaces);
    };
    // the largest first; faces of one area in the order of their numbers
    const bySize = <T extends { area: number; number: number }>(a: T, b: T): number => b.area - a.area || a.number - b.number;
    const bodies = [...new Set(args.bodies ?? Object.keys(context.bodies))].map((id) => {
      const body = context.bodies[id]; // from the context: the same code answers for a pose
      const precision = coordinatePrecision(body);
      // the normal of a planar face, out of the body; undefined for a face that is not planar
      const planar = new Set(body.faces.filter((face) => face.planar).map((face) => face.id));
      const normalOf = (face: number): Vec3 | undefined => {
        if (!planar.has(face)) return undefined;
        const frame = context.frame({ kind: 'face', body: id, face: names[face] });
        return 'problem' in frame ? undefined : frame.normal;
      };
      const orientations = placed.map(({ frame, onBed }): PrintOrientation => {
        const pass = printPass(body.solid, frame, args.overhang, normalOf, precision);
        const [width, depth, height] = pass.size;
        // a body exactly as large as the bed fits: its size is known to the precision of the coordinates
        const within = (length: number, room: number): boolean => length <= room + precision;
        const fits = bed && within(height, bed.height) && ((within(width, bed.x) && within(depth, bed.y)) || (within(width, bed.y) && within(depth, bed.x)));
        const contact = [...pass.contact].map(([number, area]) => ({ number, area })).sort(bySize);
        const over = [...pass.overhang].map(([number, value]) => ({ number, ...value })).sort(bySize);
        const large = over.filter((entry) => entry.area >= args.minArea);
        return {
          up: [frame.up[0] + 0, frame.up[1] + 0, frame.up[2] + 0],
          size: pass.size,
          ...(fits === undefined ? {} : { fits }),
          // from the pass, not from the list: the list may be cut
          ...(onBed?.body === id ? { onBed: pass.contact.has(onBed.face) } : {}),
          contact: { area: contact.reduce((sum, entry) => sum + entry.area, 0), count: contact.length, faces: listed(contact).map(({ number, area }) => ({ face: names[number], area })) },
          overhang: { area: over.reduce((sum, entry) => sum + entry.area, 0), count: over.length, small: over.length - large.length, faces: listed(large).map(({ number, area, from }) => ({ face: names[number], area, from })) },
        };
      });
      return { body: id, orientations };
    });
    return { angle: args.overhang, bodies, ...(shown < total ? { truncated: { shown, total } } : {}) };
  },
};
