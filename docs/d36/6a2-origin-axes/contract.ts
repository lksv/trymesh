// Contract of the point 6a2 (D71): the axes of the origin as lines of every sketch. A draft for
// review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It was section 5 of the contract
// of 6b (D69) until the owner moved the axes out of 6b (answer 1 of docs/d36/6-cross-review.md); it
// imports the real types of the engine (6a, D64, is implemented with its fix) and states what 6a2
// adds or changes. The design is design.md, the calls are calls.ts.
//
// What changes:
// 1. Two entities every sketch has, `origin/x` and `origin/y`: fixed lines through the origin.
//    `entityOf` answers for them, the list of curves and the geometry of every sketch hold them.
// 2. The solver's slot of 6a, written: the axes are in the input only when a constraint of the
//    sketch names one, under the key `origin`, without a value and without a stamp.
// 3. They are not in `SketchResult`. One function gives a reader that has only the sketch and its
//    result (a sketch tool, the app's view) the curves and the positions the recompute holds, the
//    axes among them; 6e's `toolBase` is built on it, and its `stepBase` on `sketchCurves`.
// 4. Two refusals in the catalog of constraints (`midpoint`, `equalLength`), one helper for every
//    reader that clamps a line to its two ends (`lineExtent`: an axis is a whole line), the two
//    lines in the app's pickers.
// No command, no query, no feature type, no face role, no issue code, no schema step.

import type { Id, Point2, SketchFeature, SketchResult } from '../../../packages/engine/src/index';
import type { EntryGeometry, ResolvedReference } from '../../../packages/engine/src/references/spec';
import type { SketchCurve, SketchGeometry } from '../../../packages/engine/src/sketch';
import type { Entity } from '../../../packages/engine/src/sketch-content';
import type { SketchBase } from '../6e-trim-extend-split/contract';

// ================================================================ 1. the two lines

// `origin/x` and `origin/y`: lines of every sketch from `origin` to the hidden points `origin/x/b`
// at (1, 0) and `origin/y/b` at (0, 1), so their sense is +X and +Y of the sketch (an `angle`
// dimension, a revolve about `sketchLine`, a direction of a pattern of 6c read it). They are the
// only entities under `origin/`; the two far points are no entities (6a's `hidden`). In util.ts
// beside ORIGIN. In types.ts the comment of `ExternalRef` and of the constraints says so for the AI:
// "every sketch has the lines `origin/x` and `origin/y` through its origin along its X and Y; a
// constraint, a mirror or a pattern of the sketch and an axis `{ kind: 'sketchLine', sketch, line }`
// may name them; they are whole lines, so `midpoint` and `equalLength` do not take them".
export const ORIGIN_AXES = ['origin/x', 'origin/y'] as const;
export type OriginAxis = (typeof ORIGIN_AXES)[number];
export const isOriginAxis = (id: Id): id is OriginAxis => id === 'origin/x' || id === 'origin/y';
// Whether an ID is under `origin/`: an axis or one of the two far points. What a later package
// refuses by this (6b: an entity of another sketch to project) reads it here.
export const underOrigin = (id: Id): boolean => id.startsWith('origin/');

// Their geometry, a constant of sketch-content.ts (the leaf that says what an entity is): what
// `sketchCurves` adds to the list of every sketch, what the state's `geometry` holds, and what the
// first stage of the step puts into the solver under the key `origin` when a constraint names one.
export const AXES_GEOMETRY: EntryGeometry = {
  points: { 'origin/x/b': { x: 1, y: 0 }, 'origin/y/b': { x: 0, y: 1 } },
  curves: { 'origin/x': { type: 'line', a: 'origin', b: 'origin/x/b' }, 'origin/y': { type: 'line', a: 'origin', b: 'origin/y/b' } },
  radii: {},
  regions: [],
  hidden: ['origin/x/b', 'origin/y/b'],
};

// `entityOf(sketch, 'origin/x')` answers a line that is not own; `referenceEntities` does not list
// the axes (they are no entry of `external`), and nothing answers for `origin/x/b`.
export const AXIS_ENTITY: Entity = { kind: 'line', own: false };
// The points of an axis for the own rules of the catalog (`ruleProblem` of features/sketch.ts: a
// symmetric point is no end of its axis): `origin`. (Since the fix of 6a the points of an entry are
// read from the registry; an axis is no entry, so this is one more line of `pointsOf`.)
export const AXIS_POINTS = (_axis: OriginAxis): Id[] => ['origin'];

