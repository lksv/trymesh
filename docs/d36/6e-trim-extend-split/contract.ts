// Contract of package 6e (D65): trim, extend and split as sketch tools. A draft for review, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and
// states what the package adds. The design is design.md; the calls are calls.ts.
//
// What changes:
// 1. The sketch tools get three entries (`trim`, `extend`, `split`) and two input kinds: a curve
//    of the sketch by its ID, and a place in the sketch given by its coordinates.
// 2. sketch.ts exports the test of the profile that says where two curves touch apart from
//    a joined end (`curveContacts`); the profile's own test becomes "no contact" (no change of
//    behaviour). The tools cut at exactly the points that make a profile invalid.
// 3. sketch-tools.ts exports what the app draws while a tool is under the pointer: the piece
//    a trim would remove and the reach of an extension.
// 4. Nothing else: no command, no field of the document, no feature type, no face role, no issue
//    code, no query, no upgrade step. The batches are made of commands every build knows
//    (addPoint, addCurve, setCurvePoint, removeEntity, addConstraint, removeConstraint,
//    updateFeature).

import type { CurvePointName, Id, NewId, SketchFeature, SketchToolContext, SketchToolInput, SketchToolInputs, SketchToolSpec, Vec2 } from '../../../packages/engine/src/index';
import type { SketchGeometry } from '../../../packages/engine/src/sketch';
import type { CommandAfter, DocumentAfter } from '../00-prep/contract';

// ================================================================ 1. input kinds

// Two input kinds are added to `SketchToolInput`:
// - `curve`: the ID of a curve of the sketch. An own curve; with `projected: true` also a curve of
//   projected geometry (the curves a cut may be made against). `sketchTool` checks that the
//   sketch has it, that it is a curve, and that it has a solved position.
// - `place`: coordinates `[x, y]` of the sketch, two finite numbers within ±MAX_NUMBER. It is
//   a place, not a point: nothing is made there and nothing snaps to it.
// Both may be optional, as a number or an option may today.
export type SketchToolInputAfter = SketchToolInput | { kind: 'curve'; projected?: boolean; optional?: boolean } | { kind: 'place'; optional?: boolean };
export interface SketchToolSpecAfter extends Omit<SketchToolSpec, 'inputs'> {
  inputs: Record<string, SketchToolInputAfter>;
}

// What `sketchTool` takes, as after D52: the context with the document. The three tools read the
// document to patch the features that read the curves they change, as the fillet does.
export interface SketchToolCallAfter extends SketchToolContext {
  document: DocumentAfter;
}
export type SketchToolResultAfter = { ok: true; commands: CommandAfter[]; ids: Record<string, Id[]> } | { ok: false; message: string };

// ================================================================ 2. the three tools

// `trim`: the piece of `curve` nearest to `at` goes. A piece is the part of the curve between two
// neighbouring cuts, or between a cut and an end; a cut is a point where another curve touches
// it (CUTS below). `with`: only the contacts with that curve are cuts (the piece runs past the
// others), "trim back to that curve".
export interface TrimInput {
  curve: Id;
  at: Vec2;
  with?: Id;
}
// `extend`: the end `end` of a line (`a`, `b`) or of an arc (`start`, `end`) moves along the
// extension of the curve to the first point where the extension touches another curve; with
// `with`, the first point where it touches that curve.
export interface ExtendInput {
  curve: Id;
  end: Exclude<CurvePointName, 'center'>;
  with?: Id;
}
// `split`: `curve` is cut at every cut on it (with `with`, at its contacts with that curve; with
// `at`, at the one cut nearest to `at`). Without `curve`, every contact of two curves of the
// profile (own curves that are not construction curves) in the sketch is cut: what makes the
// profile invalid, apart from what the tool cannot cut (KnownUncut below).
export interface SplitInput {
  curve?: Id;
  with?: Id;
  at?: Vec2;
}
export interface SketchToolInputsAfter extends SketchToolInputs {
  trim: TrimInput;
  extend: ExtendInput;
  split: SplitInput;
}
export declare function sketchTool<K extends keyof SketchToolInputsAfter>(tool: K, context: SketchToolCallAfter, input: SketchToolInputsAfter[K], newId: NewId): SketchToolResultAfter;
// As today (sketch-tools.ts); restated over the document with what the packages add.
export declare function freshIds(document: DocumentAfter, prefix?: string): NewId;

// ---------------------------------------------------------------- what the three tools return

