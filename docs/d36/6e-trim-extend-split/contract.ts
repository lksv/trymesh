// Contract of package 6e (D65): trim, extend and split as sketch tools. A draft for review, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and
// states what the package adds. The design is design.md; the calls are calls.ts.
//
// Revised 2026-11-24 after the independent review and the owner's answers (design.md, "Reviews",
// round 4). What changed against the first contract: a contact has a kind and a touch is cut only
// where a tangency can hold it; `trim` finds its curve by the place and refuses a place that is on
// a sibling piece; the repair of the other crossings is an option whose default follows the
// document; a fifteenth list, `reshaped`; the edge lists of chamfers and fillets are patched; the
// contacts of a sketch are a query of `QUERIES`, not a function exported for the app; the flag of
// the input kind `curve` is `reference`; the three entries of the app are written against 6a's
// contract (calls.ts, f).
//
// Fixed 2026-11-24 after the second round of reviews, over this revision and 6c's together, and the
// owner's answers 19, 20, 27 and 28 (design.md, "Reviews", round 5). What changed here: one core
// for the world of a sketch, `sketchWorld`, with a builder for the step and one for a tool, in
// place of `toolWorld` (section 6b); the plan of a batch as data for the later packages
// (`CurveChanges` with the pieces and the removed stretches) and four more plug-in points
// (`piecesOf`, `reshapedProbes`, `contactFix`, the readers of `repairsByDefault`); a trim that
// would run through a touch that is not a cut is refused, as is a place on a curve that is not
// own; the field of the query that says what a split would do is `fix`, no longer `repair`, and
// the query names the curves of a region too thin for the chord tolerance (`tight`); the app
// remembers the override of the repair with the sketch it was chosen in.
//
// What the package adds:
// 1. The sketch tools get three entries (`trim`, `extend`, `split`) and two input kinds: a curve
//    of the sketch by its ID, and a place in the sketch given by its coordinates.
// 2. sketch.ts exports the contacts of two curves as points to cut at, each with its kind
//    (`curveContacts`), built from the same carrier contacts, ends, tolerance and reach as the
//    profile's own test, which keeps its code.
// 3. The query `sketchContacts` (`QUERIES`): where the curves that form regions meet apart from
//    common points, what a split would do at each place, and why a profile is invalid when no cut
//    repairs it. The app's marks are its view.
// 4. sketch-cut.ts exports what the app draws while a tool is under the pointer (the piece a trim
//    would remove, the end an extend would move and where to, the curve a click means), and the
//    places the later packages plug into (section 6); references/world.ts the world of a sketch,
//    which the sketch step and every tool build their profiles from.
// 5. Nothing else: no command, no field of the document, no feature type, no face role, no issue
//    code, no upgrade step. The batches are made of commands every build knows (addPoint, addCurve,
//    setCurvePoint, removeEntity, addConstraint, removeConstraint, updateFeature).

import type { CurvePointName, Id, NewId, Point2, SketchFeature, SketchResult, SketchToolContext, SketchToolInput, SketchToolInputs, SketchToolSpec, Vec2 } from '../../../packages/engine/src/index';
import type { ResolvedReference } from '../../../packages/engine/src/references/index';
import type { SketchCurve, SketchGeometry } from '../../../packages/engine/src/sketch';
import type { ArgSpecs, CommandAfter, DocumentAfter } from '../00-prep/contract';

// ================================================================ 1. input kinds

// Two input kinds are added to `SketchToolInput`:
// - `curve`: the ID of a curve of the sketch. An own curve; with `reference: true` also a curve of
//   reference geometry (an entry of `external` of a reference kind: a projected edge today, an axis
//   of the origin with 6a2, a projection from another sketch with 6b, an outline with 6f): the
//   curves a cut may be made against. A curve of derived geometry (a copy of 6c) is refused for
//   both, with the reason. `sketchTool` checks that the sketch has the curve, that it is a curve,
//   and that it has a solved position. (The first contract called the flag `projected`; 6a's word
//   for geometry computed before the solver is a reference.)
// - `place`: coordinates `[x, y]` of the sketch, two finite numbers within ±MAX_NUMBER. It is
//   a place, not a point: nothing is made there and nothing snaps to it.
// Both may be optional, as a number or an option may today.
export type SketchToolInputAfter = SketchToolInput | { kind: 'curve'; reference?: boolean; optional?: boolean } | { kind: 'place'; optional?: boolean };
export interface SketchToolSpecAfter extends Omit<SketchToolSpec, 'inputs'> {
  inputs: Record<string, SketchToolInputAfter>;
}

// What `sketchTool` takes, as after D52: the context with the document. The three tools read the
// document to patch the features that read the curves they change, as the fillet does, and to
// decide the default of `repair`.
export interface SketchToolCallAfter extends SketchToolContext {
  document: DocumentAfter;
}
export type SketchToolResultAfter = { ok: true; commands: CommandAfter[]; ids: Record<string, Id[]> } | { ok: false; message: string };

// ================================================================ 2. the three tools

// `repair`: whether a trim or an extend of a curve that forms regions first cuts every other
// contact of such curves in the sketch (`on`), or cuts its own curve alone and holds its points on
// the curves there, as a construction curve is trimmed (`off`). Left out, it follows the document:
// on exactly when a feature of the document reads regions of the sketch (an extrusion or a revolve
// over its regions), because the repair exists so that those regions can be followed in the same
// batch; in a sketch of walls, where T shapes are meant, it is off.
export type Repair = 'on' | 'off';

