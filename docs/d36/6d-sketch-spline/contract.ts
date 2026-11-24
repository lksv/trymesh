// Contract of package 6d (D70): splines, the cheap variant. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and of the app
// (6a is implemented, so the table of the app's sketch tools is read from its code, not from 6a's
// contract), and states what 6d adds or changes; the design is design.md, the calls are calls.ts.
//
// 6d is implemented after 6a2, 6e, 6c and 6b (the sequence of docs/d36/6-plan.md), so section 8
// says what it adds to their code. Their contracts are not imported: their revisions are on
// branches of their own, and this file has to compile before and after they are merged.
//
// What changes:
// 1. A curve kind `spline`: a clamped, uniform, non-rational B-spline of degree min(3, n − 1) over
//    n control points that are ordinary points of the sketch. `CurveShape`, `Curve`, `EntityKind`
//    and `CURVE_POINTS` get it; the validator of a curve, the commands that take a curve, and every
//    switch on the kind of a curve (the engine, the solver adapter, the app, and the code of 6e, 6c
//    and 6b) say what a spline is there.
// 2. A leaf module `spline.ts` of the engine: the Bezier pieces of a spline (Boehm's knot
//    insertion, for any knots, so 6f and 6h reuse it), its polyline within the chord tolerance, the
//    points it passes at the joints of its pieces, and its box.
// 3. The profile takes a spline as one shape over its polyline; a loop through a spline has no
//    exact curves and names the spline (`Loop.sampled`), so the offset, the taper and the revolve
//    refuse it by one message; the wall refuses it at the command and in the recompute.
// 4. The side face of a spline is `swept` along the direction of the extrusion; its edges are of the
//    kind `other`.
// 5. A spline is not projected into another sketch: two refusals in the code of 6b.
// 6. `get_sketch` says where each spline runs (the owner's answer 26); the query `sketchContacts`
//    of 6e says why a profile with a spline is invalid (answer 5).
// 7. The app: a sketch tool `spline`, the curve and its control polygon in the view; a drawing tool
//    does not snap to a spline, the Select tool does.
// Nothing else: no command, no constraint, no query, no issue code, no feature type, no face role,
// no upgrade step, no change of the solver port beyond the one more kind of `Curve` it carries.

import type { Command, CurveShape, Id, Point2, ResultCurve, SketchResult, SolveInput, Vec2 } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { CurveEnd, Loop, PlacedCurve } from '../../../packages/engine/src/sketch';
import type { SideCurve } from '../../../packages/engine/src/recompute/state';
import type { Anchor } from '../../../packages/engine/src/sketch-tools';
import type { SketchPlaceTool } from '../../../packages/app/src/sketch-tools/spec';
import type { SketchMode } from '../../../packages/app/src/sketch-mode';
import type { SketchView } from '../../../packages/app/src/sketch-view';

// ================================================================ 1. the curve

