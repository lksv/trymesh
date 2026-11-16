// Contract of package 2d (D52): the command that re-points a point of a sketch curve, and the
// sketch tool that fillets a corner. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// the package adds or changes. The design is design.md; the calls are calls.ts.
//
// Four things change:
// 1. `Command` gets one member, `setCurvePoint`.
// 2. The sketch tools get the tool `fillet`, an input kind for "a point of the sketch, by its ID",
//    and the document in their context.
// 3. The solver adapter of planegcs gives a tangency of a line and an arc at a common end point to
//    the library in another form (no type changes; the rule is stated at the end of this file).
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

// What `sketchTool` takes: the context of today with the document the sketch is in, as a required
// field. A tool that changes curves other features name (the fillet) reads it to change those
// features in the same batch. It is not optional: a fillet called without it would draw the arc,
// answer `ok` with empty lists and break every feature on the sketch. The tools of today do not
// read it. `SketchToolContext` itself does not change: the functions that never read a document
// (`placeAnchor`, `anchorPosition`, `nearestCurvePoint`) keep taking it, and so does everything
// in the app that holds one for a sketch that is only drawn.
export interface SketchToolContextAfter extends SketchToolContext {
  document: DocumentAfter;
}

// The result is as today; the commands may now hold `setCurvePoint` and `updateFeature`.
export type SketchToolResultAfter = { ok: true; commands: CommandAfter[]; ids: Record<string, Id[]> } | { ok: false; message: string };

export interface SketchToolInputsAfter extends SketchToolInputs {
  fillet: FilletInput;
}
export declare function sketchTool<K extends keyof SketchToolInputsAfter>(tool: K, context: SketchToolContextAfter, input: SketchToolInputsAfter[K], newId: NewId): SketchToolResultAfter;
// As today (sketch-tools.ts); restated over the document with what the packages add.
export declare function freshIds(document: DocumentAfter, prefix?: string): NewId;
// Which point of an own curve is nearest to a point of the sketch, by the solved positions:
// what the app chooses at first when it offers `setCurvePoint` (the caller may choose another).
// Undefined when the sketch has no such curve or point, or no solved state.
export declare function nearestCurvePoint(context: SketchToolContext, curve: Id, to: Id): CurvePointName | undefined;

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
// Which lines. The curves that count are the own curves of the sketch that end at the vertex of
// the corner (a line by `a` or `b`, an arc by `start` or `end`). The vertex is the class of the
// corner point in `pointJoins` of sketch.ts, which is how the profile joins points: every point
// that satisfied coincident constraints tie to the corner, directly or through other points,
// `origin` and projected points included (a line may end at `origin` itself). Projected curves
// never count, and a centre is not an end. Of the
// curves that count, those that are not construction curves are taken; if there are none, the
// construction ones. They have to be exactly two lines, and both have to end at the corner point
// itself. Anything else on the point stays on it: a construction diagonal of a rectangle, the
// centre of a circle, a coincident constraint with a projected point.
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
//    curves hold both gets it into its curves.
// The freedom of the sketch does not change: six coordinates are added and six equations (the
// rule of the arc, two tangencies, the corner on two lines, the radius).
//
// What it refuses (`ok: false` with the reason; nothing is drawn). The tolerances are those of
// the engine (util.ts): `LENGTH_TOLERANCE` 1e-6 mm, `ANGLE_TOLERANCE` 1e-4 rad.
// - the corner is not the end of exactly two lines by the rule above (the message says what ends
//   there);
// - one of the two lines ends at another point of the vertex, joined to the corner by a coincident
//   constraint: the corner is two points (the message names the other point);
// - one of the two lines is shorter than the length tolerance;
// - the angle between the two lines is within the angle tolerance of 0 or of pi ("parallel");
// - the radius does not fit: what would be left of a line (its length less radius / tan(angle / 2))
//   is not above the length tolerance (the message gives the bound the radius has to be below:
//   the shorter line times tan(angle / 2));
// - the radius is too small to draw: the radius, the distance of an end of the arc from the
//   corner, or the chord of the arc is not above the length tolerance (the profile and the wall
//   refuse an arc with a radius that is not);
// - a coordinate of one of the three new points is out of the range +-MAX_NUMBER;
// - a radius given as an expression that the parameters of the context give no value to (or no
//   parameters in the context);
// - one of the two lines has an `equalLength` or a `midpoint` constraint: it would then measure
//   the shortened line and change the shape without a word (the message names the constraint).
export const FILLET = {
  title: 'Fillet',
  summary:
    'A fillet of the corner where two lines meet: an arc of the given radius, tangent to both lines. The lines are shortened to the ends of the arc and keep their IDs, so the faces made from them keep their names. The corner point stays as the virtual corner, held on both lines: dimensions and constraints on it mean what they did, and a size of the outline is still measured between its sharp corners. `radius` becomes a radius dimension (`ids.radius`), a number or an expression; change it there. The arc is added to every region and wall of the document that passes the corner (`ids.patched`), in the same batch, so the features built on the sketch keep their profiles and get the round face named by the arc: `side` of an extrusion (a cylinder, or a cone when the extrusion is tapered), `wallSide` left and right of a wall. A feature whose region has the corner on the rim of a hole (a plate around a pocket) needs no patch, since a region is named by its outer loop: it gets the round corner too and is in no list. Two lists name what reads the corner directly and is not patched; check them. `ids.moved`: sketches and plane features on a side face that starts at the corner (a side face starts where its line starts, at `a`); their plane has moved along the line, with everything dimensioned from its origin. `ids.shortened`: extrusions whose wall runs along one of the two lines only (the wall ends at the arc now), and sketches that project an edge of a side face of either line (the end of the projection at the corner has moved). Only features that read the corner directly are listed, by the names in the document: what is built on them follows them, and a listed feature may also be among the problems of the result. Refused: a point that is not the common end of exactly two lines (ends joined by a coincident constraint are two points: re-point one line onto the other point first, setCurvePoint), parallel lines, a radius the lines are too short for or one too small to draw, a line with an equalLength or midpoint constraint (it would measure the shortened line). A profile offset or a wall has to leave the arc a radius: an inward offset as large as the fillet is an error of that feature. Nothing keeps the arc a fillet afterwards: a later change that leaves it no room (a radius too large, a side too short) is often a conflict of the sketch or an invalid profile, but it can also be solved into an arc that runs past the end of a line, with no message and a body made from it, so look at the sketch after such a change. Of the curves that end at the corner the ones that are not construction curves are filleted; if there are none, the construction ones.',
  inputs: { corner: { kind: 'point' }, radius: { kind: 'number', spec: FILLET_RADIUS, expression: true } },
  ids: {
    arc: 'the arc',
    center: 'the centre point of the arc',
    lines: 'the two lines that were shortened, in the order of their IDs',
    ends: 'the ends of the arc: `ends[i]` is the new end of `lines[i]`',
    constraints: 'the constraints the tool added, without the radius dimension: the tangency of `lines[0]`, of `lines[1]`, the corner on `lines[0]`, on `lines[1]`',
    radius: 'the radius dimension',
    patched: 'the features whose region or wall named both lines and was given the arc, in the order of the timeline (empty when there are none; a feature whose region has the corner on a hole needs no patch and is not here)',
    moved: 'sketches and plane features on a side face that starts at the corner: their plane moved with the start of its line (empty when there are none)',
    shortened: 'features that read one of the two lines without the other: extrusions whose wall runs along one of them, sketches that project an edge of a side face of either (empty when there are none)',
  },
} as const satisfies SketchToolSpecAfter;
// What `ids` of a fillet holds: every list of the entry, always present.
export type FilletIds = { [K in keyof (typeof FILLET)['ids']]: Id[] };