// `trim`: the piece of a curve nearest to `at` goes. A piece is the part of the curve between two
// neighbouring cuts, or between a cut and an end. `curve` may be left out: the own curve nearest to
// `at` is trimmed (of curves equally near, one that forms regions before a construction curve, then
// the first by ID); a place that is nearer to a curve that is not own (a projection, a copy) than
// to any own curve is refused with that curve named, since the place then means it. The axes of
// the origin do not count for this: they are in every sketch, and a place on a small circle about
// the origin, or where an own curve crosses an axis, would otherwise be refused. With `curve`,
// the place has to be nearer to it than to any other own curve on its line or circle (a sibling
// piece of an earlier split): otherwise the tool refuses and names that curve, since after a split
// the ID of the curve names only its first piece. `with`: only the contacts with that curve bound
// the piece, "trim back to that curve"; it may name a construction or a reference curve, which
// otherwise do not cut a curve that forms regions. A piece that has inside it a touch that is not
// a cut (the cuts, below) is refused with the touch named: the trim cannot stop there, and
// a piece that runs through it is more than the place says.
export interface TrimInput {
  at: Vec2;
  curve?: Id;
  with?: Id;
  repair?: Repair;
}
// `extend`: the end `end` of a line (`a`, `b`) or of an arc (`start`, `end`) moves along the
// extension of the curve to the first point where the extension meets another curve; with `with`,
// the first point where it meets that curve.
export interface ExtendInput {
  curve: Id;
  end: Exclude<CurvePointName, 'center'>;
  with?: Id;
  repair?: Repair;
}
// `split`: `curve` is cut at every cut on it (with `with`, at its contacts with that curve; with
// `at`, at the one cut nearest to `at`, not on a circle). Without `curve` (and then without `with`
// and `at`), every contact of two curves that form regions and may be cut is cut, and ends of two
// such curves at one place that are not joined are joined: what makes the profile invalid, apart
// from what a cut cannot repair (KnownUncut below).
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

// Every tool returns the same fifteen lists; every list is always there and may be empty. The
// order of each is stated. The summaries of the entries below say it for the AI. The order of the
// lists is the order of the keys here; 6c appends `entries` after `broken`, the sixteenth, so no
// place of these fifteen changes.
export const CUT_IDS = {
  changed: 'curves that keep their ID and were changed: re-pointed, cut into pieces, or a circle that became an arc (the keeper of each cut curve), in the order of their IDs',
  added: 'new curves: for each changed curve in the order of `changed`, its new pieces in its own direction (a line from `a` to `b`, an arc counter-clockwise); span lines are in `span`, not here. The list is flat: to trim one of them, give `trim` the place and leave `curve` out',
  span: 'construction lines over the old ends of a line that was cut or re-pointed and carried equalLength or midpoint; those constraints were moved onto them; in the order of `changed`',
  points: 'the points at the cuts, new or already there, each once, at its first place in the order of `changed`, each curve in its own direction (extend: the new end last)',
  constraints:
    'the constraints the tool added, in the order of the batch: a piece held on the line of its curve, an old end held on the line or circle of its curve, a cut point held on a curve that is not cut there, equalRadius of arcs of one circle that share no end, a tangency between a line piece and an arc piece at a point where the two only touched, coincident of two ends at one place',
  reattached: 'constraints that keep their ID and now name another curve, in the order of their IDs: a tangency moved to the pieces that have the common end, constraints moved to a sibling piece or to a span line, the constraints of a circle that became an arc',
  removed: 'curves, points and constraints the batch removes for good, in that order and each by ID: the trimmed piece when it was a whole curve, cut-off ends nothing else names, constraints that went with them, became identities, would repeat one the sketch has (a driving constraint of the same kind and operands; the one there stays, unless only the moved one has an expression, which then stays instead) or would name one curve twice',
  uncut:
    'curves left whole at a place where something touches them, in the order of their IDs: a circle with one point only, a circle a generated profile names as an operand, two arcs or circles that only touch each other (both are listed), a curve of reference or derived geometry that forms regions and is met by an own curve (that curve is listed, not the own one: it is the one no tool can cut). The profile stays invalid there; the query sketchContacts says where and why',
  patched: 'features the batch changed in the same batch (updateFeature), in the order of the timeline: the regions or the wall of an extrusion or a revolve over the sketch, and the edges of a chamfer or a fillet that named an edge of a side face of a cut curve',
  dropped: 'features of which a region is gone: no region after the batch holds any of it (its outline was opened), or a region left with no curve by the rewrite of `pending`; dropped from the feature when it has other regions (the feature is then also in `patched`), else left and the feature ends in noProfile. Also features with a region that could not be followed: it could not be rebuilt as it was, the faces could not be built while the sketch after the batch is valid, or a face next to a loop without exact curves was too thin to be told inside from outside; that region is left in their list as it is. A region is followed when it names a changed curve, when it was a region before the batch, or when the batch makes an invalid profile valid and the sketch has every curve the region names (a region left from `pending`); a region that is none of these is left alone and its feature is in no list. In the order of the timeline',
  pending: 'features whose regions name a changed curve while the sketch still has contacts after the batch (one the tools do not cut, one that split with `with` or `at` was not asked to cut, or one left by a trim or an extend with the repair off): their regions were rewritten by names (each changed curve replaced by its pieces that stay; the feature is also in `patched`). A region whose curves were only cut still names a closed outline, and the next tool that leaves the sketch valid follows it. A region whose outline lost a piece (a trim with the repair off, or beside a contact no tool can cut) names an open chain: no later tool can follow it, the tool that next leaves the sketch valid lists the feature in `dropped` (whatever curve it changes), and the region has to be picked again; in the order of the timeline',
  reshaped: 'features with a region that keeps its name while the batch changed the holes inside it: a trim opened the outline of a hole (the hole is filled, or smaller), or an extension closed a loop inside the region (a new hole). The reference does not change and the body does; in the order of the timeline',
  moved: 'sketches and plane features on a side face of a line whose start `a` was re-pointed: their plane moved along the line; in the order of the timeline',
  shortened: 'features that read a face of a changed curve directly and are not in `moved`: walls along a curve that lost a piece and chamfers and fillets whose edge lost a piece (both also in `patched`), sketches that project an edge of such a face, chamfers and fillets of an edge of such a face with a face of another feature (which piece meets that face is not known from the sketch, so the edge is left as it is), features that name the face of a chamfer or a fillet whose edge was rewritten; in the order of the timeline',
  broken: 'features and sections that name what the batch removes or renames: a removed curve or a face of it, an axis on it (also of a joint), a wall left with no curve, the straight end of a wall (wallEnd) whose chain no longer ends at that point, a chamfer or a fillet with an edge that no piece has any more and that is left in its list because something names a face of the blend at its place or a later one (a face is named by the place of its edge, so taking the edge out would hand those names to other faces), or because it is the only edge and a list may not be empty; features in the order of the timeline, then the IDs of section entries',
} as const;
export type CutIds = { [K in keyof typeof CUT_IDS]: Id[] };