// ================================================================ 2. the solver's slot

// Whether a constraint of the sketch names an axis (a reference dimension too: `measure` reads the
// curves of the input, so a reference dimension to an axis is measured).
export declare function axesNamed(feature: SketchFeature): boolean;

// The first stage of the step after 6a2 (`resolveReferences` of references/index.ts): the entries
// as today, then, when `axesNamed`, the key `origin` with AXES_GEOMETRY and no value. `solverSetup`
// takes it as it takes any resolved reference: the two far points fixed, the two lines in the
// curves of the input; a key without a value is not stamped and not stored, which is the slot 6a
// fixed. A sketch whose constraints name no axis has the input and the stamp it has today.
export interface ResolvedWithAxes {
  resolved: Record<Id, ResolvedReference> & { origin?: { geometry: EntryGeometry } };
}

// The axes as curves of the list (`SketchCurve`s of sketch.ts: reference geometry that forms no
// regions), made from AXES_GEOMETRY in one place, AXIS_CURVES of sketch.ts. Two functions append it
// and nothing else does: `sketchCurves` (the recompute, and through it 6e's `stepBase`) and
// `solvedCurves` (below: a reader without a recompute, and through it 6e's `toolBase`). This is
// "the one helper of 6a2 that both builders call" of 6e's design ("Plug-in points").
export const AXIS_CURVES: readonly SketchCurve[] = ORIGIN_AXES.map((id) => ({ id, shape: AXES_GEOMETRY.curves[id], source: 'reference', regions: false }));

// The step after 6a2, in order:
// 1. the first stage (above);
// 2. `solverSetup` and the solver, as today;
// 3. the state: `geometry` the positions used and the two far points always; `curves` from
//    `sketchCurves`, the axes always (once, also when the input had them); `joins` as today;
// 4. the profile; the result: `points` without the hidden points, `curves` of the entries only.

// ================================================================ 3. not in the result

export interface SketchResultNote {
  // `SketchResult.points` holds no far point and `SketchResult.curves` no axis: a curve of the
  // result would name a point the result does not have, and every result of every model would
  // change for two lines that are constants.
  axesInResult: false;
}

// The curves and the positions of a solved sketch as the recompute holds them (`SketchState.curves`
// and `geometry`), for a reader that has only the sketch and its result. In sketch.ts beside
// `sketchCurves`.
// - The curves: the own curves of the sketch given (`regions` unless a construction curve), the
//   curves of `result.curves` whatever their `source` (the reference curves; after 6c also the
//   copies as that result has them), and AXIS_CURVES.
// - The positions: those of the result, the two far points, and, for a point of the sketch that
//   the result does not have, the position the sketch holds (per point, as `pointAt` of
//   sketch-tools.ts does today). A tool gives the sketch after its batch with the result from
//   before it, so the points the batch adds are found there.
// - Without a result (the sketch did not evaluate): the own curves and the axes over the positions
//   of the sketch.
// Its readers: `shapeOf` and the positions of sketch-tools.ts (a snap, the fillet), the app's view,
// and 6e's `toolBase(sketch, result, more?)`, which is this answer less the curves with
// `source: 'derived'` (the core `sketchWorld` derives the copies again from the entries of the
// sketch it is given), with `more.points` and `more.radii` over the positions and the `coincident`
// pairs with `more.pairs` beside it. `stepBase(feature, references, geometry)` needs nothing of
// this: it reads `sketchCurves`, which has the axes, and the geometry of the state, which has the
// far points. None of the readers adds the axes by itself.
export interface SolvedCurves {
  curves: Map<Id, SketchCurve>;
  geometry: SketchGeometry;
}
export declare function solvedCurves(sketch: SketchFeature, result: SketchResult | undefined): SolvedCurves;
// What 6e's builder for a tool is over it (its contract declares `toolBase`; restated as a check of
// the types: the curves and the geometry of a base are those of this answer).
export const baseOver = (sketch: SketchFeature, solved: SolvedCurves): Pick<SketchBase, 'sketch' | 'curves' | 'geometry'> => ({
  sketch,
  curves: [...solved.curves.values()].filter((curve) => curve.source !== 'derived'),
  geometry: solved.geometry,
});

