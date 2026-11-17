// Contract of package 6c (D68): mirror and pattern in a sketch as derived geometry. A draft for
// review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the
// engine and the vocabulary of 6a (docs/d36/6a-sketch-prep/contract.ts), and states what 6c adds
// or changes; the design is design.md, the calls are calls.ts.
//
// What changes:
// 1. A kind of entry of `external`, the first derived one: `pattern`, with three kinds of transform
//    (`mirror`, `linear` with an optional second direction, `circular`), the shapes of D53 in the
//    plane of a sketch. Its numeric fields live at `external/<id>/transform/...` and take
//    expressions. `ExternalRef` becomes a union; the commands take its input form.
// 2. The copies are computed after the solver from the solved own geometry, under the IDs
//    `<entry>/<copy>/<source>`, form regions as their source does, their ends join the curve ends
//    at their place (without welding two own vertices), and are never operands of a constraint of their own sketch.
// 3. The slots of 6a that 6c is the first user of: the fields of an entry and their expressions,
//    the pairs of the joins beyond the coincidents, the check of a change of source, the derived stage of the sketch step,
//    the mark of a derived entity, the face key of a text field with a slash, the row of a derived
//    kind in the app.
// 4. A warning `brokenCopies`. No command, no query, no feature type, no face role, no schema step.

import type { CurveShape, Expr, FaceName, Id, Input, IssueCode, LinearSpan, Point2, SketchFeature } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { Entity } from '../../../packages/engine/src/sketch-content';
import type { IssueCodes } from '../00-prep/contract';
import type { DerivedKindSpec, EntryGeometry, ReferenceUi, SketchHostStandIn, SketchModeStandIn, SketchPlaceTool, SolvedOwn } from '../6a-sketch-prep/contract';

// ================================================================ 1. the entry

// A mirror or a pattern of own geometry of the sketch (D68), an entry of `external` computed after
// the sketch is solved. The copies are derived geometry: drawn, forming regions and naming faces
// as their sources, read by later features and sketches, but no constraint of this sketch can name
// them (they do not exist while it is solved). Constrain the sources; the copies follow.
// - `sources`: what is copied: own curves (a construction curve too: its copies are construction
//   curves and form no regions) and own points of the sketch, or `origin`; at least one, none twice.
//   A curve takes its points along: the copies of two curves that share a point share its copy.
//   A command refuses an ID that is not an own curve or point; a document may name one that was
//   removed since: it is not copied, and the sketch has the warning `brokenCopies`.
// - `transform`: how the copies stand (SketchTransform).
// - The copy number `n` of a source `s` is `<entry>/<n>/<s>` (a point `p` of a copied curve is
//   `<entry>/<n>/<p>`; `origin` is copied as `<entry>/<n>/origin`). A mirror has the copy 1; a row
//   and a circle number from 1; a grid numbers the copy i steps along the first direction and j
//   along the second `i + 1000 · j`, as a pattern of features does (D53). A higher count adds
//   copies and moves none of the others with a `spacing`, so the regions and faces named by a copy
//   stay; a lower count removes the highest, and what names them is a broken reference.
// - A copy that occupies what a curve before it that forms regions occupies (its source, an own
//   curve, a projected curve that forms regions, an earlier copy that kept them; a line on
//   the axis of a mirror, a circle at the centre of a circular pattern) forms no regions; it is still
//   there under its ID. A half circle whose ends lie on the axis is not such a copy: its image is the
//   other half.
// - The ends of the copied curves join the ends of curves at their place (within 1e-6 mm): the ends
//   of other copies, of this entry or another, and the end of an own or projected curve that forms
//   regions, unless two such ends there are not one point already (then none). A copy keeps the
//   joins of its source: a copied end takes along the own points a coincident joins it with. So a half drawn up to the axis of a mirror closes with its
//   image into one region, a chain whose end the pattern carries onto its own start closes into
//   a ring, and two mirrors about one axis close with each other. Put the ends of a mirrored half on
//   the axis by a constraint.
// - A feature that should follow the count names a region the copies lie in: a region is named by
//   its outer loop, so copies inside it are its holes and follow the count. A feature that names
//   the region of a copy names that copy.
export interface SketchPattern {
  type: 'pattern';
  sources: Id[];
  transform: SketchTransform;
}