// The cuts (all three tools). A cut of a curve X is a contact of X with another curve
// (`curveContacts`, section 3) that is not within LENGTH_TOLERANCE (1e-6 mm) of an end of X; cuts
// within the tolerance of each other are one.
// - Which curves cut X (the three predicates of section 6). X has to be a curve that may be cut.
//   When X forms regions: the other curves that form regions. Where such a curve may be cut it is
//   cut there too; where it may not (reference or derived geometry that forms regions), the
//   contact cannot be repaired and neither curve is cut (`uncut`). A curve that forms no regions
//   (a construction curve, a reference curve without the flag) cuts X only when `with` names it.
//   When X forms no regions (a construction curve): every other curve that can hold a point.
//   `with` selects the contacts with one curve of any kind among those that bound a piece, stop an
//   extension, or are split by split { curve, with }; the repair of the other contacts does not
//   read it.
// - A touch (the two curves are tangent there, away from the ends of both) is a cut only where
//   both curves are cut and one of them is a line: the tangency then holds the point (the existing
//   `tangent` of the two moved to a line piece and an arc piece that have it, else one added). Two arcs or circles
//   that touch, a circle that would get that one point, and a touch with a curve that is not cut
//   there (a construction X, a `with` curve, the repair off) are not cuts. Such a touch bounds no
//   piece and stops no extension; a trim whose piece has one inside it is refused, and so is an
//   extension that would leave one in a profile that was valid.
// - The cuts of a circle are ordered by the angle about its centre from the x axis of the sketch,
//   in [0, 2π), and an angle within the length tolerance of a full turn, measured along the circle
//   ((2π − angle) · r ≤ LENGTH_TOLERANCE), is 0: a cut on the +x ray from the centre must not be
//   the first or the last by the noise of the solver, since the first piece keeps the ID.
// - The point at a cut: an own point (or `origin`) within the tolerance that one of the two curves
//   ends at (its class by pointJoins) or holds by pointOnCurve is used; otherwise a new point at
//   the exact place. A contact at a point of reference geometry gets a new point held on that
//   curve.
// - The points of a circle are pooled over the batch; a circle with one point only is not cut
//   (`uncut`): the other curve is cut there only when the point bounds a trimmed piece or ends an
//   extension, and is then held on the circle.
// - With the repair on, a trim or an extend of a curve that forms regions first cuts every contact
//   of such curves in the sketch, as split without a curve does, apart from those inside the
//   removed piece. `with` only selects which contacts bound the piece or stop the extension; it
//   never leaves a crossing. With the repair off, and for a construction curve, only the curve
//   itself is cut, and its points are held on the curves there.