// Every tool returns the same lists; every list is always there and may be empty. The order of
// each is stated. The summaries of the entries below say it for the AI.
export const CUT_IDS = {
  changed: 'curves that keep their ID and were changed: re-pointed, cut into pieces, or a circle that became an arc (the keeper of each cut curve), in the order of their IDs',
  added: 'new curves: for each changed curve in the order of `changed`, its new pieces in its own direction (a line from `a` to `b`, an arc counter-clockwise); the span lines are in `span`, not here',
  span: 'construction lines over the old ends of a line that was cut or re-pointed and carried equalLength or midpoint; those constraints were moved onto it',
  points: 'the points at the cuts the tool used, new or already there, in the order of `changed`, each curve in its own direction (extend: the new end)',
  constraints: 'the constraints the tool added: a cut point held on a curve that was not cut there, a piece held on the line of its curve, an old end held on it',
  reattached: 'constraints that keep their ID and now name another curve: a tangency moved to the piece that has the common end, a constraint moved to a sibling piece or to a span line, the constraints of a circle that became an arc',
  removed: 'curves, points and constraints the batch removes for good: the trimmed piece when it was a whole curve, cut-off ends nothing else names, constraints that went with them or that became identities (a point on the curve it now ends)',
  touching: 'split only: circles that touch another curve at one point only and could not be split (the profile stays invalid there)',
  patched: 'features whose regions or wall the batch changed (updateFeature in the same batch), in the order of the timeline',
  dropped: 'features of which a region is gone: no region after the batch covers any of it (its outline was opened); dropped from the feature when it has other regions, else left and the feature ends in noProfile',
  pending: 'features whose regions name a changed curve while the sketch still has crossing curves after the batch: their regions were rewritten by names (each changed curve replaced by its pieces) and are followed by the tool that leaves the sketch valid',
  moved: 'sketches and plane features on a side face of a line whose start `a` was re-pointed: their plane moved along the line',
  shortened: 'features that read a face of a changed curve directly and were not patched: walls along a curve that lost a piece, sketches that project an edge of such a face, chamfers and fillets of such an edge',
  broken: 'features that name a curve the batch removes (an axis, a face of it, a wall that loses every curve): they end in error unless repaired',
} as const;
export type CutIds = { [K in keyof typeof CUT_IDS]: Id[] };

// The cuts (all three tools). A cut of a curve X is a point where another curve C touches X apart
// from an end the two share: the points `curveContacts` returns for the pair (a crossing, a touch,
// an end of one lying on the other, the ends of an overlap of two collinear lines or of two arcs
// on one circle). With LENGTH_TOLERANCE (1e-6 mm): a cut within the tolerance of an end of X is no
// cut of X (it is that end); cuts within the tolerance of each other are one.
// - Which C cut: every other curve of the sketch: own curves (construction ones too) and projected
//   curves (`with` narrows it to one). Split without `curve` takes the pairs of curves of the
//   profile only.
// - The point at a cut: an own point (or `origin`) within the tolerance that one of the two curves
//   ends at or holds by pointOnCurve is used; otherwise a new point at the exact place.
// - The other curve is cut there too when both curves take part in the profile (own, not
//   construction): the profile needs a common vertex. Otherwise the point is held on it
//   (pointOnCurve), unless it ends there or holds it already.