// A spline: a smooth curve over control points (D70). The text below is the comment that goes into
// `types.ts` at `CurveShape`, which `describe_api` gives the AI.
// - `points`: the control points in order, own points of the sketch or `origin`, 3 to 64. The
//   curve starts at the first and ends at the last; the points between pull it and lie off it in
//   general: a control point pulled aside moves the curve less than itself (in a spline of five
//   points, the middle one pulled by 4 mm moves the curve by 2). `get_sketch` says where the curve
//   runs: `through`, the points it passes at the joints of its pieces, and `box`. The same point may not be listed twice, except the first again as the last: the spline
//   is then closed (at least 4 entries), with a corner at that point unless the first and the last
//   leg of the control polygon are made to lie on one line.
// - The curve is a B-spline of degree 3 (2 for three points), clamped (it starts at the first
//   point along the first leg, from `points[0]` towards `points[1]`, and ends at the last along the
//   last leg), with uniform knots, not rational. Four points are one cubic Bezier curve; three one
//   quadratic. It has no other field: no degree, no knots, no weights.
// - The solver sees only the points: no constraint names a spline, and nothing holds a point on
//   it. Shape it by constraining its control points like any points.
// - A spline that runs on smoothly from a line that ends at its first point: hold the second
//   control point on that line (`pointOnCurve`, which holds it on the whole line, not only between
//   its ends), and give that point a start position beyond the end of the line. The solver keeps
//   the side it starts on; behind the end, over the line, the spline turns back on the line in a
//   cusp, so read the position after the solve. From an arc that ends at its first point: a
//   construction line from `points[0]` to `points[1]`, tangent to the arc (`tangent`). The same at
//   the last point with the last leg. A spline may end on a point of a line or an arc only at their
//   common end; a circle of the outline has no end, so a spline that ends on one makes the profile
//   invalid (a construction circle may be touched so).
// - A spline forms regions with the other curves (unless it is a construction curve). The profile
//   uses its polyline within the chord tolerance of the document: a spline that crosses itself
//   or another curve, or touches one away from a shared end, makes the profile invalid as two
//   crossing curves do; the query `sketchContacts` says where. A spline is not trimmed, split or
//   extended, and not projected into another sketch (project its control points).
// - The side face of an extrusion is `{ role: 'side', curve: <the spline> }`, one face for the
//   whole spline, a swept surface; its edges have the kind `other`, so they cannot be projected,
//   chamfered or filleted, and neither can an edge that runs on smoothly into one: the rim of a
//   part whose outline is smooth all round and holds a spline takes no chamfer and no fillet. A
//   sketch cannot stand on the face. A profile with a spline cannot be offset, tapered or revolved,
//   and a wall does not run along a spline (`invalidProfile` naming the spline).
// - To change the control points, remove the spline and add it again under its ID in one batch:
//   no constraint names it, so nothing is lost, and the faces and regions named by it keep the
//   name. Removing a control point removes the spline, as removing the end of a line removes the
//   line. `setCurvePoint` does not take a spline.
export interface SplineShape {
  type: 'spline';
  points: Id[];
}
export type CurveShapeAfter = CurveShape | SplineShape;
export type CurveAfter = { construction?: boolean } & CurveShapeAfter;
export type EntityKindAfter = EntityKind | 'spline';

// The limits of a spline, checked by the validator of a curve (on every command and on a load).
export declare const MIN_SPLINE_POINTS: 3;
export declare const MAX_SPLINE_POINTS: 64;
// The degree of a spline of `n` entries of `points` (a closed spline counts its closing entry):
// min(3, n − 1), so 2 or 3.
export declare function splineDegree(n: number): 2 | 3;

// The points of a curve by its kind (sketch-content.ts). A spline has no named point: its entry is
// empty, and the completeness guard of the table counts only the fields of a shape that hold one
// ID (`a`, `b`, `center`, `start`, `end`), so `points` is not a `CurvePointName`. `CURVE_KINDS`
// (the keys of the table) then has `spline`, so the validator of a curve accepts it.
export declare const CURVE_POINTS: {
  readonly line: readonly ['a', 'b'];
  readonly circle: readonly ['center'];
  readonly arc: readonly ['center', 'start', 'end'];
  readonly spline: readonly [];
};
// Every point a curve is given by: a line's ends, a circle's centre, an arc's centre and ends, a
// spline's control points in order, the closing repeat included (the cascade of removeEntity, the
// diagnosis and the app's control polygon read it; readers that need each point once make a set).
export declare function curvePoints(curve: CurveShapeAfter): Id[];
// The points at the ends of a curve (sketch.ts): a line's `a`, `b`; an arc's `start`, `end`;
// a spline's first and last control point (one point twice when it is closed); none for a circle.
// The profile and the joins of 6c read the ends of a spline through it.
export declare function curveEnds(shape: CurveShapeAfter): [Id, Id] | undefined;

// The texts of the refusals of the validator of a curve (features/sketch.ts, `curve`), for a
// spline. `what` is the path of the curve in the command or the document.
export declare const SPLINE_REFUSALS: {
  count(what: string, n: number): string; // `${what}.points: a spline has 3 to 64 control points, not ${n}`
  repeated(what: string, point: Id): string; // `${what}.points: "${point}" is listed twice; only the first point may come again, as the last, closing the spline`
  closedTooShort(what: string): string; // `${what}.points: a closed spline needs at least three different points`
};
// The refusal of `setCurvePoint` for a spline (document.ts, D52). It is written before the generic
// text: with `CURVE_POINTS.spline = []` the command compiles and would say "has the points , not".
export declare const SET_CURVE_POINT_SPLINE: (id: Id) => string; // `setCurvePoint.id: "${id}" is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch`

// ================================================================ 2. spline.ts

// A leaf of the engine beside sketch-content.ts: it imports only the types and util.ts. Pure
// functions over positions; nothing here reads a sketch.

