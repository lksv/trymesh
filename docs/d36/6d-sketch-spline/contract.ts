// Contract of package 6d (D70): splines, the cheap variant. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and the
// vocabulary of 6a (docs/d36/6a-sketch-prep/contract.ts, implemented), and states what 6d adds or
// changes; the design is design.md, the calls are calls.ts.
//
// What changes:
// 1. A curve kind `spline`: a clamped, uniform, non-rational B-spline of degree min(3, n − 1) over
//    n control points that are ordinary points of the sketch. `CurveShape`, `Curve`, `EntityKind`
//    and `CURVE_POINTS` get it; the validator of a curve, the commands that take a curve, and every
//    exhaustive switch on the kind of a curve that 6a left (the engine, the solver adapter, the app)
//    say what a spline is there.
// 2. A leaf module `spline.ts` of the engine: the Bezier pieces of a spline (Boehm's knot
//    insertion, for any knots, so 6f and the Onshape converter reuse it) and its polyline within
//    the chord tolerance.
// 3. The profile takes a spline as one shape over its polyline; a loop through a spline has no
//    exact curves and names the spline (`Loop.sampled`), so the offset, the taper and the revolve
//    refuse it by one message; the wall refuses it at the command and in the recompute.
// 4. The side face of a spline is `swept` along the direction of the extrusion; its edges are of the
//    kind `other`.
// 5. The app: a sketch tool `spline`, the curve and its control polygon in the view.
// Nothing else: no command, no constraint, no query, no issue code, no feature type, no face role,
// no upgrade step, no change of the solver port beyond the one more kind of `Curve` it carries.

import type { CurveShape, Id, Point2, SketchResult, SolveInput, Vec2 } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { CurveEnd, Loop, PlacedCurve } from '../../../packages/engine/src/sketch';
import type { SideCurve } from '../../../packages/engine/src/recompute/state';
import type { AnchorStandIn, ResultCurve, SketchContextStandIn, SketchPlaceTool } from '../6a-sketch-prep/contract';

// ================================================================ 1. the curve

// A spline: a smooth curve over control points (D70). The text below is the comment that goes into
// `types.ts` at `CurveShape`, which `describe_api` gives the AI.
// - `points`: the control points in order, own points of the sketch or `origin`, 3 to 64. The
//   curve starts at the first and ends at the last; the points between pull it and lie off it in
//   general. The same point may not be listed twice, except the first again as the last: the
//   spline is then closed (at least 4 entries), with a corner at that point unless the first and
//   the last leg of the control polygon are made to lie on one line.
// - The curve is a B-spline of degree 3 (2 for three points), clamped (it starts at the first
//   point along the first leg, from `points[0]` towards `points[1]`, and ends at the last along the
//   last leg), with uniform knots, not rational. Four points are one cubic Bezier curve; three one
//   quadratic. It has no other field: no degree, no knots, no weights.
// - The solver sees only the points: no constraint names a spline, and nothing holds a point on
//   it. Shape it by constraining its control points like any points. A spline tangent at its end
//   to a line that ends at the same point: hold the second control point on that line
//   (`pointOnCurve`, which includes the extension of the line). Tangent to an arc or a circle at an
//   end on it: a construction line from the end along the first leg (`points[0]` to `points[1]`),
//   tangent to the arc (`tangent`). The same at the last point with the last leg.
// - A spline forms regions with the other curves (unless it is a construction curve). The profile
//   uses its polyline within the chord tolerance of the document: a spline that crosses itself
//   or another curve, or touches one away from a shared end, makes the profile invalid as two
//   crossing curves do.
// - The side face of an extrusion is `{ role: 'side', curve: <the spline> }`, one face for the
//   whole spline, a swept surface; its edges have the kind `other`, so they cannot be projected,
//   chamfered or filleted, and a sketch cannot stand on the face. A profile with a spline cannot
//   be offset, tapered or revolved, and a wall does not run along a spline (`invalidProfile`
//   naming the spline).
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
// The refusal of `setCurvePoint` for a spline (document.ts, D52).
export declare const SET_CURVE_POINT_SPLINE: (id: Id) => string; // `setCurvePoint.id: "${id}" is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch`

// ================================================================ 2. spline.ts

// A leaf of the engine beside sketch-content.ts: it imports only the types and util.ts. Pure
// functions over positions; nothing here reads a sketch.

