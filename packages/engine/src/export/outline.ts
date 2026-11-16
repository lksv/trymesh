// The outline a plane cuts out of bodies (D54), as loops a drawing is written from: one function
// for both `dxf` and `svg`, so the two files always show the same shape. (The engine also says
// "outline" for the exact outline of a profile, `ResolvedProfile.outline`; this is the outline of
// a cut.)
//
// The source is the query `section`: its `run` with the context of the export, the spans of every
// loop and a budget no model reaches. What the query says about its cut holds: it is taken `below`
// the plane, so a face as the plane gives all the material of its body just under the face; a body
// with a face in the plane is in `inPlane`; an outer loop runs counter-clockwise and a hole
// clockwise.
//
// A loop of one arc span is a whole circle and is written as one, with the centre and radius of
// the surface. Every other loop is a chain of pieces, each from a corner to the next:
// - a line span is one straight piece;
// - a curve span is straight pieces through its points;
// - an arc span is `max(2, ceil(|sweep| / QUARTER − TURN_SLACK))` pieces at equal steps of its
//   sweep about the centre of the surface. The first starts at `from` and the last ends at `to`,
//   corners of the mesh; the corners between are on the circle of the surface. Every piece is the
//   arc of the radius of the surface between its two corners; the angle it turns by follows from
//   them. With at least two pieces of a quarter turn at most no piece has both its ends at corners
//   of the mesh, which may lie inside the circle by up to the sagitta of its polygon, and a piece
//   with one end on the circle and the other `s` inside stays within `s` of the circle (design.md
//   of 2g, "The pieces of a loop"). One arc per span would put the centre of a half turn tenths of
//   a millimetre off.
import type { ArgSpecs, RunArgsOf } from '../query/args';
import { section } from '../query/section';
import type { SectionLoop, SectionResult } from '../query/section';
import type { QueryContext } from '../query/spec';
import type { FaceName, Frame, Id, Vec2 } from '../types';
import { chosenBodies } from './bodies';

// The options of `dxf` and `svg`. The names are those of the arguments of `section`, so a refusal
// of the section names the same option (`['plane']`).
export const OUTLINE_OPTIONS = {
  plane: { kind: 'plane', title: 'Plane', summary: 'A base plane, a plane feature or a planar face. The drawing is what the plane cuts out of the bodies, seen against its normal (a face is seen from outside its body).' },
  offset: { kind: 'number', title: 'Offset', summary: 'Moves the plane along its normal; for a face a negative offset cuts into the body. Without it a face gives the cut just under it, and a body that only stands on the plane gives nothing.', optional: true, spec: { title: 'Offset along the normal', unit: 'mm', default: 0 } },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Only these, each once, whatever their use. Without it: the body of the face when the plane is a face, otherwise the printed bodies (use `part`).', optional: true },
} as const satisfies ArgSpecs;

// What `about` of a drawing says (a type alias, so it is assignable to `ExportFile.about`):
// - `bodies`: the bodies the plane cuts, in the order they were taken;
// - `loops`: all closed loops of the drawing; `circles`: how many of them are whole circles;
// - `area`: mm², of the section as the mesh gives it (the number of the query `section`);
// - `bounds`: the box of what is drawn, in the x and y of `frame`; absent when nothing is cut;
// - `frame`: the plane as it was asked for, after the offset;
// - `below`: how far under that plane the cut was taken; a point (u, v) of the drawing stands for
//   `origin + x·u + y·v − normal·below` of the model;
// - `inPlane`: bodies with a planar face in the plane, as `section` reports them; only when there
//   are some.
export type OutlineAbout = {
  bodies: Id[];
  loops: number;
  circles: number;
  area: number;
  bounds?: { min: Vec2; max: Vec2 };
  frame: Frame;
  below: number;
  inPlane?: { body: Id; face: FaceName }[];
};

// The texts of `empty` of a drawing that holds nothing; a list of bodies that is empty has those
// of `chosenBodies`.
export const NOT_CUT = 'the plane cuts none of the bodies';
export const notCutInPlane = (body: Id): string => `the plane cuts none of the bodies; "${body}" has a face in the plane and lies on the side the normal of the plane points to: move \`offset\` into the body`;

