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
//    axes among them.
// 4. Two refusals in the catalog of constraints (`midpoint`, `equalLength`), the long line the
//    sketch tools see, the two lines in the app's pickers.
// No command, no query, no feature type, no face role, no issue code, no schema step.

import type { Id, Point2, SketchFeature, SketchResult } from '../../../packages/engine/src/index';
import type { EntryGeometry, ResolvedReference } from '../../../packages/engine/src/references/spec';
import type { SketchCurve, SketchGeometry } from '../../../packages/engine/src/sketch';
import type { Entity } from '../../../packages/engine/src/sketch-content';

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
// and `geometry`), for a reader that has only the sketch and its result: the own curves of the
// document (`regions` unless a construction curve), the curves of the entries from `result.curves`,
// and the two axes; the positions of the result with the two far points. Without a result (the
// sketch did not evaluate): the own curves and the axes over the positions of the document.
// In sketch.ts beside `sketchCurves`. Its readers: `shapeOf` and the positions of sketch-tools.ts,
// the profile a tool builds in memory (6e's `toolWorld`, 6c's `withDerived` called from a tool, each
// adding its joins), the app's view. None of them adds the axes by itself.
export interface SolvedCurves {
  curves: Map<Id, SketchCurve>;
  geometry: SketchGeometry;
}
export declare function solvedCurves(sketch: SketchFeature, result: SketchResult | undefined): SolvedCurves;

// ================================================================ 4. constraints, tools, the app

// The catalog's `check` of `midpoint` and `equalLength` refuses an axis (catalog.ts; it reads the
// operand IDs it is given):
export const AXIS_HAS_NO_LENGTH = (axis: OriginAxis): string => `${axis} is an axis of the origin, a whole line: it has no length and no middle`;

// How far the sketch tools (`shapeOf` of sketch-tools.ts) and the app's view reach along an axis:
// they see it as the line from −AXIS_REACH to +AXIS_REACH (mm) through the origin, since they clamp
// a line to its segment (`closestOn`) and the hidden segment is 1 mm long.
export const AXIS_REACH = 1e6;
export const axisAsDrawn = (axis: OriginAxis): { a: Point2; b: Point2 } =>
  axis === 'origin/x' ? { a: { x: -AXIS_REACH, y: 0 }, b: { x: AXIS_REACH, y: 0 } } : { a: { x: 0, y: -AXIS_REACH }, b: { x: 0, y: AXIS_REACH } };

// The app: the two lines are curves of the view of an open sketch (not own; `solvedCurves` gives
// them), drawn across the view in the style of reference geometry, hovered, selected and snapped to
// as lines; the pickers of a line of a sketch (`lineIds` of sketch-commands.ts: the axis picker, the
// mechanism panel) list `origin/x` and `origin/y` after the lines of the sketch.
export declare function lineIds(sketch: SketchFeature): Id[];