// The Bezier pieces of a non-rational B-spline of degree `degree` with the knot vector `knots`
// (non-decreasing, `control.length + degree + 1` long, clamped: the first and the last knot repeated
// `degree + 1` times): every inner knot inserted until it is `degree` times there (Boehm), then one
// piece of `degree + 1` points per span of non-zero length, in order. The general form serves 6f
// (a DXF `SPLINE` of any knots becomes a chain of Bezier splines, exactly) and 6h (the converter
// of Onshape models).
export declare function bsplineBeziers(control: readonly Vec2[], knots: readonly number[], degree: number): Vec2[][];
// The pieces of a spline of the sketch: its clamped uniform knots (0 repeated p + 1 times, 1 to
// m − 1, m repeated p + 1 times, for m = n − p spans).
export declare function splineBeziers(control: readonly Vec2[]): Vec2[][];
// How many straight pieces a Bezier piece is divided into for the chord tolerance:
// ceil(sqrt(M / (8 · tolerance))), at least 1 and at most `MAX_SPLINE_PIECES`, where M is the
// largest length of the control points of the second derivative of the piece over its own
// parameter t in [0, 1] (p (p − 1) times the second differences of its points). The second
// derivative of a piece lies in the convex hull of those points, so M bounds it, and a chord over
// a step h of t lies within h² M / 8 of the curve: the polyline keeps the tolerance (measured:
// at most 1.000 of it over 2000 random splines, 0.78 on average; above the cap it does not).
// The cap is per Bezier piece: a spline of 64 points has up to 61 pieces, so up to 61 · 4096
// straight pieces at a tolerance far below its size.
export declare const MAX_SPLINE_PIECES: 4096;
export declare function splinePieces(bezier: readonly Vec2[], chordTolerance: number): number;
// The polyline of a spline: each piece divided into equal steps of its parameter, the first point
// of every step, then the last control point. Its first point is the first control point and its
// last the last, exactly. A point nearer than the length tolerance (`LENGTH_TOLERANCE`) to the
// last one kept is left out, and so is the last inner point when the end is that near to it: no
// piece of a polyline longer than the tolerance is shorter than it (control points at one place
// make such steps; measured). It is computed from the control points in their order, once per
// curve; both directions of a loop walk the same list, so regions that share the spline share its
// points.
export declare function splinePolyline(control: readonly Vec2[], chordTolerance: number): Vec2[];
// Where a spline runs, without a tolerance (the owner's answer 26).
// - `splineJoints`: the points the curve passes exactly: its first point, the joint of every two
//   Bezier pieces in order, its last point (n − p + 1 points for n control points of degree p; a
//   closed spline has its point first and last).
// - `splineBox`: the box of the curve itself, `[minX, minY, maxX, maxY]`: the ends of every Bezier
//   piece and the places where a coordinate of its derivative is zero (a quadratic per coordinate
//   and piece). It lies in the box of the control points, which is the box the broad phase of the
//   profile uses.
export declare function splineJoints(control: readonly Vec2[]): Vec2[];
export type Box = [minX: number, minY: number, maxX: number, maxY: number];
export declare function splineBox(control: readonly Vec2[]): Box;

// ================================================================ 3. the profile

// The one shape function of 6a (`placedCurve`, sketch.ts) gets the spline: its ends read as the
// ends of a line are (the profile and the wall at the joined vertex, `curveOf` raw), the control
// points between them raw, as the centre of an arc is. `control[0]` is `a.p` and the last is `b.p`.
export type PlacedCurveAfter = PlacedCurve | { type: 'spline'; a: CurveEnd; b: CurveEnd; control: Vec2[] };

// The shape of a spline in the profile (`Shape` of sketch.ts): the polyline `pts` from `pa` to
// `pb`, computed once per curve from `control` at the chord tolerance of the document.
export interface ProfileSpline {
  id: Id;
  kind: 'spline';
  a: string; // the vertex of its first point
  b: string; // the vertex of its last point; the same vertex when it is closed
  pa: Vec2;
  pb: Vec2;
  control: Vec2[];
  pts: Vec2[];
}
// The direction a half-edge of a spline leaves its vertex in (the rule that orders the half-edges
// round a vertex; design.md, "The half-edges", with the case the first design got wrong).
// - `reach`: how far from its vertex a curve surely gets. A line and an arc: the distance of their
//   two ends, as today. A spline: the largest distance of a point of its polyline from that vertex
//   (for a closed spline the distance of its farthest point; its two ends are one point).
// - The common distance `d` of a vertex is half the smallest reach of the curves that leave it.
// - A line leaves along itself, an arc towards its point at the distance `d` (the tangent turned
//   by asin(curvature · d / 2), as today), a spline towards the first point where its polyline,
//   walked from the vertex in the direction of the half, leaves the circle of the radius `d` about
//   the vertex: the piece that starts inside the circle and ends on or outside it, cut by the
//   circle. Every half reaches `d` before it ends, and what lies inside the circle of each curve
//   is one path from the vertex to the circle, so the order of the directions is the order of the
//   curves round the vertex for curves that do not cross.
export declare function splineDirection(pts: readonly Vec2[], forward: boolean, d: number): number;
// The box of a spline for the broad phase of the profile (6c's `nearPairs`, the owner's answer
// 15): the box of its control points, which holds the curve and every polyline of it. Inside a
// pair that the broad phase lets through, the pieces of a spline are tested against the other
// curve only where the boxes of the pieces meet.
export declare function splineBroadBox(control: readonly Vec2[]): Box;