// How the copies of a sketch pattern stand: the transforms of D53 in the plane of the sketch.
// - `mirror`: one copy, the mirror image about the line `axis` (its whole length, both ways): a line
//   of the sketch, own, projected, or an axis of the origin (`origin/x`, `origin/y`).
// - `linear`: `count − 1` copies shifted along the line `direction` (from its `a` to its `b`;
//   a line of the sketch as for a mirror) by `spacing` between neighbours or over `length` between
//   the source and the last copy; a negative span runs the other way. `second` makes a grid (at most
//   200 places, the source included, no two in one place).
// - `circular`: `count − 1` copies turned about the point `center` (own, `origin` or projected),
//   counter-clockwise in the sketch: over the full circle, or within `angle` between the source and
//   the last copy (a negative angle turns clockwise).
// - The numeric fields, with the ranges of D53: `transform/count` (an integer from 1 to 200, the
//   source included), `transform/span/spacing` and `transform/span/length` (mm, not zero),
//   `transform/span/angle` (radians, −2π to 2π, not zero), and the same under `transform/second/`.
//   Their addresses in the sketch are `external/<entry>/transform/count` and so on: `setField` with
//   the sketch as the feature changes one, and a field takes an expression (`vents`, `deg(30)`).
// - `axis`, `direction` and `center` cannot be a copy. A command refuses one that is not a line
//   (a point) of the sketch; a document may name one that is gone: the entry then has no copies and
//   the sketch has the warning `brokenCopies`.
export type SketchTransform =
  | { type: 'mirror'; axis: Id }
  | { type: 'linear'; direction: Id; count: number; span: LinearSpan; second?: { direction: Id; count: number; span: LinearSpan } }
  | { type: 'circular'; center: Id; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };

// `ExternalRef` becomes a union (6a: "a member of the union", the edge's interface given a name).
// In types.ts the comment of the union says that an entry is reference geometry (computed before
// the solver, fixed for it, constrainable) or derived geometry (computed after it, not
// constrainable).
export interface EdgeProjection {
  type: 'edge';
  body: Id;
  edge: import('../../../packages/engine/src/index').EdgeName;
  kind: import('../../../packages/engine/src/index').ProjectionKind;
}
export type ExternalRefAfter = EdgeProjection | SketchPattern;
// The commands take the input form, so a numeric field of an entry may be an expression
// (`Input` leaves the edge as it is: it has a `kind`).
export type ExternalInput = Input<ExternalRefAfter>;
export const ventsInput: ExternalInput = { type: 'pattern', sources: ['g1', 'e1'], transform: { type: 'linear', direction: 'c1', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } };
declare module '../00-prep/contract' {
  interface Commands {
    // `addExternal` and `updateExternal` of today with the input form of a sketch pattern
    sketchPattern: { type: 'addExternal' | 'updateExternal'; sketch: Id; id: Id; ref: Input<SketchPattern> };
  }
  // A warning of the sketch: an entry of a mirror or pattern cannot make all its copies. `refs`:
  // the entry, then what is wrong: the axis, direction or centre that is not a line (a point) of the
  // sketch with a position, or has no length (no copies at all); the sources that are not own
  // curves or points (the others are copied); the addresses of the fields in the sketch
  // (`external/<entry>/transform/count`, `…/second/count`, `…/direction`, `…/second/direction`) of
  // a grid of more than 200 places or whose copies would stand in one place (no copies at all, the
  // message names the two). The rest of the sketch is solved and its profile found as without the
  // copies that are missing.
  interface IssueCodes {
    brokenCopies: true;
  }
}

// The registry of 6a gets the kind: `pattern`, the first derived kind.
declare module '../6a-sketch-prep/contract' {
  interface DerivedKinds {
    pattern: { ref: SketchPattern };
  }
}

// ================================================================ 2. the kind