// A piece of a loop starts at the corner `at` and runs to the corner of the next piece (the last
// one to the first corner). `turn` 0: a straight piece. Otherwise one arc: the arc of the radius
// `radius` (that of the surface) between the two corners, on the side that makes it turn the way
// the span does and by less than a half turn; `turn` is the angle it turns by about its own
// centre, `±2·asin(min(1, chord / (2·radius)))`, positive counter-clockwise. A piece spans a
// quarter turn at most about the centre of the surface; its own turn differs from that by about
// the distance of its end from the circle over the radius (`TURN_ALLOWANCE` for a check).
// DXF writes the turn (as a bulge), SVG the radius: the same arc.
export interface OutlinePiece {
  at: Vec2;
  turn: number;
  radius?: number; // with a `turn` other than 0
}
// `circle`: a whole circle with the centre and radius of its exact surface; it has no pieces.
// Otherwise `pieces`, at least two. `hole`: a hole of a region (it runs clockwise).
export interface OutlineLoop {
  body: Id;
  hole: boolean;
  circle?: { center: Vec2; radius: number };
  pieces: OutlinePiece[];
}
// The loops in the order of the answer of `section`: body by body, region by region, the outer
// loop of a region before its holes.
export interface Outline {
  loops: OutlineLoop[];
  about: OutlineAbout;
  empty?: string;
}

export const QUARTER = Math.PI / 2;
// A sweep this close to a whole number of quarters gets no extra piece: a half turn summed from
// its angles is π give or take the last digit, and its number of pieces must not depend on it.
export const TURN_SLACK = 1e-9; // of a quarter turn
// How far over a quarter turn the `turn` of an end piece may come out, as a part of it, through the
// precision of the coordinates of its end. For a check; the writer does not use it.
export const TURN_ALLOWANCE = 1e-6;

// The number of pieces of an arc span of this sweep.
export const piecesOfArc = (sweep: number): number => Math.max(2, Math.ceil(Math.abs(sweep) / QUARTER - TURN_SLACK));