// A loop of a region: as today, and `sampled`, the IDs of the curves of the loop that have no exact
// form (the splines), in the order the loop passes them. A loop with one has no `exact`; one
// without keeps it, so a region away from the splines of its sketch can still be offset.
export interface LoopAfter extends Loop {
  sampled?: Id[];
}

// What `selectionOutline` (recompute/outline.ts) answers for a loop with `sampled`: one refusal for
// the offset of a region, the taper and the revolve, which all read the exact outline through it.
// `refs` are the splines of all the loops of the selection, each once, sorted by ID (the refusal
// says them all at once, so a user does not meet them one by one). The text for a loop without
// `exact` and without `sampled` (a generated profile) stays.
export declare const SPLINE_OUTLINE_REFUSAL: (splines: Id[]) => string;
// `The curve "c2" is a spline, which has no exact form: a profile with a spline cannot be offset,
// tapered or revolved. Draw that part with lines and arcs, or leave the offset, the taper or the
// revolve out.` (with "curves … are splines" for more than one)

// What the wall answers in the recompute for a spline among its curves (the command refuses one
// before: the kinds a wall accepts stay `line`, `arc`, `circle`). `refs`: the spline.
export declare const SPLINE_WALL_REFUSAL: (spline: Id) => string; // `The curve "${spline}" is a spline; a wall runs along lines, arcs and circles.`

// The shape of a side (`curveOf` of recompute/profile.ts) of a spline is `{ type: 'general' }`,
// which the prism builds as a swept surface along the normal of the sketch, as it does the side of
// a generated profile today.
export const SIDE_OF_A_SPLINE: SideCurve = { type: 'general' };

// ================================================================ 4. the solver port

// `SolveInput.curves` carries the own splines of the sketch as it carries every own curve (they are
// in the stamp of the sketch). An adapter checks that their points are in `points` and adds no
// primitive and no equation for them; the analysis of freedom adds none either. So a spline does
// not move a point, and its control points are as free as any point.
export type SolveInputAfter = Omit<SolveInput, 'curves'> & { curves: Record<Id, CurveAfter> };

// ================================================================ 5. the result, and no projection

// A curve of the result that is not own may be a spline in one case: a mirrored or patterned one
// of 6c (its copy runs over the copies of the control points in the same order). A projection of a
// spline into another sketch is refused (6b's design; the owner's answer 22), so no reference
// curve is a spline. 6d itself adds none: an own spline is in the document.
export interface ResultCurveAfter extends Omit<ResultCurve, 'shape'> {
  shape: CurveShapeAfter;
}
export interface SketchResult6d extends Omit<SketchResult, 'curves'> {
  curves: Record<Id, ResultCurveAfter>;
}

// The two refusals of a projected spline, written by 6d in the code of 6b (it is implemented
// before 6d).
// - The validator of an entry `{ type: 'sketch', sketch, entity, kind }` (6b stores the kind of the
//   entity): `kind: 'spline'` is refused whatever the entity is, and an entity that is a spline in
//   the source sketch is refused for every kind. `what` is the path of the entry.
// - The tool `projectSketch` of 6b, which projects the entities of a whole sketch: it leaves the
//   splines out, projects the rest (the control points among the points, if the tool was asked for
//   points), and names the splines it left out in its answer with this reason.
export declare const SPLINE_NOT_PROJECTED: (what: string, spline: Id) => string; // `${what}: "${spline}" is a spline, and a spline is not projected yet: project its control points as points`
export declare const SPLINES_LEFT_OUT: (splines: Id[]) => string; // `Not projected: the splines "c2", "s" (a spline is not projected yet; its control points are, as points).`

