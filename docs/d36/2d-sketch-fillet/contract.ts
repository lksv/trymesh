// Contract of package 2d (D52): the command that re-points a point of a sketch curve, and the
// sketch tool that fillets a corner. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// the package adds or changes. The design is design.md; the calls are calls.ts.
//
// Four things change:
// 1. `Command` gets one member, `setCurvePoint`.
// 2. The sketch tools get the tool `fillet`, an input kind for "a point of the sketch, by its ID",
//    and the document in their context.
// 3. The solver adapter of planegcs gives a tangency at a common end point to the library in
//    another form (no type changes; the rule is stated at the end of this file).
// 4. Nothing else: no field of the document, no feature type, no face role, no issue code, no
//    query, no upgrade step.

import type { CurveShape, Expr, Id, NewId, NumberSpec, SketchToolContext, SketchToolInput, SketchToolInputs, SketchToolSpec } from '../../../packages/engine/src/index';
import type { CommandAfter, DocumentAfter } from '../00-prep/contract';

// ================================================================ 1. the command

// The points a curve is given by, by the kind of the curve: the fields of `CurveShape` other than
// `type`, so the table cannot name a point a curve does not have.
export const CURVE_POINTS = { line: ['a', 'b'], circle: ['center'], arc: ['center', 'start', 'end'] } as const satisfies {
  [T in CurveShape['type']]: readonly Exclude<keyof Extract<CurveShape, { type: T }>, 'type'>[];
};
export type CurvePointName = (typeof CURVE_POINTS)[keyof typeof CURVE_POINTS][number]; // 'a' | 'b' | 'center' | 'start' | 'end'

// `setCurvePoint`: an own curve of the sketch gets another point in one of its places. The curve
// keeps its ID, its kind, its direction (a line still runs from `a` to `b`, an arc counter-clockwise
// from `start` to `end`), its construction flag, its radius (a circle) and every constraint on it.
// - `id`: an own curve of the sketch (projected geometry has no points to change).
// - `point`: which point of the curve, by the name the curve has for it (`CURVE_POINTS`): `a` or
//   `b` of a line; `center`, `start` or `end` of an arc; `center` of a circle. A name the curve
//   does not have is an invalid command.
// - `to`: an own point of the sketch or `origin`, as for every curve; a point of projected
//   geometry is refused (join to it with a coincident constraint).
// - The curve has to stay one: the two points of a line differ, the three of an arc differ.
// - No constraint may become one the catalog refuses: the own rule of every constraint that names
//   the curve is asked again (`symmetric`: a symmetric point is not an end of the axis;
//   `midpoint`: the point is not an end of the line). The command that would break one is invalid
//   and names the constraint.
// - The point the curve had stays in the sketch, with its constraints, also when no curve uses it
//   any more; `removeEntity` removes it.
// - `to` equal to the point the curve has there is accepted and changes nothing.
// - Nothing moves by the command itself: the positions of the points are those of the document,
//   and the next recompute solves the sketch (the stamp of its inputs holds the curves, so it no
//   longer matches). An arc whose end was moved off its radius is brought back by the solver.
// What follows outside the sketch, in the recompute (never a reason to refuse the command):
// - A region is named by the IDs of the curves of its outer loop and a side face by the ID of its
//   curve, so both keep their names; whether the region is still there depends on where the curve
//   now runs.
// - The origin of the planar side face of a line is the start (`a`) of the line: re-pointing `a`
//   moves it, and a sketch or a plane feature on that face with it.
// - The straight end of a wall is named by the sketch point its chain ends at (`wallEnd`):
//   re-pointing the free end of the chain renames that face, and a reference to it breaks.
export interface SetCurvePoint {
  type: 'setCurvePoint';
  sketch: Id;
  id: Id;
  point: CurvePointName;
  to: Id;
}
declare module '../00-prep/contract' {
  interface Commands {
    setCurvePoint: SetCurvePoint;
  }
}

// ================================================================ 2. the sketch tools

// ---------------------------------------------------------------- what every tool gets

// An input kind is added: a point of the sketch given by its ID, an own point or `origin`. (An
// anchor is a place, and may make a point; this names one that is there.) `sketchTool` checks it
// like the snap of an anchor: the sketch has the entity, it is a point, it is not a point of
// projected geometry, and it has a solved position.
export type SketchToolInputAfter = SketchToolInput | { kind: 'point' };
export interface SketchToolSpecAfter extends Omit<SketchToolSpec, 'inputs'> {
  inputs: Record<string, SketchToolInputAfter>;
}