// The entries of `SKETCH_TOOLS`, as they will stand there. The summaries are what an AI reads in
// `describe_api`.
export const TRIM = {
  title: 'Trim',
  summary:
    'Removes the piece of a curve nearest to `at`. A piece is the part between two neighbouring cuts, or between a cut and an end; a cut is a point where another curve (own, construction or projected) crosses or touches the curve apart from a common end, and with `with` only the contacts with that curve. The other curve is cut at the same points when both take part in the profile, so a crossing becomes a common point of the two and the profile can close there. What stays keeps its constraints: the piece with the start of the curve keeps its ID; a middle piece removed leaves a new line or arc beyond it, held on the line of the curve (pointOnCurve) or on its circle (the same centre); a circle trimmed becomes an arc under its ID with its constraints. A piece with no cut inside it (a curve that crosses nothing, or a piece left by an earlier split) is removed whole; what held its line or circle moves to a sibling piece on the same line or centre. An end cut off stays, held on the line or circle of the curve, when anything else names it (another curve, a dimension, a feature), so a dimension of the whole curve still measures it; otherwise it is removed. equalLength and midpoint of a cut line move to a construction line over its old ends (`ids.span`). The regions of the features over the sketch follow (`ids.patched`): a region that is gone is replaced by the regions after the batch that lie on the same side of a piece of its curves; a region whose area was opened is dropped (`ids.dropped`). Check `moved`, `shortened` and `broken`, and the problems of the answer. To repair crossing curves: split the whole sketch (split without curve), then trim the pieces that should go, `at` a point of each.',
  inputs: { curve: { kind: 'curve' }, at: { kind: 'place' }, with: { kind: 'curve', projected: true, optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

export const EXTEND = {
  title: 'Extend',
  summary:
    'Moves an end of a line (`a` or `b`) or of an arc (`start` or `end`) along the line or the circle of the curve to the first place where the extension meets another curve (own, construction or projected; with `with`, that curve only, which must be met within its own extent). The point there is used or made, and the curve it meets is cut there when both take part in the profile. The old end stays on the line or circle of the curve when anything else names it, else it is removed. Refused: an end that another curve also ends at, an extension that meets nothing, an arc whose extension would reach its own other end first. The regions of the features over the sketch follow, as for trim.',
  inputs: { curve: { kind: 'curve' }, end: { kind: 'option', options: ['a', 'b', 'start', 'end'] }, with: { kind: 'curve', projected: true, optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

export const SPLIT = {
  title: 'Split',
  summary:
    'Cuts curves into pieces at the points where other curves cross or touch them, and nothing is removed. With `curve`: that curve at all its cuts (`with`: at its contacts with that curve only; `at`: at the one cut nearest to `at`). Without `curve`: every contact of two curves of the profile in the sketch, which is what makes a profile with crossing curves invalid; a sketch with nothing to cut gives an empty batch. Each piece is a curve of its own, so each region between crossing curves has its own name (a line through a circle gives two regions, named by the two arcs and the middle piece). Constraints stay as for trim; a circle cut at two or more points becomes arcs on its centre, the first under its ID. A circle touched at one point only cannot be split (`ids.touching`). The regions of the features over the sketch follow: a region cut into several is replaced by all of them, so the bodies do not change. Then trim the pieces that should go.',
  inputs: { curve: { kind: 'curve', optional: true }, with: { kind: 'curve', projected: true, optional: true }, at: { kind: 'place', optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

// ================================================================ 3. what the profile and the app read

// sketch.ts: where two curves of a sketch touch apart from an end they share, as the profile's
// test finds it (the same carrier contacts, ends and tolerance; a touch within the reach of a
// shared vertex, which a tangent join has, is not a contact). `compatible` of the profile becomes
// `curveContacts(...).length === 0` for curves that are not on one circle: no change of behaviour.
// Curves are given by ID and read from the sketch and the geometry (own and projected curves;
// a construction curve as well, which the profile skips but a cut does not).
export interface CurveContact {
  at: Vec2;
}
export declare function curveContacts(sketch: SketchFeature, geometry: SketchGeometry, a: Id, b: Id): CurveContact[];

// sketch-tools.ts: what the app draws under the pointer. Undefined when the tool would refuse.
export type PieceShape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number } | { type: 'circle'; center: Vec2; radius: number };
// The piece `trim` would remove.
export declare function trimPiece(context: SketchToolContext, input: TrimInput): PieceShape | undefined;
// Where `extend` would move the end.
export declare function extendReach(context: SketchToolContext, input: ExtendInput): Vec2 | undefined;
// The contacts of the profile curves of a sketch, for marking them in the view while the profile
// is invalid.
export declare function profileContacts(context: SketchToolContext): Vec2[];

// ================================================================ 4. what is not cut

// Kinds of geometry no tool cuts, and what a contact with them does:
// - a projected curve (an edge today; a curve of another sketch with 6b): never cut, it is
//   reference geometry; a contact with it is a cut of the own curve, held on it by pointOnCurve.
//   One that forms regions (6b with the flag of question 4, an outline of 6f) therefore cannot
//   get a common vertex with an own curve, and a profile where the two cross stays invalid
//   (design.md, "Open", 1);
// - a derived copy of 6c: never cut and not a cut (a point cannot be held on it in its own
//   sketch);
// - a spline of 6d: never cut and not a cut until a point can be held on a spline (the full
//   variant of 6d); every switch on the kind of a curve in the tools refuses it by name;
// - two circles, or a circle and an arc, on one circle: no point to cut at; left as they are.
export type KnownUncut = 'projected' | 'derivedCopy' | 'spline' | 'sameCircle';