// ================================================================ 6. the commands

declare module '../00-prep/contract' {
  interface Commands {
    // `addCurve` of today with a spline; `radius` is refused for it as for every curve but a circle.
    addSpline: { type: 'addCurve'; sketch: Id; id: Id; curve: { construction?: boolean } & SplineShape };
  }
}

// ================================================================ 7. MCP

// What `get_sketch` (`sketchDetail`, packages/mcp/src/tools.ts) lists for an own spline, beside
// what it lists for every curve (the owner's answer 26): where the curve runs, at the solved
// positions of its control points, rounded as the positions of points are.
// - `through`: `splineJoints`: the points the curve passes, the first and the last control point
//   among them. Three points for the five control points of a grip.
// - `box`: `splineBox`, `[minX, minY, maxX, maxY]`.
// Both are left out while a control point has no position. A copy of a spline (6c) is not listed
// curve by curve (6c lists a derived entry in a short form), so it gets neither: the transform of
// its entry says where it is.
export interface SplineDetail {
  id: Id;
  type: 'spline';
  points: Id[];
  construction?: boolean;
  through?: Vec2[];
  box?: Box;
}

// What the query `sketchContacts` of 6e (the owner's answer 5) says of a spline. Its fields are
// 6e's; 6d adds the cases.
// - A contact of a spline and another curve that forms regions, apart from a common end: found on
//   the polyline of the spline at the chord tolerance of the document, listed with `kind`
//   `crossing` (or `end`, when it lies at an end of one of the two), `repair: 'none'` and `why`
//   `SPLINE_CONTACT_WHY`. Contacts nearer to each other than the length tolerance are one.
// - A spline that crosses or touches itself: one contact at the first such place along it, its two
//   `curves` the spline twice, `kind` `crossing`, `repair: 'none'`, `why` `SPLINE_SELF_WHY`.
// - A spline of no length is in `degenerate`.
// - `reason`: the first of these, in words, when nothing a cut repairs explains the invalid profile.
export declare const SPLINE_CONTACT_WHY: (spline: Id) => string; // `"${spline}" is a spline, which is not cut and holds no point: move the other curve or the control points, so that the two meet only at a common end`
export declare const SPLINE_SELF_WHY: (spline: Id) => string; // `the spline "${spline}" crosses or touches itself: move its control points`
// The contact search of 6e (`curveContacts`, sketch.ts) takes the chord tolerance for it, since a
// spline has a shape only with one; the pieces of the polyline are tested as lines. Undefined
// as today when either curve has no position or no length.
export interface SplineSelfContact {
  at: Vec2;
}
export declare function splineSelfContact(pts: readonly Vec2[], closed: boolean): SplineSelfContact | undefined;

// ================================================================ 8. what 6d adds to 6e, 6c, 6b

// One line per place of their designs; design.md, "Other packages", has the reasons.
export const PLUG_INS = {
  // 6e (`sketch-cut.ts`, `sketch.ts`)
  curvePredicates: 'a spline: `mayCut` false, `holdsPoint` false, `formsRegions` by its flag as every curve',
  cutSwitches: 'every switch on the kind of a curve refuses a spline by name, with 6e\'s text ("a spline is not trimmed, split or extended; …")',
  curveContacts: 'takes the chord tolerance; a spline is its polyline, piece by piece',
  sketchContacts: 'the cases of section 7',
  faceRule: 'nothing: 6e tests a loop without exact curves on its polygon; 6d brings the first such loop and its two tests',
  // 6c (`references/derive.ts`, `sketch.ts`)
  derive: 'a copy of a spline runs over the copies of its control points in the same order',
  occupies: 'two splines occupy the same when their control points agree in order or in reverse, within the length tolerance',
  occupationPlace: 'the place a spline is filed under: the middle of its two middle control points (for an odd count, the middle one), the same for both orders',
  broadPhase: '`splineBroadBox`',
  // 6b (`references/sketch.ts`, the tool `projectSketch`)
  projection: 'the two refusals of section 5',
} as const;

// ================================================================ 9. the app

// The shape of a curve in the app's view (sketch-view.ts): a spline keeps its control polygon and
// the polyline the view draws and hit-tests, computed by `splinePolyline` with the tolerance
// `VIEW_TOLERANCE` times the largest side of the box of its control points (a rule of the view,
// as the arc's step of π/48 is; the regions the view fills are the engine's polylines).
export type ViewShapeAfter =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number }
  | { type: 'spline'; control: Vec2[]; points: Vec2[] };