// The entries of `SKETCH_TOOLS`, as they will stand there. The summaries are what an AI reads in
// `describe_api`.
export const TRIM = {
  title: 'Trim',
  summary:
    'Removes the piece of a curve nearest to `at`. A piece is the part between two neighbouring cuts, or between a cut and an end; a cut is a point where another curve crosses the curve, ends on it, or touches it, apart from a common end. `curve` may be left out: the own curve nearest to `at` is trimmed (a place that lies on a projected curve or on a copy of a mirror or a pattern is refused: those are not trimmed; an axis of the origin does not count, and where an own curve crosses a projection or a copy, name the curve). With `curve`, `at` has to be nearer to it than to any other piece on the same line or circle: after a split the ID of a curve names only its first piece, and a place on another piece is refused with the name of that piece. The curves that cut an outline curve are the other outline curves; a construction or reference curve cuts it only when `with` names it (`with`: only the contacts with that curve bound the piece). `repair` (`on`, `off`; left out: on when a feature of the document reads regions of the sketch, off otherwise): on, the trim first cuts every other contact of outline curves in the sketch (as split without curve; contacts inside the removed piece go with it), so each becomes a common point, the profile can close and the regions of the features follow at once; off, only the trimmed curve is cut and its new ends are held on the curves there (pointOnCurve), so no other curve changes and T shapes stay (a sketch of walls). A construction curve is always trimmed that way. Pass `repair` `on` wherever a feature reads regions of the sketch or will; `off` is for a sketch whose T shapes are meant. With `off` in a sketch whose regions a feature reads, a region whose outline loses the piece is rewritten by names and cannot be followed afterwards (`ids.pending`, then `ids.dropped` at the tool that next leaves the sketch valid). What stays keeps its constraints: the piece with the start of the curve keeps its ID; a middle piece removed leaves a new line or arc beyond it, held on the line of the curve (pointOnCurve) or on its circle (the same centre); a circle trimmed becomes an arc under its ID with its constraints. A piece with no cut inside it (a curve that crosses nothing, or a piece left by an earlier split) is removed whole; what held its line or circle moves to a sibling piece on the same line or circle. Two arcs of one circle left without a common end get equalRadius. An end cut off stays, held on the line or circle of the curve, when anything else names it (another curve, any constraint, a feature, a joint), so a dimension of the whole curve still measures it; otherwise it is removed. equalLength and midpoint of a cut line move to a construction line over its old ends (`ids.span`). Where a line only touches an arc (a tangent contact away from their ends), both are cut and the tangency is kept between a line piece and an arc piece that have that point (added when the sketch had none: `ids.constraints`); two arcs that only touch are not cut (`ids.uncut`). A trim cannot stop at a touch that is not cut (two arcs; a line and an arc with the repair off; a circle that would get that one point): a piece that would run through such a touch is refused with the touch named; remove the whole curve with removeEntity, or trim a line and an arc with `repair` `on`. The regions of the features over the sketch follow (`ids.patched`): a region that is gone is replaced by every region after the batch that covers part of it; a region whose outline was opened is dropped (`ids.dropped`); while the sketch still has a contact after the batch the regions are rewritten by names instead (`ids.pending`); a region merged with its neighbour follows into the merged one, so the body grows, and a cut feature then cuts the neighbour too. A region that keeps its name while a hole inside it was opened or closed is in `ids.reshaped`: its body changes without a change of the reference. The edges of chamfers and fillets on a side of a cut curve are rewritten to the pieces (`ids.patched`); an edge whose piece is gone stays in its list while something names a face of that chamfer or fillet at its place or later, and the feature is then in `ids.broken`. Refused: a trim that takes the common end of a tangency off its curve (remove the tangency first); a piece that runs through a touch that is not cut; a place on a curve that is not own; a sketch in conflict. Check `reshaped`, `moved`, `shortened` and `broken`, and the problems of the answer. To repair crossing curves: ask the query sketchContacts where they are, split the whole sketch (split without curve), then trim the pieces that should go, each by a place on it.',
  inputs: { at: { kind: 'place' }, curve: { kind: 'curve', optional: true }, with: { kind: 'curve', reference: true, optional: true }, repair: { kind: 'option', options: ['on', 'off'], optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

export const EXTEND = {
  title: 'Extend',
  summary:
    'Moves an end of a line (`a` or `b`) or of an arc (`start` or `end`) along the line or the circle of the curve to the first place where the extension meets another curve (for an outline curve another outline curve; for a construction curve any curve; with `with`, that curve only), within that curve\'s own extent. `repair` as for trim: on (the default when a feature reads regions of the sketch), the extend first cuts every contact of outline curves in the sketch and the extended stretch at every outline curve it crosses, and the curve met is cut at the new end; when the curve itself was cut, the piece that holds the end is extended. Off, and for a construction curve, the new end is held on the curve met (pointOnCurve) and nothing else is cut. The old end stays on the line or circle of the curve when anything else names it, else it is removed. Where the extension of a line only touches an arc that is cut there, it stops there too and the tangency is kept between the line and an arc piece that has the new end. Refused: an end that another curve also ends at (also through a coincident constraint), an end lying on another outline curve, an extension that meets nothing, an arc whose extension would reach the curve as it was (its own other end) first, an extension that would leave a contact no tool can cut while the profile was valid (its end on a circle which would then have that one point, a touch along it that is not cut, or a projected curve or a copy that forms regions, crossed or ended on: the profile would become invalid for good; draw across the circle and trim instead, or change the source of the copy), a sketch in conflict. A touch that is not cut does not stop an extension. The regions of the features over the sketch follow, as for trim.',
  inputs: { curve: { kind: 'curve' }, end: { kind: 'option', options: ['a', 'b', 'start', 'end'] }, with: { kind: 'curve', reference: true, optional: true }, repair: { kind: 'option', options: ['on', 'off'], optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

export const SPLIT = {
  title: 'Split',
  summary:
    'Cuts curves into pieces at the points where other curves cross them, end on them or touch them, and nothing is removed. With `curve`: that curve at all its cuts (`with`: at its contacts with that curve only; `at`: at the one cut nearest to `at`, not on a circle). Without `curve` (and without `with` and `at`): every contact of two outline curves in the sketch, which is what makes a profile with crossing curves invalid, and two ends at one place that are not joined are joined (the curve whose end nothing else names re-pointed onto the other point, else a coincident constraint); a sketch with nothing to cut gives an empty batch when its profile is valid, and a refusal with the reason when it is invalid for something a cut cannot repair (curves lying on each other, a curve of no length, two arcs that only touch, a circle with one point). The query sketchContacts lists the places beforehand, each with what split would do there. Each piece is a curve of its own, so each region between crossing curves has its own name (a line through a circle gives two regions, named by the two arcs and the middle piece). Constraints stay as for trim; a circle cut at two or more points becomes arcs on its centre, the first under its ID. A circle touched at one point only cannot be split (`ids.uncut`). The regions of the features over the sketch follow: a region cut into several is replaced by all of them, so the bodies do not change. Then trim the pieces that should go, each by a place on it.',
  inputs: { curve: { kind: 'curve', optional: true }, with: { kind: 'curve', reference: true, optional: true }, at: { kind: 'place', optional: true } },
  ids: CUT_IDS,
} as const satisfies SketchToolSpecAfter;

// ================================================================ 3. the contacts of two curves

// sketch.ts: the contacts of two curves of a sketch as points to cut at, over 6a's `SketchCurve`
// (own and not own alike) with the joins of the profile. Built from the same carrier contacts,
// ends, tolerance and reach around a shared vertex as `compatible`, which keeps its code; the
// middles it also tries are a probe for an overlap, not points. Every pair `compatible` rejects has
// a contact, two ends to join, or lies on each other.
// - `crossing`: the carriers cross there, away from the ends of both.
// - `touch`: the carriers are tangent there (one carrier contact of a line and a round curve, or of
//   two round curves), away from the ends of both.
// - `end`: an end of one curve lies on the other away from its ends (a T). A tangent line ends on
//   a circle only to the precision of a double root, so a touch within the reach of such an end
//   (the reach of `compatible`) is this contact, not a second one beside it; `tangent` says so.
// - `overlap`: two lines on one line, or two arcs on one circle, that share a stretch: an end of
//   one that lies strictly inside the other.
// No point of any kind lies within the reach of an end the two curves share.
export type ContactKind = 'crossing' | 'touch' | 'end' | 'overlap';
export interface ContactPoint {
  at: Vec2;
  kind: ContactKind;
  tangent: boolean; // the carriers are tangent there: always for a touch, possible for an end
}
export interface CurveContacts {
  points: ContactPoint[];
  // ends of the two at one place that are not one vertex, as the index of the end of each (0 the
  // start, 1 the end): the profile rejects them and a cut cannot repair them; joining them can
  ends: [number, number][];
  // the two lie on each other along a stretch (an overlap, a duplicate), or are two curves of one
  // circle of which one is a circle: the profile rejects them whatever is cut
  lying: boolean;
}
// Undefined when either curve has no position or no length.
export declare function curveContacts(a: SketchCurve, b: SketchCurve, joins: (id: Id) => Id, geometry: SketchGeometry): CurveContacts | undefined;

// sketch.ts: why a profile is invalid when no pair of its curves touches. The last check of the
// profile is on the polygons a body would be built from (`soundTessellation`): a loop that
// collapses to fewer than three points (a region thinner than the chord tolerance, whose arc is one
// chord: what a line entering an arc by less than the chord tolerance leaves once both crossings
// are cut), or two polygon edges that cross though their curves do not. The check answered yes or
// no; it now says which curves and where (`Loop.curves` has the curve of every edge), and
// `soundTessellation` is "no problem". Undefined when the profile is valid, or invalid for a pair
// that touches (the contacts say that).
export interface TightPlace {
  curves: Id[]; // the curves of the collapsed loop, or the two whose polygon edges cross
  at: Vec2; // a place on them, in the sketch
}
export declare function profileProblem(curves: readonly SketchCurve[], joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): TightPlace | undefined;

// ================================================================ 4. the query of the contacts

// `sketchContacts` (query/sketch.ts, one line of `QUERIES`, its rows in the two typed tables of
// packages/mcp/test/queries.test.ts): where the curves of a sketch that form regions meet apart
// from common points, in the state asked about (also `at` and `after`, as every query). It reads
// what the recompute kept of the sketch (`context.sketch`: its curves, joins, positions and
// profile) and the document (a circle a generated profile names), and computes nothing of bodies
// (`geometry: 'none'`).
// Its memo names every object the answer depends on (`QueryContext.memo`): the places are kept by
// the solved sketch alone, which holds everything they are computed from, so the app's marks ask
// at every redraw for nothing; what a split would do at each place (`fix`) also reads the document
// (a circle that a generated profile of a later feature names is not cut), so the answer is kept by
// the solved sketch and the document together. An answer kept by the sketch alone would go stale
// when such a feature is added or removed without the sketch changing.
// It lists places where curves meet. An end of a copy or of a flagged projection that joined
// nothing (6c's open ends) is no such place, and a valid profile may have them: they stay in
// `SketchResult.openEnds` and in `get_sketch`.
export const SKETCH_CONTACTS_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  max: { kind: 'number', title: 'Most contacts', summary: 'The most contacts to list; `total` counts them all.', optional: true, spec: { title: 'Most contacts to list', unit: 'count', integer: true, min: { value: 1 }, default: 100 } },
} as const satisfies ArgSpecs;

// One place where two curves that form regions meet apart from a common point.
// - `kind`: as `ContactKind`, and `ends` for two ends of two curves at one place that are not
//   joined.
// - `curves`: the two curves, the smaller ID first.
// - `fix`: what split without a curve does there: `cut` (both curves get a common point),
//   `join` (the two ends become one vertex), or `none` with the reason in `why` (a circle with one
//   point only; two arcs that only touch; a circle a generated profile names; a curve of reference
//   or derived geometry, which is never cut). The first contract called the field `repair`, the
//   name of the option of trim and extend, which is another thing.
export interface SketchContact {
  at: Vec2;
  kind: ContactKind | 'ends';
  curves: [Id, Id];
  fix: 'cut' | 'join' | 'none';
  why?: string;
}
// - `status`: `unavailable` when the sketch did not evaluate (suppressed, its plane broken); the
//   other fields are then empty and `valid` false.
// - `valid`: the profile of the sketch (`SketchResult.valid`). A valid profile has no contact.
// - `contacts`: at most `max`, in the order of the IDs of their curves and then along the first
//   curve; `total` counts all of them.
// - `lying`: pairs that lie on each other along a stretch or on one circle; a cut cannot repair
//   them (trim or remove one). An overlap also has its points in `contacts`.
// - `degenerate`: curves of no length.
// - `tight`: when the profile is invalid and no contact, lying pair or curve of no length explains
//   it: the curves that enclose a region thinner than the chord tolerance, or whose polygons cross,
//   and a place on them (`profileProblem`). Trimming one of them, or moving the curves apart, is
//   the cure; no cut is.
// - `reason`: why the profile is invalid, in words, when it is: the first thing a cut cannot repair,
//   with the curves and the place it is at (of `tight` too). It is the text split without a curve
//   refuses with.
export interface SketchContactsResult {
  status: 'ok' | 'unavailable';
  valid: boolean;
  contacts: SketchContact[];
  total: number;
  lying: [Id, Id][];
  degenerate: Id[];
  tight?: TightPlace;
  reason?: string;
}
declare module '../00-prep/contract' {
  interface Queries {
    sketchContacts: { spec: typeof SKETCH_CONTACTS_ARGS; result: SketchContactsResult };
  }
}
// What the entry says of itself in the description for the AI.
export const SKETCH_CONTACTS = {
  title: 'Contacts of the outline curves of a sketch',
  summary:
    'Where the curves of a sketch that form regions cross, touch, end on each other or overlap apart from common points, which is what makes its profile invalid, and what the sketch tool split would do at each place. Ask it when a sketch reports `valid: false`, before split and trim.',
  returns:
    '`valid` (the profile), `contacts` (each `at` [x, y] in mm in the sketch, `kind`: crossing, touch, end, overlap or ends; `curves`; `fix`: what split without a curve does there, cut, join or none with `why`), `total`, `lying` (pairs lying on each other), `degenerate` (curves of no length), `tight` (the curves around a region thinner than the chord tolerance, and a place on them), `reason` (why the profile is invalid when a cut cannot repair it, with the curves and the place).',
  geometry: 'none',
} as const;

// ================================================================ 5. what the app reads

// sketch-cut.ts: what the app draws under the pointer. They take the context with the document,
// since a refusal and the default of `repair` read it; undefined where the tool would refuse. The
// same information reaches MCP through `sketch_tool` with `preview: true`, whose answer has `ids`
// and the model after the batch, so these are drawing aids and no part of the model's API.
export type PieceShape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number } | { type: 'circle'; center: Vec2; radius: number };
// The curve a place means: the own curve nearest to it, one that forms regions before
// a construction curve at the same distance (a span line lies exactly over the pieces of its
// line), then the first by ID. It is how `trim` without `curve` chooses among the own curves; the
// refusal of a place that lies on a curve that is not own is the tool's and no part of this
// function, whose picker in the app lets only own curves through. The three entries of the app
// (trim, extend, split) pass the curve their picker found and get the one a click means.
// Undefined when the sketch has no own curve.
export declare function curveUnder(context: SketchToolContext, at: Vec2, picked?: Id): Id | undefined;
// The piece `trim` would remove: read from the contacts that select it only.
export declare function trimPiece(context: SketchToolCallAfter, input: TrimInput): PieceShape | undefined;
// The end of a line or an arc nearest to a place, ends only (a centre is not one): what the app
// offers for `extend` under the pointer.
export declare function extendEnd(context: SketchToolContext, curve: Id, at: Vec2): ExtendInput['end'] | undefined;
// Where `extend` would move the end.
export declare function extendReach(context: SketchToolCallAfter, input: ExtendInput): Vec2 | undefined;
// Whether a trim or an extend without `repair` would repair: a feature of the document reads
// regions of the sketch. The app shows it as the state of its checkbox.
export declare function repairsByDefault(document: DocumentAfter, sketch: Id): boolean;

// What the tools of the app remember (6a's `options`): the curve a trim, an extend or a split is
// bounded by (`with`; set from the one curve selected, cleared in the panel; ignored when the open
// sketch has no such curve), the repair as chosen (undefined: by the document), and for split
// whether a click cuts at the nearest contact only (`at`). 6a's options outlive a sketch, and an
// override of the repair must not: `on` chosen in one sketch would cut every wall line of the next
// sketch of walls, and `off` would give up the regions of the next outline. So the choice is kept
// with the sketch it was made in and counts only while that sketch is open; in another sketch the
// checkbox shows the default of the document again.
export interface CutOptions {
  with?: Id;
  repair?: { sketch: Id; value: Repair };
}
export interface SplitOptions {
  with?: Id;
  nearest: boolean;
}

// ================================================================ 6. what the later packages plug into

// The places of sketch-cut.ts and references/world.ts that 6c, 6b, 6d and 6f change, each one
// function or one type, so that a later kind of geometry is added once (design.md, "Plug-in
// points"). The implementation keeps these names.

// (a) The three predicates of a curve of the sketch. 6e's rules are written with them alone.
// - `mayCut`: a tool may cut, trim or extend it: an own line, arc or circle that no generated
//   profile names as an operand. Never reference or derived geometry; a spline (6d) not until it
//   can be cut.
// - `formsRegions`: 6a's flag `SketchCurve.regions`: an own curve that is not a construction
//   curve, a reference curve whose entry says so, a copy as its source.
// - `holdsPoint`: a point can be held on it by `pointOnCurve` in this sketch: an own or
//   a reference line, arc or circle. Not a copy of 6c (it does not exist when the sketch is
//   solved), not a spline in the cheap variant of 6d.
export interface CurvePredicates {
  mayCut(curve: SketchCurve): boolean;
  formsRegions(curve: SketchCurve): boolean;
  holdsPoint(curve: SketchCurve): boolean;
}
export declare function curvePredicates(document: DocumentAfter, sketch: SketchFeature): CurvePredicates;

// (b) The world of a sketch: the curves, the positions and the joins that every profile is built
// from, in the recompute and in memory. One core, `sketchWorld`, for the sketch step and for every
// tool, so that the profile a tool sees is the profile the recompute makes. (The first revision had
// `toolWorld(sketch, result, extra?)` here and 6c's had `withDerived(feature, references,
// geometry)`: two functions that each claimed to be the one, of which a tool could not call the
// second, having no resolved references, and the second had no place for the joins a batch adds.)
// In packages/engine/src/references/world.ts: after `sketch.ts` and the registry of the kinds in the
// order of the imports, so the stage of 6c can be called from it, and before the feature modules.
//
// - `SketchBase` is the sketch before the stage after the solver:
//   - `sketch`: read for its entries of `external` only (6c computes the copies from them). It
//     may be a sketch that exists in memory alone: the sketch after a batch, or that sketch with
//     removed pieces put back as curves and into the entries that listed them;
//   - `curves`: the curves that are not derived: the own ones and the reference ones (with the axes
//     of the origin of 6a2), each with its flag `regions`. No copy;
//   - `geometry`: the positions of every point those curves name and the radii of their circles;
//   - `pairs`: the joins before the stage, as pairs of points: the `coincident` constraints
//     (`joinPairs`), and for a tool also what its batch joins. The core makes the vertices of them
//     with `joinsOf`, which takes a pair only when its points are within the length tolerance.
// - `sketchWorld(base)` is the core. In 6e it adds nothing: the curves as given and `joinsOf` of
//   the pairs. 6c makes it the stage after the solver (owner, answers 12 and 19): the copies of
//   every derived entry are computed from the base (curves `source: 'derived'`, their positions
//   added), the occupation pass, and the joins by position of the ends of the curves that are not
//   own and form regions (the copies, and with 6b and 6f the flagged reference curves, which need
//   no code of their own here: they are curves of the base with `regions`), with each other and
//   with the own ends at their place that are one vertex already by `pairs`. 6c also adds to the
//   answer what the step puts into the result (the copies by entry, the warnings, the open ends).
// - Two builders, side by side, so that the axes of the origin (6a2) reach both the same way:
//   - `stepBase`, for the sketch step: `sketchCurves(feature, references)`, the positions after the
//     solver, `joinPairs(feature, references)`;
//   - `toolBase`, for a tool, which has no resolved references (`SketchToolContext` is the sketch,
//     its result and the parameters): the own curves of `sketch`; the curves of `result.curves`
//     with `source: 'reference'` (those with `source: 'derived'`, the copies as they were, are
//     dropped: the core derives them again from the entries of `sketch`); the positions and radii of
//     the result with `more.points` and `more.radii` over them (the new points of a batch at their
//     exact places); the `coincident` pairs of `sketch` with `more.pairs`: what a batch joins that
//     the sketch given does not say (for the sketch as it was, the `coincident` constraints the
//     batch adds and the ends it joins by a re-point), so that the stage sees a corner the batch
//     closes.
// - Cuts in memory are made on the flat curves of a world, after the core, never on the sketch
//   before it: `cutInMemory` takes a world and the curves to cut at their contacts with each other,
//   and gives a world (its pieces have IDs that exist there alone). The faces (the removed pieces
//   put back, cut with what they touch) and the region as it was (the curves that do not cross its
//   outline, cut where they meet) are built that way, so a copy or a reference curve is cut as
//   a shape like any other, and each copy is left out or kept on its own.
export interface SketchBase {
  sketch: SketchFeature;
  curves: readonly SketchCurve[];
  geometry: SketchGeometry;
  pairs: readonly [Id, Id][];
}
export interface SketchWorld {
  curves: ReadonlyMap<Id, SketchCurve>;
  geometry: SketchGeometry;
  joins(id: Id): Id;
}
export declare function sketchWorld(base: SketchBase): SketchWorld;
export declare function stepBase(feature: SketchFeature, references: Record<Id, ResolvedReference>, geometry: SketchGeometry): SketchBase;
export declare function toolBase(sketch: SketchFeature, result: SketchResult, more?: { points?: Record<Id, Point2>; radii?: Record<Id, number>; pairs?: readonly [Id, Id][] }): SketchBase;
export declare function cutInMemory(world: SketchWorld, curves: readonly Id[]): SketchWorld;

// (c) The plan of a batch as data, and the lists of what reads a changed curve. The fillet (D52)
// and the three tools give the same record, so that a kind of reader added later (6b: a projection
// of an entity of this sketch from another sketch; 6c: an entry that lists a source) is added once,
// and so that 6c's rules read what the batch did and do not work it out again.
// - `changed`: curves that keep their ID with another extent; `restarted`: lines whose start `a`
//   was re-pointed; `rekinded`: circles that became arcs; `removed` and `removedPoints`: what the
//   batch removes.
// - `added`: the curves the batch makes in the place of what was there: the new pieces of the cut
//   curves, the arc of a fillet. `span`: the construction lines made for `equalLength` and
//   `midpoint`, which are no part of what was there.
// - `pieces`: for every curve the batch cut or trimmed, by its ID before the batch: the curves that
//   stay of it, in its own direction, the keeper among them; an empty list for a curve removed
//   whole. A curve the batch only re-pointed (an extend, the two lines of a fillet) has itself.
// - `stretches`: what the batch takes out of the sketch, each as the curves it ran over, by their
//   IDs before the batch and along the stretch (one for a trim; two for the corner of a fillet),
//   and its two bounds as points: the points at the two cuts of a trimmed piece, the ends of
//   a piece removed whole, the two tangent points of a fillet. A bound the batch removes (an end
//   nothing names) is given as it was and is in `removedPoints`. A split has none, and neither
//   has a circle removed whole: it has no ends, so there is nothing a curve could run between; it
//   is in `removed` and its entry of `pieces` is empty.
export interface RemovedStretch {
  curves: Id[];
  bounds: [Id, Id];
}
export interface CurveChanges {
  changed: Id[];
  restarted: Id[];
  rekinded: Id[];
  removed: Id[];
  removedPoints: Id[];
  added: Id[];
  span: Id[];
  pieces: Record<Id, Id[]>;
  stretches: RemovedStretch[];
}
// Features in the order of the timeline; `broken` then the IDs of section entries.
export declare function readersOf(document: DocumentAfter, sketch: Id, changes: CurveChanges): { moved: Id[]; shortened: Id[]; broken: Id[] };

// (d) What a curve that a feature names became in the batch: the curves that take its place, in
// its direction, or undefined when the batch did not change it. The rewrites by names read a curve
// through it and through nothing else: a region rewritten by names (`pending`), the curves of
// a wall, and the edges of a chamfer or a fillet on a side face of the curve. In 6e it answers
// `changes.pieces` for an own curve. 6c makes it answer for a copy: `<entry>/<n>/<X>`, for any copy
// number `n` whatever the count, becomes `<entry>/<n>/<piece>` for the pieces of X that the patched
// entry lists; the sides of copies, and a stored region of a copy the count does not make now, are
// then rewritten by the code that rewrites own curves. `sketch` is the sketch after the batch.
// Which piece has which vertex is read from the world after the batch, never from the names of
// the ends: a mirror turns an arc round.
export declare function piecesOf(changes: CurveChanges, sketch: SketchFeature, curve: Id): Id[] | undefined;

// (e) The places at which a batch may have changed a hole of a region that keeps its name: the
// middle of each removed piece and of each added stretch, each with the curve it belongs to (its ID
// before the batch). A region is compared with what it was (`reshaped`) when one of them lies
// inside its outer loop. 6c adds the image of each place under every copy of every entry that
// lists the curve: the copies of a trimmed source are trimmed with it, in another region.
// `before` is the sketch BEFORE the batch and `world` the world as it was: after the batch an
// entry no longer lists a piece that was removed whole, and its copies are gone.
export declare function reshapedProbes(before: SketchFeature, world: SketchWorld, middles: readonly { curve: Id; at: Vec2 }[]): Vec2[];

// (f) What split without a curve does at a contact, for the tools and for the query alike (the
// field `fix` of the query is this answer, so the two cannot disagree): `cut`, `join`, or `none`
// with the reason. A circle that would have one point only is decided by the caller, once every
// contact is found. Undefined: the contact is not listed at all, which 6e never answers. 6c adds:
// an own curve with a copy is `none`, with the copy and its entry named; two copies of one entry
// with one copy number are the image of a contact of their sources, which is listed and whose cut
// cures both, so the image is not listed and not counted; any other two copies are `none`. 6b and
// 6f add the reason of a flagged reference curve, 6d that of a spline.
export type ContactFix = { fix: 'cut' | 'join' } | { fix: 'none'; why: string } | undefined;
export declare function contactFix(a: SketchCurve, b: SketchCurve, kind: ContactKind | 'ends', predicates: CurvePredicates, sketch: SketchFeature): ContactFix;

// (g) `repairsByDefault` (section 5): what counts as a feature that reads regions of the sketch.
// In 6e: an entry of `PROFILE_SOURCES` with regions of this sketch. 6b adds a sketch that projects
// a curve of this sketch with the region flag: its outline is made of this sketch's curves, and
// a T left here is a T there, where nothing can cut it.

// ================================================================ 7. what is not cut

// Kinds of geometry no tool cuts, and what a contact with them does:
// - a reference curve (a projected edge today; an axis of the origin with 6a2, a curve of another
//   sketch with 6b, an outline with 6f): never cut. A contact with it is a cut of an own curve
//   (held on it by pointOnCurve) when `with` names it or the own curve is a construction curve.
//   One that forms regions (6b with its flag, an outline of 6f with its flag) cannot get a common
//   vertex with an own curve in its interior, and a profile where the two cross stays invalid: the
//   contact is listed with `fix: 'none'`. Its ends join by position with the ends at their place
//   (the stage of `sketchWorld`), so an own outline may end where a flagged projection ends;
// - a derived copy of 6c: never cut and not a cut (a point cannot be held on it in its own
//   sketch); a copy that forms regions and crosses an own curve is listed with `fix: 'none'`;
// - a spline of 6d: never cut and not a cut until a point can be held on a spline (the full
//   variant of 6d); every switch on the kind of a curve in the tools refuses it by name;
// - two circles, or a circle and an arc, on one circle, and two curves lying on each other: no
//   point to cut at; left as they are;
// - a circle with one point only, and a circle a generated profile names: listed in `uncut`;
// - two arcs or circles that only touch each other: no tangency of the solver adapter holds
//   a common end of two arcs (D52), so a cut there would leave the point free; both in `uncut`.
export type KnownUncut = 'reference' | 'derivedCopy' | 'spline' | 'sameCircle' | 'duplicate' | 'touchedOnce' | 'generatorOperand' | 'roundTouch';