// What 6c adds to 6a's `DerivedKindSpec` (in the code: members of that interface, optional for
// a later derived kind):
// - `commandProblem`: what `addExternal` and `updateExternal` refuse beyond the form, read from the
//   sketch as it is: a source that is not an own curve or point (or `origin`); an axis or a direction
//   that is not a line of the sketch, own, reference or an axis of the origin; a centre that is not
//   a point of the sketch, own, `origin` or reference; a copy in any of these roles. The validator
//   (also on `load`, `addFeature` and `setField`) checks the form only, so a document whose source
//   curve was removed loads, and the step reports it (`brokenCopies`).
// - `entity`: what one ID under the entry is, from the document alone: `<entry>/<n>/<s>` with `n`
//   a number the transform may have (a mirror 1; a row and a circle 1 to 199; a grid i + 1000 · j,
//   i and j from 0 to 199, not both 0), written in decimal without leading zeros, and `s` a listed
//   own curve (its kind), a listed own point or `origin`, or a point of a listed own curve (a point).
//   As D53 accepts every copy number of a pattern of a body, because the count may be an expression,
//   so a batch that raises the parameter and names copy 6 is valid; the copy is a broken reference
//   until the count reaches it. `entities` (6a) lists the copies the count of the document makes,
//   which is what `get_sketch`, the pickers of the app and the list of entries show.
// - `derive` changes its failure (6a: `{ code; refs: Id[] }`, no geometry): a warning may come with
//   the geometry that could be made (a source gone, the rest copied), and its code is one of the
//   codes after the packages (`brokenCopies`).
// - `commandProblem` is asked only of what an update brings in (`before` the entry as it was): an ID
//   the entry had already, gone since, is kept with its warning, as `updateFeature` verifies only
//   references the feature did not have.
export type DerivedFailure = { code: IssueCodeAfter; refs: unknown[]; detail?: string; geometry?: EntryGeometry };
export type IssueCodeAfter = IssueCode | keyof IssueCodes;
export interface DerivedKindSpecAfter<R> extends Omit<DerivedKindSpec<R>, 'derive'> {
  derive(id: Id, ref: R, solved: SolvedOwn): EntryGeometry | DerivedFailure;
  commandProblem?(sketch: SketchFeature, ref: R, before?: R): string | undefined;
  entity?(id: Id, ref: R, sketch: SketchFeature, derived: Id): EntityKind | undefined;
}

// The kind, in packages/engine/src/references/pattern.ts:
// - `validate`: the form; the numeric fields through `context.fields` at `external/<id>/transform/…`
//   with the specs of D53, which move from features/pattern.ts to a leaf both modules import.
// - `refs`: none (only entities of its own sketch); `faces`: none.
// - `derive`: below.
export declare const PATTERN_KIND: DerivedKindSpecAfter<SketchPattern>;

// A transform of the plane of a sketch: a map of points and whether it reflects (a mirror turns the
// sense of an arc: its image runs from the image of `end` to the image of `start`).
export interface PlaneMap {
  at(p: Point2): Point2;
  reflects: boolean;
}
// The copies of an entry in the order of their numbers, or why there are none.
export declare function copiesOf(id: Id, transform: SketchTransform, solved: SolvedOwn): { copy: number; map: PlaneMap }[] | DerivedFailure;

// The derive of one entry over the solved own geometry (6a's `SolvedOwn`: the sketch, its curves
// own and reference with the axes of the origin, every used position, the vertices by the joins
// before the derived entries):
// - points: every copy of every point of the listed curves and every listed point;
// - curves: every copy of every listed curve that is there, over the copies of its points; a circle
//   gets the radius of its source; a reflected arc swaps its ends;
// - points also: the own points that the coincidents of the sketch join with a copied end (its
//   vertex class), so that a corner joined through a point between two ends stays one;
// - regions: a copy of a curve that is not a construction curve; the occupation pass of `deriveAll`
//   may take them away (`occupies`);
// - joins (6a's `EntryGeometry.joins`): the coincidents of the sketch between two points it copies,
//   copy by copy (the source's joins carried); no keys. The joins by position are one stage after
//   every entry (`imageJoins`), which an entry cannot do alone (two entries about one axis).
// A source that is not an own curve or point is skipped and named in the warning, with the copies
// of the rest made. Nothing is stored or stamped.
export declare function derivePattern(id: Id, ref: SketchPattern, solved: SolvedOwn): EntryGeometry | DerivedFailure;
export const patternKind: Pick<DerivedKindSpecAfter<SketchPattern>, 'derive'> = { derive: derivePattern };