// `moved` and `shortened`, exactly. Both name features that were not patched and read the changed
// geometry directly; each list is in the order of the timeline. Both are made by the rules below
// from the names in the document alone, with no geometry and no recompute. So they say which
// features to look at, not what state they are in: most follow the corner without an error, and
// one that ends in an error or with a warning is listed here and among the problems of the
// result as well. What is built on a listed feature (a body extruded from a listed sketch,
// a sketch on that body, a plane on a listed plane) follows it and is not listed.
//
// `moved`. A planar side face of an extrusion has its origin at the start (`a`) of the line it was
// made from (for a profile with an offset and for a wall: at the start of the moved line). Of the
// two lines, zero, one or both have `a` at the corner, and the fillet re-points it. Listed is
// every sketch whose plane, and every plane feature whose base, is a face in the role `side` or
// `wallSide` whose curve is such a line, a face of a copy included. By how much each moves is not
// returned: it depends on the offset or the thickness of the profile the face came from. The state
// before and after says it (`features[id].plane.origin`), and a preview of the batch shows it
// without writing.
//
// `shortened`. Listed is:
// - every extrusion whose wall is over this sketch and names exactly one of the two lines. Its
//   chain ended at the corner and ends at the arc's end now; its straight end there is the face
//   `wallEnd` of that new point (a reference to the old one is a `brokenReference`, which the
//   recompute reports);
// - every sketch with a projected edge one of whose two faces is in the role `side` or `wallSide`
//   with either line as its curve. The edge of such a face with a cap ends at the arc now. The
//   tool does not work out which edge it is: the edge at the far end of the line is named as
//   well, and so is the edge between the side faces of the two lines, which is gone (the
//   recompute reports that one as `brokenProjection`).
//
// In neither list: a feature that names the corner point (it keeps the sharp corner), and
// a feature whose region has the corner on the rim of a hole (it gets the round corner by itself;
// the solved sketch does not say which curves the holes of a region have).

// ================================================================ 3. the solver adapter

// No type of the port changes. The adapter of planegcs translates `tangent` by the kinds of its
// two curves, and one case is added:
// - a line and an arc with a common end: an end of the arc (`start` or `end`) is an end of the
//   line (`a` or `b`), either the same point ID or two points that one `coincident` constraint of
//   the input names together. The library gets "the radius from the centre to that end of the arc
//   is square to the line" (`perpendicular_pppp(centre, end of the arc, line.a, line.b)`) in place
//   of "the centre is the radius away from the line" (`tangent_la`).
// It says the same about the sketch wherever the line has a length: the arc passes through its end
// and the end is on the line, so they touch there exactly when the radius to it is square to the
// line. (A line of no length satisfies the new form and has no meaning in the old one.) The form
// of today has a double root in that state (its derivative is that of the rule of the arc), which
// the library takes for a redundant constraint when the state is exact, and then reports as
// a conflict after any change; design.md, "Measured", has the cases. The analysis of the engine
// (`analysis.ts`) has read a tangency at a common point this way since D32; the adapter now agrees
// with it for this case.
// The line may be a projected one or end at `origin`: both are lines of the input like any other.
// The new form is as strict about a tangency as the library is about every other constraint (its
// residual grows with the angle off tangent, that of `tangent_la` with its square): an input that
// holds the points at a state only nearly tangent is a conflict now where it was solved before.
// The rule is decided from the curves and constraints of the input, never from positions. The
// constraint keeps its ID in `conflicting` and `redundant`. Everything else about `tangent`
// stays: a line and a circle, a circle and an arc, two circles, two arcs (design.md says why two
// arcs with a common end are not changed), and a line and an arc whose common point is held
// otherwise (through a third point, by `pointOnCurve`).