// The Bezier pieces of a non-rational B-spline of degree `degree` with the knot vector `knots`
// (non-decreasing, `control.length + degree + 1` long, clamped: the first and the last knot repeated
// `degree + 1` times): every inner knot inserted until it is `degree` times there (Boehm), then one
// piece of `degree + 1` points per span of non-zero length, in order. The general form serves 6f
// (a DXF `SPLINE` of any knots becomes a chain of Bezier splines, exactly) and the converter of
// Onshape models.
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
export declare const MAX_SPLINE_PIECES: 4096;
export declare function splinePieces(bezier: readonly Vec2[], chordTolerance: number): number;
// The polyline of a spline: each piece divided into equal steps of its parameter, the first point
// of every step, then the last control point. Its first point is the first control point and its
// last the last, exactly. It is computed from the control points in their order, once per curve;
// both directions of a loop walk the same list, so regions that share the spline share its points.
export declare function splinePolyline(control: readonly Vec2[], chordTolerance: number): Vec2[];

// ================================================================ 3. the profile

// The one shape function of 6a (`placedCurve`, sketch.ts) gets the spline: its ends read as the
// ends of a line are (the profile and the wall at the joined vertex, `curveOf` raw), the control
// points between them raw, as the centre of an arc is. `control[0]` is `a.p` and the last is `b.p`.
export type PlacedCurveAfter = PlacedCurve | { type: 'spline'; a: CurveEnd; b: CurveEnd; control: Vec2[] };

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

// ================================================================ 5. the result

// A curve of the result that is not own may be a spline: a mirrored or patterned one of 6c (its
// copy runs over the copies of the control points in the same order), a projected one of 6b
// (projected by its control points). 6d itself adds none: an own spline is in the document.
export interface ResultCurveAfter extends Omit<ResultCurve, 'shape'> {
  shape: CurveShapeAfter;
}
export interface SketchResult6d extends Omit<SketchResult, 'curves'> {
  curves: Record<Id, ResultCurveAfter>;
}

// ================================================================ 6. the commands

declare module '../00-prep/contract' {
  interface Commands {
    // `addCurve` of today with a spline; `radius` is refused for it as for every curve but a circle.
    addSpline: { type: 'addCurve'; sketch: Id; id: Id; curve: { construction?: boolean } & SplineShape };
  }
}

// ================================================================ 7. the app

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

// The batch that draws a spline through the places the user clicked (sketch-commands.ts): each
// place becomes a control point by `placeAnchor` (an own point or the origin is used again,
// a projected point gets a new point and a coincident, a place on a line, an arc or a circle a new
// point held on it), then `addCurve`. `closed`: the first point again at the end. Undefined, with
// nothing sent, when fewer than three places are given or two places that follow each other are
// one point.
export declare function splineCommands(sketch: Id, context: SketchContextStandIn, places: AnchorStandIn[], closed: boolean, newId: (prefix: string) => Id): unknown[] | undefined;

// The tool of the sketch bar (packages/app/src/sketch-tools/spline.ts, one line of
// `SKETCH_TOOL_UI` after `arc`):
// - `label` 'Spline', `hint` 'Click the control points; Enter ends the spline, a click on the first
//   point closes it, Esc drops it. A control point clicked onto a line holds the spline tangent to
//   it there.'
// - `picks: 'sketch'`: points first, then curves, but no spline (no point can be held on one);
//   the mode skips splines when it snaps to a curve, for every tool.
// - No `clicks`: `click` is called at every click with the places kept and the new one. It keeps
//   them all and redraws the scene; when the new place is the first point again and there are at
//   least three places before it, it draws the closed spline and keeps none.
// - `finish` (Enter): the spline through the places kept when there are at least three, else says
//   that a spline needs three control points and keeps them.
// - `draw`: the control polygon through the places and the cursor, and the spline through them once
//   there are three.
export declare const spline: SketchPlaceTool<undefined>;
export type SketchToolNameAfter = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'spline' | 'fillet' | 'project';

// What the scene of the sketch mode draws for every spline of the open sketch beyond its curve: the
// control polygon through `CurveView.points`, thin and dashed, not picked. The control points are
// own points and are drawn, picked and dragged as every point is.
export interface ControlPolygon {
  curve: Id;
  points: Point2[];
}