// The occupation pass, in `deriveAll` after every entry, in the order of `external` and within an
// entry by copy number: a copy that kept `regions` loses them when it occupies a curve that forms
// regions and comes before it (an own curve that is not construction, a reference curve with
// `regions`, a copy that kept them). Construction curves, projected edges and the axes do not
// count: they bound nothing. Found through a grid of cells by the midpoint, not all against all.
//
// The join stage after the occupation pass (in the step, before the joins of the whole sketch):
// - only ends of curves take part (a line's `a`, `b`, an arc's `start`, `end`): a copied point alone
//   and a centre join nothing by position, since they are no vertex of a profile;
// - the ends of copies, of every entry, are paired with each other when within the length
//   tolerance (each pair as found, so every pair is within it), through a grid of cells;
// - a group of copy ends (those pairs, transitively) is paired with the ends of the curves that are
//   not copies and form regions (own not construction, reference with `regions`) within the
//   tolerance of one of its members, each pair from the member it is near, when those ends are one
//   vertex already by the joins before the derived stage (`SolvedOwn.joins`), and with none of them
//   otherwise. Ends of curves that form no regions (a construction axis, a projected edge, the axes
//   of the origin) neither join nor prevent a join.
// So two own points that are two vertices today stay two (a copy never welds them), and a profile
// can change only where the ends of copies are. The pairs go to 6a's `joinPairs` with the others.
export declare function imageJoins(copies: ReadonlyMap<Id, EntryGeometry>, solved: SolvedOwn): [Id, Id][];
export declare function occupation(copies: ReadonlyMap<Id, EntryGeometry>, solved: SolvedOwn): void;

// What a curve occupies, compared within the length tolerance: a line its segment (either way),
// a circle its centre and radius, an arc its centre and its two ends in order (both run
// counter-clockwise). A copy that occupies what a curve before it occupies forms no regions.
export declare function occupies(a: CurveShape, b: CurveShape, at: (point: Id) => Point2, radius: (curve: Id) => number, idA: Id, idB: Id): boolean;

// The sketch step after 6c (6a's slot "the derived source in the code of the step"):
// 1. the references resolved, the solver set up and run, as 6a;
// 2. `SolvedOwn` from the curves of 6a's list, the solved geometry and `joinsOf(joinPairs(...))`
//    over the coincidents and the references;
// 3. every derived entry in the order of `external`: its geometry added to the geometry, its curves
//    to the list (`source: 'derived'`, `regions` from the entry); a failure a warning `brokenCopies`
//    with the entry first in `refs` (and the geometry it could make);
// 4. `occupation`, `imageJoins`, then the joins of the whole sketch, the profile, the result
//    (`SketchResult.curves` with the copies, `points` and `radii` with their positions).
// The solver runs at every recompute, as today; the copies are not in its input, so the stamp does
// not change with the count, the stored positions stay, and only the number of the count is written
// back. The analysis of freedom does not see the copies.
// A sketch tool (the fillet, 6e) that follows regions in memory builds `SolvedOwn` without the
// solver: the positions of `context.result` with the tool's new points, the reference curves from
// `result.curves`, the counts as the document holds them, each raised to the highest copy number
// a stored region of a feature over the sketch names (so the face rule sees the copies those
// regions name, made or not).
export declare function deriveAll(feature: SketchFeature, solved: SolvedOwn): { geometry: Map<Id, EntryGeometry>; joins: [Id, Id][]; warnings: DerivedFailure[] };

// ================================================================ 3. the slots of 6a that 6c writes