// The context gets the document the sketch is in. A tool that changes curves other features name
// (the fillet) reads it to change those features in the same batch. Without it such a tool draws
// into the sketch only and returns no patch: right for a sketch nothing is built on, and wrong
// otherwise, so the app and the MCP tool `sketch_tool` always pass it.
export interface SketchToolContextAfter extends SketchToolContext {
  document?: DocumentAfter;
}

// The result is as today; the commands may now hold `setCurvePoint` and `updateFeature`.
export type SketchToolResultAfter = { ok: true; commands: CommandAfter[]; ids: Record<string, Id[]> } | { ok: false; message: string };

export interface SketchToolInputsAfter extends SketchToolInputs {
  fillet: FilletInput;
}
export declare function sketchTool<K extends keyof SketchToolInputsAfter>(tool: K, context: SketchToolContextAfter, input: SketchToolInputsAfter[K], newId: NewId): SketchToolResultAfter;
// As today (sketch-tools.ts); restated over the document with what the packages add.
export declare function freshIds(document: DocumentAfter, prefix?: string): NewId;

// ---------------------------------------------------------------- the fillet

// `corner`: the point where two lines meet. `radius`: the radius of the arc, a number or an
// expression over the parameters; it becomes the value of a driving radius dimension.
export interface FilletInput {
  corner: Id;
  radius: number | Expr;
}
export const FILLET_RADIUS = { title: 'Radius', unit: 'mm', min: { value: 0, open: true } } as const satisfies NumberSpec;

// The entry of the catalog `SKETCH_TOOLS`, as it will stand there. The summary is what an AI reads
// in `describe_api`.
//
// Which lines. Of the curves that end at the corner (a line by `a` or `b`, an arc by `start` or
// `end`), those that are not construction curves are taken; if there are none, the construction
// ones. They have to be exactly two lines. Anything else on the point stays on it: a construction
// diagonal of a rectangle, the centre of a circle.
//
// What the batch holds, in this order:
// 1. `addPoint` three times: the two ends of the arc (each on its line, radius / tan(angle / 2)
//    from the corner) and its centre (on the bisector), at their exact places computed from the
//    solved sketch, so the sketch is already solved as drawn.
// 2. `setCurvePoint` twice: the end of each line that was the corner becomes its end of the arc.
// 3. `addCurve`: the arc, counter-clockwise from the one end to the other the short way round;
//    a construction curve when the two lines are.
// 4. `addConstraint` five times: `tangent` of each line and the arc; `pointOnCurve` of the corner
//    point and each line, which keeps the corner as the crossing of the two lines; the driving
//    `radius` of the arc with the value given. A `pointOnCurve` the sketch already has is not
//    added again (the engine refuses a constraint twice); `ids.constraints` names the one there.
// 5. `updateFeature` for every feature of the document whose profile reads this sketch and names
//    both lines: a region whose outer loop holds both gets the arc into the loop, a wall whose
//    curves hold both gets it into its curves. Only with `context.document`.
// The freedom of the sketch does not change: six coordinates are added and six equations (the
// rule of the arc, two tangencies, the corner on two lines, the radius).
//
// What it refuses (`ok: false` with the reason; nothing is drawn):
// - the corner is not the end of exactly two lines by the rule above (the message says what ends
//   there);
// - a curve ends at another point that a satisfied coincident constraint joins to the corner (the
//   profile takes the two points for one vertex, `pointJoins` of sketch.ts, so the corner is not
//   the two lines the tool sees; the message names the point);
// - the two lines are parallel at the corner;
// - the radius does not fit: an end of the arc would lie at the far end of its line or beyond it
//   (the message gives the largest radius that fits);
// - a radius given as an expression that the parameters of the context give no value to (or no
//   parameters in the context);
// - one of the two lines has an `equalLength` or a `midpoint` constraint: it would then measure
//   the shortened line and change the shape without a word (the message names the constraint).
export const FILLET = {
  title: 'Fillet',
  summary:
    'A fillet of the corner where two lines meet: an arc of the given radius, tangent to both lines. The lines are shortened to the ends of the arc and keep their IDs, so the faces made from them keep their names. The corner point stays as the virtual corner, held on both lines: dimensions and constraints on it mean what they did, and a size of the outline is still measured between its sharp corners. `radius` becomes a radius dimension (`ids.radius`), a number or an expression; change it there. The arc is added to every region and wall of the document that passes the corner (`ids.patched`), in the same batch, so the features built on the sketch keep their profiles and get one more side face, a cylinder named by the arc. A side face starts where its line starts: when the line that starts at the corner has a sketch or a plane feature on its side face, that one moves along the line with the start (`ids.moved`); check what is dimensioned from its origin. Refused: a point that is not the common end of exactly two lines (ends joined by a coincident constraint are two points: re-point one line onto the other point first, setCurvePoint), parallel lines, a radius the lines are too short for, a line with an equalLength or midpoint constraint (it would measure the shortened line). A profile offset or a wall has to leave the arc a radius: an inward offset as large as the fillet is an error of that feature. A later change that leaves the arc no room (a radius too large, a side too short) shows as a conflict of the sketch or as an invalid profile. Of the curves that end at the corner the ones that are not construction curves are filleted; if there are none, the construction ones.',
  inputs: { corner: { kind: 'point' }, radius: { kind: 'number', spec: FILLET_RADIUS, expression: true } },
  ids: {
    arc: 'the arc',
    center: 'the centre point of the arc',
    lines: 'the two lines that were shortened, in the order of their IDs',
    ends: 'the ends of the arc: `ends[i]` is the new end of `lines[i]`',
    constraints: 'the constraints the tool added, without the radius dimension: the tangency of `lines[0]`, of `lines[1]`, the corner on `lines[0]`, on `lines[1]`',
    radius: 'the radius dimension',
    patched: 'the features whose profile was given the arc, in the order of the timeline (empty when no feature names both lines)',
    moved: 'sketches and plane features whose plane starts at the corner and moves with the start of its line (empty when there are none)',
  },
} as const satisfies SketchToolSpecAfter;
// What `ids` of a fillet holds: every list of the entry, always present.
export type FilletIds = { [K in keyof (typeof FILLET)['ids']]: Id[] };