// A box that grows by the points it reaches.
class Box {
  readonly min: Vec2 = [Infinity, Infinity];
  readonly max: Vec2 = [-Infinity, -Infinity];
  reach(p: Vec2): void {
    for (const k of [0, 1]) {
      this.min[k] = Math.min(this.min[k], p[k]);
      this.max[k] = Math.max(this.max[k], p[k]);
    }
  }
  // An arc piece from `a` to `b`: its two ends and the points of its own circle furthest along x
  // and y that it passes.
  reachArc(a: Vec2, b: Vec2, radius: number, turn: number): void {
    this.reach(a);
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const chord = Math.hypot(dx, dy);
    if (chord === 0) return;
    const side = Math.sign(turn); // the centre is on the left of the chord of a piece that turns counter-clockwise
    const apothem = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
    const center: Vec2 = [(a[0] + b[0]) / 2 - (side * dy * apothem) / chord, (a[1] + b[1]) / 2 + (side * dx * apothem) / chord];
    const from = Math.atan2(a[1] - center[1], a[0] - center[0]);
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = quarter * QUARTER;
      const gone = ((((angle - from) * side) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // how far the piece has turned when it gets there
      if (gone <= Math.abs(turn)) this.reach([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
    }
  }
}

// The pieces of one loop of the section; `box` grows by what is drawn.
function loopOf(body: Id, loop: SectionLoop, hole: boolean, box: Box): OutlineLoop {
  const spans = loop.spans;
  if (!spans) throw new Error('the outline: the section left the spans of a loop out');
  if (spans.length === 1 && spans[0].kind === 'arc') {
    const { center, radius } = spans[0];
    box.reach([center[0] - radius, center[1] - radius]);
    box.reach([center[0] + radius, center[1] + radius]);
    return { body, hole, circle: { center, radius }, pieces: [] };
  }
  // the corners, and for a corner an arc piece starts at, its radius and the way it turns
  const corners: { at: Vec2; radius?: number; sign?: number }[] = [];
  for (const span of spans) {
    if (span.kind === 'line') corners.push({ at: span.from });
    else if (span.kind === 'arc') {
      const count = piecesOfArc(span.sweep);
      const start = Math.atan2(span.from[1] - span.center[1], span.from[0] - span.center[0]);
      const sign = Math.sign(span.sweep);
      for (let k = 0; k < count; k++) {
        const angle = start + (k * span.sweep) / count;
        corners.push({ at: k === 0 ? span.from : [span.center[0] + span.radius * Math.cos(angle), span.center[1] + span.radius * Math.sin(angle)], radius: span.radius, sign });
      }
    } else {
      if (!span.points) throw new Error('the outline: the section left the points of a curve out');
      // a curve that is a whole loop lists its corners once; any other ends at the next span
      for (const point of spans.length === 1 ? span.points : span.points.slice(0, -1)) corners.push({ at: point });
    }
  }
  const pieces = corners.map((corner, i): OutlinePiece => {
    const next = corners[(i + 1) % corners.length].at;
    const chord = Math.hypot(next[0] - corner.at[0], next[1] - corner.at[1]);
    if (corner.radius === undefined || corner.sign === undefined || chord === 0) {
      box.reach(corner.at);
      return { at: corner.at, turn: 0 };
    }
    const turn = corner.sign * 2 * Math.asin(Math.min(1, chord / (2 * corner.radius)));
    box.reachArc(corner.at, next, corner.radius, turn);
    return { at: corner.at, turn, radius: corner.radius };
  });
  return { body, hole, pieces };
}

// The outline for the options of a format.
// 1. The bodies: the list; without one, the body of the face when the plane is a face, else the
//    printed bodies (which may be none).
// 2. The cut: `run` of `section` with the same context, those bodies (also none: the plane is then
//    still resolved and `about` has its frame), the spans and a budget no model reaches. Its
//    refusals pass through as they are.
// 3. The loops, from the spans (see the head of this module), and the box of what is drawn.
// `empty`: the text of `chosenBodies` when no body was taken; else, when no loop was cut,
// `notCutInPlane` with the first body of `inPlane`, or `NOT_CUT`.
export function outlineOf(context: QueryContext, options: RunArgsOf<typeof OUTLINE_OPTIONS>): Outline {
  const { plane, offset, bodies } = options;
  const taken: { chosen: Id[]; empty?: string } = bodies === undefined && plane.kind === 'face' ? { chosen: [plane.body] } : chosenBodies(context, bodies);
  const cut = section.run(context, { plane, offset, bodies: taken.chosen, outline: 'spans', maxPoints: Number.MAX_SAFE_INTEGER });
  const { loops, bounds } = loopsOf(cut);
  const about: OutlineAbout = {
    bodies: cut.bodies.map((body) => body.body),
    loops: loops.length,
    circles: loops.filter((loop) => loop.circle).length,
    area: cut.bodies.reduce((sum, body) => sum + body.area, 0),
    ...(bounds ? { bounds } : {}),
    frame: cut.frame,
    below: cut.below,
    ...(cut.inPlane.length ? { inPlane: cut.inPlane } : {}),
  };
  const empty = taken.empty ?? (loops.length ? undefined : cut.inPlane.length ? notCutInPlane(cut.inPlane[0].body) : NOT_CUT);
  return { loops, about, ...(empty === undefined ? {} : { empty }) };
}

// The loops of a complete answer of `section` with spans, in its order, and the box of what is
// drawn: the corners, for an arc piece the points of its own circle furthest along x and y that it
// passes, and the box of a whole circle. No box when there is no loop.
export function loopsOf(cut: Pick<SectionResult, 'bodies'>): { loops: OutlineLoop[]; bounds?: { min: Vec2; max: Vec2 } } {
  const box = new Box();
  const loops: OutlineLoop[] = [];
  for (const body of cut.bodies) {
    if (!body.regions) throw new Error('the outline: the section left the regions of a body out');
    for (const region of body.regions) {
      loops.push(loopOf(body.body, region.outer, false, box));
      for (const hole of region.holes) loops.push(loopOf(body.body, hole, true, box));
    }
  }
  return loops.length ? { loops, bounds: { min: box.min, max: box.max } } : { loops };
}