// An entity is derived (6a: "6c adds to `Entity` that an entity is derived"). `own` stays false for
// it. The validator of a constraint refuses an operand that is derived, with the text below; the
// check of a reference with `notProjected` (a hole's point, a wall's curve) names a copy as a copy.
export interface EntityAfter extends Entity {
  derived?: true;
}
export const COPY_IN_CONSTRAINT = (operand: Id, entry: Id, source: Id): string =>
  `"${operand}" is a copy of the mirror or pattern "${entry}": a copy cannot be constrained in its own sketch, it is computed after the sketch is solved; constrain its source "${source}", or project the copy in a later sketch`;

// The numeric fields of an entry (6a, part 1): `validate` reads them through the reader of fields
// at `external/<id>/...`; `addExternal` validates with a fresh reader over no expressions and hands
// the expressions it read on; `updateExternal` first sets every address under `external/<id>/` to
// null; `withConstraints` keeps an expression under `external/<id>/` while the entry is there and
// reads the address (learnt by validating the entry once); `removeExternal` drops them. So
// `fieldsOf(sketch)` lists them, `setField { feature: <sketch>, path: 'external/v/transform/count' }`
// changes one, `renameParameter` renames in them, and the recompute substitutes their values.
export type EntryFieldPath = `external/${string}/transform/${'count' | 'span/spacing' | 'span/length' | 'span/angle' | `second/${'count' | 'span/spacing' | 'span/length'}`}`;
export const countOfVents: EntryFieldPath = 'external/v/transform/count';
export const exprOfVents: Record<EntryFieldPath, Expr> = { 'external/v/transform/count': 'vents' };

// The check of an update (6a's `updateProblem`, the part 6c writes): an update may not turn an entry
// from reference to derived geometry or back ("updateExternal: an entry of reference geometry
// cannot become derived geometry, or the other way; remove it and add the other"). Within the
// derived kind everything may change: the sources, the kind of transform, the count. No constraint
// names a copy, so no entity that goes is constrained.
export declare function sourceChangeProblem(before: ExternalRefAfter, after: ExternalRefAfter): string | undefined;

// The input form of one entry (as `featureInput` of a feature): its fields with the expressions of
// the sketch under `external/<id>/` put back into them. A tool that patches an entry (the fillet,
// 6e) and the app's form send `updateExternal` with it, so `count: 'vents'` stays an expression.
// `updateExternal` treats a string equal to the expression the field has as no change (it is not
// evaluated again), as `updateFeature` does, so an entry whose expression no longer evaluates can
// still be patched.
export declare function entryInput(sketch: SketchFeature, id: Id): Input<ExternalRefAfter>;

// The face key (6a, "Face names"; `faceKey` of face-roles.ts): a text field of a role that holds
// a slash is written as a JSON string. No face of today has one, so no key of today changes; the
// two expectations of face-roles.test.ts with `rim/center` change (`H/holeBore/"rim/center"`).
export const SIDE_OF_A_COPY: Extract<FaceName, { role: 'side' }> = { feature: 'lid', role: 'side', curve: 'm/1/c2' };
export const KEY_OF_SIDE_OF_A_COPY = 'lid/side/"m/1/c2"'; // faceKey(SIDE_OF_A_COPY) after 6c

// ================================================================ 4. what reads the copies

// `derivedPoints(id, ref)` of the engine reads `ref.kind` of an edge; with the union it narrows to
// the edge (`EdgeProjection`), and leaves the exports of the engine (nothing outside the engine calls
// it after 6a's part 5).
export declare function derivedPoints(id: Id, ref: EdgeProjection): Id[];