// `moved`, exactly. A planar side face of an extrusion has its origin at the start (`a`) of the
// line it was made from (for a profile with an offset and for a wall: at the start of the moved
// line). The fillet re-points that start for the one of its two lines whose `a` is the corner (if
// either has it there). Listed are, in the order of the timeline:
// - every sketch whose plane, and every plane feature whose base, is a face in the role `side` or
//   `wallSide` made from that line by a feature over this sketch, a face of a copy included;
// - every plane feature based on a listed plane feature, and every sketch on a listed plane feature.
// By how much each moves is not returned: it depends on the offset or the thickness of the profile
// the face came from. The state before and after says it (`features[id].plane.origin`), and a
// preview of the batch shows it without writing.
// Not listed, because the recompute reports it: what referred to the edge between the two side
// faces of the corner, which is gone (`brokenProjection`), and what referred to the straight end
// of a wall that ended at the corner (`brokenReference`).

// ================================================================ 3. the solver adapter

// No type of the port changes. The adapter of planegcs translates `tangent` by the kinds of its
// two curves, and two cases are added:
// - a line and an arc that share an end point by ID (an end of the arc, `start` or `end`, is `a`
//   or `b` of the line): the library gets "the radius from the centre to that point is square to
//   the line" (`perpendicular_pppp`) in place of "the centre is the radius away from the line"
//   (`tangent_la`);
// - two arcs that share an end point by ID and have two different centre points: the library gets
//   "that point lies on the line of the two centres" (`point_on_line_ppp`) in place of `tangent_aa`.
// Both say the same about the sketch: the curves pass through the common point by their
// definition, so they touch there exactly when the condition holds. The form of today has
// a double root in that state (its derivative is that of the rule of the arc), which the library
// takes for a redundant constraint when the state is exact, and then reports as a conflict after
// any change; design.md, "Measured", has the cases. The analysis of the engine (`analysis.ts`)
// has read a tangency at a common point this way since D32; the adapter now agrees with it.
// The constraint keeps its ID in `conflicting` and `redundant`. Everything else about `tangent`
// stays: a line and a circle, a circle and an arc, two circles, and curves whose common point is
// held by a constraint and not by one ID.