export declare const VIEW_TOLERANCE: 0.0005;

// Which curve a drawing tool may snap a new point to (sketch-view.ts): one that can hold a point
// by `pointOnCurve`. False for a spline (and, from 6c, for a copy). The place of a tool that picks
// in the sketch and does not hover (`picks: 'sketch'` without `hovers`: Point, Line, Rectangle,
// Polygon, Circle, Arc, Spline) drops a curve snap to such a curve and is the bare place under the
// pointer. The Select tool, which hovers, still gets the curve: a spline is selected, highlighted,
// deleted and switched to construction as every curve, and the tools of 6c read it from the
// selection. A tool with `picks: 'curve'` (6e's three) decides by its own `eligible`.
export declare function holdsPoint(view: SketchView, curve: Id): boolean;

// The inferred direction of the mode (`SketchPlaceTool.infer`, `SketchMode.infer`) gets a second
// kind beside the horizontal and vertical of the line tool: `'extension'`. With it, while one
// place is kept and that place is snapped to a point at which a line of the sketch that can hold a
// point ends, a bare place under the pointer that lies beyond that end and within the reach of a
// pick of the line's extension is moved onto the extension (the foot of the perpendicular), and
// the mode shows the inference as it shows "horizontal". `extensionOf` is that rule, a function of
// sketch-commands.ts; of several lines it takes the one whose extension is nearest.
export type InferAfter = boolean | 'extension';
export type ModeInferAfter = NonNullable<SketchMode['infer']> | 'extension';
export declare function extensionOf(view: SketchView, first: Anchor, at: Vec2, reach: number): { at: Vec2; line: Id } | undefined;

// The batch that draws a spline through the places the user clicked (sketch-commands.ts): each
// place becomes a control point by `placeAnchor` (an own point or the origin is used again,
// a projected point gets a new point and a coincident, a place on a line, an arc or a circle a new
// point held on it), then `addCurve`. `closed`: the first point again at the end. When the second
// place is bare and lies on the extension of a line that ends at the first point (`extensionOf`
// with the length tolerance as its reach: the mode put it there), its point is held on that line
// by `pointOnCurve`: the spline runs on smoothly from the line. A message, with nothing sent, when
// fewer than three places are given or two of the places are one point (an existing point picked
// twice, or two places within the length tolerance of each other).
export type SplineBatch = { commands: Command[] } | { problem: string };
export declare function splineCommands(sketch: Id, view: SketchView, places: Anchor[], closed: boolean, newId: (prefix: string) => Id): SplineBatch;
export declare const SPLINE_TOOL_PROBLEMS: {
  tooFew: string; // 'A spline needs at least three control points.'
  twice(place: number): string; // `The control point ${place} is at a point the spline already has; a spline passes each of its control points once.`
};

// The tool of the sketch bar (packages/app/src/sketch-tools/spline.ts, one line of
// `SKETCH_TOOL_UI` after `arc`), written against the table as implemented (spec.ts after the fix
// of 6a's review):
// - `label` 'Spline', `hint` 'Click the control points; Enter ends the spline, a click on the first
//   point closes it, Esc drops it. Start at the end of a line and click on its extension to run on
//   smoothly from it.'
// - `picks: 'sketch'`: points first, then curves that can hold a point (`holdsPoint`).
// - `infer: 'extension'`.
// - No `clicks`: `click` is called at every click with the places kept and the new one, and
//   returns the places to keep: all of them. The mode keeps them and redraws the scene; the tool
//   does not redraw. When the new place is at the first place (within the reach of a pick,
//   `PICK_REACH × host.pixelSize()`, by position: the first place is seldom a point of the sketch
//   yet) and at least three places are kept before it, it draws the closed spline through the
//   kept ones and returns nothing. A problem of `splineCommands` is said (`host.say`) and the
//   places before the click are returned.
// - `finish` (Enter): the spline through the places kept; with a problem, the message, and the
//   places are returned, so they stay. The mode takes Enter only while places are kept.
// - `draw`: the control polygon through the places and the cursor, and the spline through them
//   once there are three.
export declare const spline: SketchPlaceTool<undefined>;
export type SketchToolNameAfter = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'spline' | 'fillet' | 'project';

// What the scene of the sketch mode draws for every spline of the open sketch beyond its curve: the
// control polygon through `CurveView.points`, thin and dashed, not picked. The control points are
// own points and are drawn, picked and dragged as every point is.
export interface ControlPolygon {
  curve: Id;
  points: Point2[];
}