// The sketch tools of D52 and 6e (packages/engine/src/sketch-tools.ts, sketch-cut.ts) and copies:
// - A copy is no curve, corner or point to cut, extend or fillet: refused with
//   `COPY_IN_TOOL` (the tools ask for own curves and points already; the text says why).
// - A source changed by a tool: the batch also patches every derived entry that lists a curve the
//   tool changes, with `updateExternal` of `entryInput` (its expressions kept): the pieces a split
//   or a trim leaves are listed in the place of the cut curve; a curve the batch makes (a new curve,
//   or a piece of a curve it cuts: the arc of a fillet, the arc a notch circle becomes) whose two
//   ends are, after the patch, ends of curves listed by any entry is added to each entry that lists
//   a curve at one of its ends (an own curve the batch only re-points or extends is never added);
//   a curve removed whole leaves the list (an entry left with no source keeps its last one). So the
//   copies keep the shape of their source.
// - An end a trim cuts off stays when an entry names it (a listed point, the centre of a circular
//   pattern), as when a constraint names it (6e's rule of old ends); an entry whose axis, direction
//   or centre the batch removes is in `entries`, and the features that name copies of what the batch
//   removes are in `broken`.
// - The regions of features over copies follow: the fillet adds `<entry>/<n>/<arc>` to every
//   stored region that holds `<entry>/<n>/<line1>` and `<entry>/<n>/<line2>` for the same `n`,
//   whatever the count (the numbers are read from the region, so a region of a copy above the count
//   is patched too and is right when the count comes back); 6e's rule of the faces runs over the
//   profile with the derived entries (`deriveAll` over the sketch as the batch leaves it, and as it
//   was), with the counts raised to the copies the stored regions name, so a region of copies is
//   followed as a region of own curves is, also one of a copy above the count.
// - `moved` and `shortened` name a feature on a side face of a copy of a changed line as they name
//   one on a side face of the line (a copy of a line starts at the copy of its `a`).
// - `ids.entries` lists the entries patched, and those left without their axis, direction or
//   centre.
export const COPY_IN_TOOL = (curve: Id, entry: Id, source: Id): string => `"${curve}" is a copy of the mirror or pattern "${entry}"; change its source "${source}", and the copies follow`;
export interface CopyPatchIds {
  entries: Id[];
}

// ================================================================ 5. the app

// The row of the kind in the list of entries of the sketch panel (6a's `REFERENCE_UI`), with one
// member 6c adds to `ReferenceUi`: `edit`, the form of the entry opened from its row.
// - `title`: "Mirror", "Linear pattern" (with `second`: "Grid"), "Circular pattern"; `detail`: the
//   number of sources and the axis, direction or centre with the count ("3 curves about origin/y",
//   "4 curves, 5 along c1"); `tag`: "copy"; no `repair`.
// - The form: the sources (the list, and a button that takes the current selection of own curves
//   and points and `origin`), the kind of the transform, its line or point (picked in the view from the lines or
//   points that may serve, not copies), and its numeric fields as text inputs that take expressions;
//   it sends `updateExternal` with the input form.
export interface ReferenceUiAfter<R> extends ReferenceUi<R> {
  edit?: { title: string; start(host: SketchHostStandIn, m: SketchModeStandIn, id: Id): void };
}
export declare const PATTERN_UI: ReferenceUiAfter<SketchPattern>;

// Three tools of the sketch bar (6a's `SKETCH_TOOL_UI`, after `fillet`): `mirror`, `linearPattern`,
// `circularPattern`. Each takes the own curves and points (and `origin`) selected before it as the sources (none
// selected: the tool says so and does nothing). `mirror` and `linearPattern` pick a line
// (`picks: 'curve'`, `eligible`: a line that is not a copy); `circularPattern` picks a point (a snap
// to a point that is not a copy). One click adds the entry with `addExternal`; the options of the
// pattern tools (the count, and the spacing or the angle, as text that may be an expression) are
// their panel while they are active. The new entry's form opens, which is where a grid is made.
export interface PatternToolOptions {
  count: string;
  span: string;
}
export declare const MIRROR_TOOL: SketchPlaceTool<undefined>;
export declare const LINEAR_PATTERN_TOOL: SketchPlaceTool<PatternToolOptions>;
export declare const CIRCULAR_PATTERN_TOOL: SketchPlaceTool<PatternToolOptions>;
// - The copies are drawn from `SketchResult.curves` in the style of derived geometry (dashed, the
//   colour of projections), their points without handles; the hover of the row marks them.
// - No place snaps to a copy while drawing (a curve may only run over own points; a coincident with
//   a copy would be refused), and the constraint buttons stay off for a selection with a copy.
// - The regions of copies are picked for an extrusion as any region (they are in `regions` of the
//   result).