// ================================================================ 4. constraints, tools, the app

// The catalog's `check` of `midpoint` and `equalLength` refuses an axis (catalog.ts; it reads the
// operand IDs it is given):
export const AXIS_HAS_NO_LENGTH = (axis: OriginAxis): string => `${axis} is an axis of the origin, a whole line: it has no length and no middle`;

// An axis is a whole line, and its curve in the list is the segment of 1 mm from `origin` to its
// far point. A reader that takes a line as the stretch between its two ends would see that
// millimetre: a snap to `origin/x` at x = 10 would land on (1, 0), and a line at x = 10 trimmed or
// extended `with: 'origin/x'` would find no contact (finding 1 of the second round of reviews).
// One helper gives such a reader the ends to use, `lineExtent` of sketch.ts: for an axis of the
// origin the two points at ∓AXIS_REACH along it, for any other line the positions of its `a` and
// `b`; undefined when the curve is no line or a point of it has no position. Its readers, each of
// which builds the shape of a line through it and never from `a` and `b` itself:
// - `shapeOf` of sketch-tools.ts (the snap of an anchor to a curve, `closestOn`; the fillet);
// - the wrapper of `curveContacts` in sketch.ts, which makes the shapes of two `SketchCurve`s for
//   the contact search (6e: trim, extend and split `with` an axis, `curveUnder`, `extendReach`,
//   the query `sketchContacts`);
// - the hit test and the snap of the app's sketch view (sketch-view.ts).
// A reader that needs only the direction or the carrier of a line (the solver, `measure`, `axis`
// of recompute/services.ts, the mirror of 6c) reads `a` and `b` as for any line.
// AXIS_REACH is 10⁶ mm: the place found on such a segment is within 1.5e-10 mm of the exact one
// (computed: a foot and a crossing at 10 mm and at 900 m from the origin), far inside the length
// tolerance, and the constraint the tool then adds puts the point on the axis exactly. A place
// beyond 1 km from the origin is clamped to the reach (numbers go to 1e9: a known limit).
export const AXIS_REACH = 1e6;
export const axisAsDrawn = (axis: OriginAxis): { a: Point2; b: Point2 } =>
  axis === 'origin/x' ? { a: { x: -AXIS_REACH, y: 0 }, b: { x: AXIS_REACH, y: 0 } } : { a: { x: 0, y: -AXIS_REACH }, b: { x: 0, y: AXIS_REACH } };
export const lineExtent = (curve: SketchCurve, geometry: SketchGeometry): { a: Point2; b: Point2 } | undefined => {
  if (curve.shape.type !== 'line') return undefined;
  if (isOriginAxis(curve.id)) return axisAsDrawn(curve.id);
  const [a, b] = [geometry.points[curve.shape.a], geometry.points[curve.shape.b]];
  return a && b ? { a, b } : undefined;
};

// The app.
// - The two lines are curves of the view of an open sketch (not own; `solvedCurves` gives them),
//   hovered, selected and snapped to as lines through `lineExtent`.
// - They are drawn in a bucket of their own, `axes` (sketch-mode.ts, `sketchScene`: thin, in the
//   colour of a plane), not with the solid curves of `external`, and each as the stretch of the
//   axis inside the visible part of the sketch plane, computed again when the camera moves: the
//   camera sees a depth of 10000, so a line drawn to ∓AXIS_REACH would be cut by it or lost. The
//   fit of the camera does not read them.
// - A line without a length: `hasLength(view, line)` of sketch-commands.ts is false for an axis.
//   The offers that measure a line read it: `equalLength` and `midpoint` in `geometricFor` (which
//   has `equalLength` in a `case` of its own, past the catalog's `check`, so the button would stay
//   enabled and the engine refuse on the click), and the length dimension of one selected line in
//   `dimensionFor` (`lineEnds` would name the hidden point `origin/x/b`). A point and an axis
//   still offer *Point on curve* and the distance to it, two points and an axis *Symmetric*.
// - The pickers of a line of a sketch (`lineIds` of sketch-commands.ts: the axis picker, the
//   mechanism panel) list `origin/x` and `origin/y` after the lines of the sketch.
export declare function hasLength(line: Id): boolean;
export declare function lineIds(sketch: SketchFeature): Id[];
