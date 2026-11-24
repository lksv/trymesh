// Contract of package 6c (D68): mirror and pattern in a sketch as derived geometry. A draft for
// review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). Revised 2026-11-24: it imports
// the types of the engine and of the app as 6a implemented them (packages/engine/src/references,
// sketch.ts, packages/app/src/references), not 6a's contract, and states what 6c adds or changes;
// the design is design.md, the calls are calls.ts.
//
// Fixed 2026-11-24 after the second round of reviews, over this revision and 6e's together, and the
// owner's answers 19, 27 and 28 (design.md, "Reviews", round 5). What changed here: the stage after
// the solver is the inside of 6e's `sketchWorld` and reads its base (`SketchBase`), in place of
// `withDerived` and `SolvedOwn`; every curve that is not own and forms regions joins by position,
// the copies and the flagged reference curves alike, so the predicate of the stage and 6a's slot
// `EntryGeometry.keys` go; the rule of what joins an entry is the open-end rule of answer 28, read
// from 6e's plan of a batch (`CurveChanges`, whose `RemovedStretch` is 6e's now); what 6c adds at
// each of 6e's plug-in points is declared (section 5); a row of `get_sketch` groups only regions of
// copies that are equal.
//
// What changes:
// 1. A kind of entry of `external`, the first derived one: `pattern`, with three kinds of transform
//    (`mirror`, `linear` with an optional second direction, `circular`), the shapes of D53 in the
//    plane of a sketch. Its numeric fields live at `external/<id>/transform/...` and take
//    expressions. `ExternalRef` becomes a union; the commands take its input form.
// 2. The registry of kinds is typed in two halves (a reference kind has a stored value, a derived
//    kind has none), and the copies travel in a record of their own, which the solver's input, the
//    stamp and the stored values never see.
// 3. The copies are computed after the solver from the solved own geometry, under the IDs
//    `<entry>/<copy>/<source>`, form regions as their source does, their ends join the curve ends
//    at their place (without welding two own vertices, and with nothing of the source's
//    coincidences carried), and are never operands of a constraint of their own sketch. The ends
//    that stay open are named in the result. The stage is the inside of `sketchWorld` (6e), which
//    the sketch step and every sketch tool call.
// 4. A broad phase in the profile: curves are tested against each other only when their boxes meet.
// 5. The slots of 6a that 6c is the first user of: the fields of an entry and their expressions,
//    the check of a change of source, the stage of the sketch step after the solver, the mark of
//    a derived entity, the face key of a text field with a slash, the row of a derived kind in the
//    app.
// 6. A warning `brokenCopies`. No command, no query, no feature type, no face role, no schema step.

import type { SketchToolName } from '../../../packages/app/src/sketch-tools';
import type { ReferenceUi } from '../../../packages/app/src/references/spec';
import type { SketchPlaceTool } from '../../../packages/app/src/sketch-tools/spec';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { CurveShape, EdgeName, Expr, ExternalRef, FaceName, Id, Input, IssueCode, LinearSpan, Point2, ProjectionKind, RegionRef, SketchFeature, SketchResult, Vec2 } from '../../../packages/engine/src/index';
import { edge } from '../../../packages/engine/src/references/edge';
import type { EntryGeometry, ReferenceKindSpec, ReferenceValues, ResolvedReference } from '../../../packages/engine/src/references/spec';
import { type SketchCurve, type SketchGeometry, solverSetup } from '../../../packages/engine/src/sketch';
import type { Entity } from '../../../packages/engine/src/sketch-content';
import type { IssueCodes } from '../00-prep/contract';
import { CUT_IDS, type ContactFix, type ContactKind, type CurveChanges, type CurvePredicates, type SketchBase, type SketchWorld, contactFix, curvePredicates, piecesOf, reshapedProbes, sketchWorld } from '../6e-trim-extend-split/contract';

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
//   of other copies, of this entry or another, and the end of an own curve that forms regions,
//   unless two such ends there are not one point already (then none). So a half drawn up to the axis
//   of a mirror closes with its image into one region, a chain whose end the pattern carries onto
//   its own start closes into a ring, and two mirrors about one axis close with each other. Put the
//   ends of a mirrored half on the axis by a constraint; an end that stays open is named in the
//   result of the sketch (`openEnds`).
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
//   of the sketch, own, projected, or an axis of the origin (`origin/x`, `origin/y`). (A pattern of
//   features has `plane` here; a sketch names a line.)
// - `linear`: `count − 1` copies shifted along the line `direction` (from its `a` to its `b`;
//   a line of the sketch as for a mirror) by `spacing` between neighbours or over `length` between
//   the source and the last copy; a negative span runs the other way. `second` makes a grid (at most
//   200 places, the source included, no two in one place).
// - `circular`: `count − 1` copies turned about the point `center` (own, `origin` or projected),
//   counter-clockwise in the sketch: over the full circle, or within `angle` between the source and
//   the last copy (a negative angle turns clockwise). (A pattern of features has `axis` here; a
//   sketch names a point.)
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

// `ExternalRef` becomes a union; the edge's interface gets a name. In types.ts the comment of the
// union says that an entry is reference geometry (computed before the solver, fixed for it,
// constrainable) or derived geometry (computed after it, not constrainable).
export interface EdgeProjection {
  type: 'edge';
  body: Id;
  edge: EdgeName;
  kind: ProjectionKind;
}
// today's `ExternalRef` is the edge
export const edgeIsTodaysEntry: EdgeProjection = {} as ExternalRef;
export type ExternalRefAfter = EdgeProjection | SketchPattern;
// The commands take the input form, so a numeric field of an entry may be an expression
// (`Input` leaves the edge as it is: it has a `kind`).
export type ExternalInput = Input<ExternalRefAfter>;
export const ventsInput: ExternalInput = { type: 'pattern', sources: ['g1', 'e1'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } };
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
// The registry of 6a's contract gets the kind too, for the contracts that read that file.
declare module '../6a-sketch-prep/contract' {
  interface DerivedKinds {
    pattern: { ref: SketchPattern };
  }
}

// ================================================================ 2. the registry, in two halves

// The code of 6a has one shape of kind, `ReferenceKindSpec<R, V>` with `source: 'reference'`, and
// types the registry `{ [T in ExternalRef['type']]: ReferenceKindSpec<…, ReferenceValues[T]> }`.
// A member of the union without a value in `ReferenceValues` does not fit it. After 6c
// (packages/engine/src/references/spec.ts):
// - `KindBase<R>`: what every kind says on the side of the document (the members of today), and
//   what the description for the AI reads: `summary` and `example`, an `addExternal` over the
//   fixture of the MCP tests (a box, a sketch on its top with a rectangle and a centre line).
// - a reference kind is the base with `compute`, `value`, `geometry`; a derived kind the base with
//   `entity`, `commandProblem`, `derive`.
// - a kind is a reference kind exactly when `ReferenceValues` has a value for its name.
export type KindBase<R> = Pick<ReferenceKindSpec<R, never>, 'title' | 'validate' | 'refs' | 'faces' | 'entities'> & KindInfo<R>;
export interface KindInfo<R> {
  summary: string;
  example: Input<R>;
}
export type ReferenceKindSpecAfter<R, V> = ReferenceKindSpec<R, V> & KindInfo<R>;

// What a derived kind reads is the base of 6e's `sketchWorld` (`SketchBase`, references/world.ts):
// the sketch, its curves that are not derived (own and reference, the axes of the origin of 6a2
// among them), every used position after the solver, and the pairs that join before the stage (the
// `coincident` constraints; for a tool also what its batch joins). 6a's contract and this one's
// revision called a record of that content `SolvedOwn`; there is one type now, 6e's, and the step
// and a tool build it by `stepBase` and `toolBase`.
export type DerivedInput = SketchBase;
// The failure of a derive: a warning of the sketch, which may come with the geometry that could be
// made (a source gone, the rest copied). Its code is one of the codes after the packages.
export type IssueCodeAfter = IssueCode | keyof IssueCodes;
export interface DerivedFailure {
  code: IssueCodeAfter;
  refs: unknown[];
  detail?: string;
  geometry?: EntryGeometry;
}
// A kind of derived geometry: computed after the solver from the solved own geometry. Nothing of
// it is stored, stamped or handed to the solver.
// - `entity`: what one ID under the entry is, from the document alone: `<entry>/<n>/<s>` with `n`
//   a number the transform may have (a mirror 1; a row and a circle 1 to 199; a grid i + 1000 · j,
//   i and j from 0 to 199, not both 0), written in decimal without leading zeros, and `s` a listed
//   own curve (its kind), a listed own point or `origin`, or a point of a listed own curve (a point).
//   As D53 accepts every copy number of a pattern of a body, because the count may be an expression,
//   so a batch that raises the parameter and names copy 6 is valid; the copy is a broken reference
//   until the count reaches it. `entities` (the base) lists the copies the count of the document
//   makes, which is what the app's list of entries and its index of entities read.
// - `commandProblem`: what `addExternal` and `updateExternal` refuse beyond the form, read from the
//   sketch as it is: a source that is not an own curve or point (or `origin`); an axis or a direction
//   that is not a line of the sketch, own, reference or an axis of the origin; a centre that is not
//   a point of the sketch, own, `origin` or reference; a copy in any of these roles. It is asked only
//   of what an update brings in (`before` the entry as it was): an ID the entry had already, gone
//   since, is kept with its warning, as `updateFeature` verifies only references the feature did
//   not have. The validator (also on `load`, `addFeature` and `setField`) checks the form only, so
//   a document whose source curve was removed loads, and the step reports it (`brokenCopies`).
// - `derive`: the copies of one entry, or the failure.
export interface DerivedKindSpec<R> extends KindBase<R> {
  source: 'derived';
  entity(id: Id, ref: R, sketch: SketchFeature, derived: Id): EntityKind | undefined;
  commandProblem(sketch: SketchFeature, ref: R, before?: R): string | undefined;
  derive(id: Id, ref: R, base: SketchBase): EntryGeometry | DerivedFailure;
}

export type EntryKindName = ExternalRefAfter['type'];
export type ReferenceKindName = keyof ReferenceValues & EntryKindName;
export type DerivedKindName = Exclude<EntryKindName, ReferenceKindName>;
export type EntryOf<T extends EntryKindName> = Extract<ExternalRefAfter, { type: T }>;
export type KindOf<T extends EntryKindName> = T extends ReferenceKindName ? ReferenceKindSpecAfter<EntryOf<T>, ReferenceValues[T]> : DerivedKindSpec<EntryOf<T>>;
export const derivedNames: DerivedKindName[] = ['pattern'];
// @ts-expect-error the edge has a value, so it is no derived kind
export const notDerived: DerivedKindName = 'edge';

// The kind, in packages/engine/src/references/pattern.ts:
// - `validate`: the form; the numeric fields through `context.fields` at `external/<id>/transform/…`
//   with the specs of D53, which move from features/pattern.ts to a leaf both modules import; a
//   field of another kind of transform is refused, `plane` of a mirror and `axis` of a circular
//   pattern (the names of D53) with the name the sketch has for it.
// - `refs`: none (only entities of its own sketch); `faces`: none.
export declare const PATTERN_KIND: DerivedKindSpec<SketchPattern>;

// The registry after 6c. The edge of today fits the reference half as it is (here with the two
// members of the description added); a member of the union without an entry of its half does not
// compile.
export const KINDS_AFTER: { readonly [T in EntryKindName]: KindOf<T> } = {
  edge: { ...edge, summary: 'The projection of a straight or a circular edge of a body.', example: { type: 'edge', body: 'box', edge: { a: { feature: 'box', role: 'endCap' }, b: { feature: 'box', role: 'side', curve: 'r1' } }, kind: 'line' } },
  pattern: PATTERN_KIND,
};
// `kindOf` answers the union of the two shapes, so a caller that wants `compute` or `value` asks
// `source` first: the compiler then stops at `resolveReferences` and at the reader of
// `solved.external` (design.md, "Measured").
export type AnyKind = ReferenceKindSpecAfter<ExternalRefAfter, ReferenceValues[ReferenceKindName]> | DerivedKindSpec<ExternalRefAfter>;
export declare function kindOf(ref: ExternalRefAfter): AnyKind;
export const computedOnlyForAReference = (ref: ExternalRefAfter): boolean => {
  const kind = kindOf(ref);
  // @ts-expect-error a kind may be derived: it has no `compute`
  void kind.compute;
  return kind.source === 'reference' ? typeof kind.compute === 'function' : typeof kind.derive === 'function';
};

// ================================================================ 3. the copies, a record of their own

// An end that stayed open: an end of a curve that is not own and forms regions (a copy that keeps
// its regions; a flagged reference curve of 6b or 6f) which, after every join, is the end of no
// other curve that forms regions.
// - `twoVertices`: the own ends at its place are two vertices, so it joined none of them (`near`
//   names them, `distance` is to the nearest); a `coincident` between them cures it.
// - `apart`: nothing is at its place; `near` is the nearest end of another curve that forms regions
//   and `distance` how far it is, in mm.
export interface OpenEnd {
  end: Id;
  reason: 'twoVertices' | 'apart';
  near: Id[];
  distance: number;
}
// `count`: how many ends are open; `ends`: at most 20 of them, those of `twoVertices` first, then
// by `distance`, the nearest first.
export interface OpenEnds {
  count: number;
  ends: OpenEnd[];
}
// What the stage after the solver gives: the copies of each derived entry (`regions` as the
// occupation pass left them), the pairs of the position stage, the warnings, the open ends.
export interface DerivedGeometry {
  entries: Record<Id, EntryGeometry>;
  joins: [Id, Id][];
  warnings: DerivedFailure[];
  openEnds?: OpenEnds;
}
// It is not the record of the resolved references and no part of it is one: a resolved reference
// without a value is the slot that enters the input of the solver (the axes of 6a2), and the copies
// must never be there. Against the real `solverSetup`:
export function copiesNeverReachTheSolver(sketch: SketchFeature, copies: DerivedGeometry, references: Record<Id, ResolvedReference>): void {
  solverSetup(sketch, references);
  // @ts-expect-error the copies are not resolved references
  solverSetup(sketch, copies);
  // @ts-expect-error nor are the copies of the entries
  solverSetup(sketch, copies.entries);
}

// The result of a sketch (`SketchResult` of types.ts) after 6c: `curves` has the copies
// (`source: 'derived'`), `points` and `radii` their positions, and `openEnds` is there when ends of
// copies stayed open (why an outline of copies did not close).
export interface SketchResultAfter extends SketchResult {
  openEnds?: OpenEnds;
}

// A transform of the plane of a sketch: a map of points and whether it reflects (a mirror turns the
// sense of an arc: its image runs from the image of `end` to the image of `start`).
export interface PlaneMap {
  at(p: Point2): Point2;
  reflects: boolean;
}
// The copies of an entry in the order of their numbers, or why there are none.
export declare function copiesOf(id: Id, transform: SketchTransform, base: SketchBase): { copy: number; map: PlaneMap }[] | DerivedFailure;

// The derive of one entry over the solved own geometry:
// - points: every copy of every point of the listed curves and every listed point;
// - curves: every copy of every listed curve that is there, over the copies of its points; a circle
//   gets the radius of its source; a reflected arc swaps its ends;
// - regions: a copy of a curve that is not a construction curve; the occupation pass of `deriveAll`
//   may take them away (`occupies`).
// A source that is not an own curve or point is skipped and named in the warning, with the copies
// of the rest made. Nothing of the source's coincidences is carried (the owner's answer 14).
export declare function derivePattern(id: Id, ref: SketchPattern, base: SketchBase): EntryGeometry | DerivedFailure;
export const patternDerives: Pick<DerivedKindSpec<SketchPattern>, 'derive'> = { derive: derivePattern };

// The order of the entries: the keys of `external` as the document holds them (the order they were
// added in, except that a key that is a whole number comes before every other, in numeric order).
// The stage after the solver, the occupation pass, the result's curves, the sketch tools,
// `get_sketch` and the app's list read this one function.
export declare function entryOrder(sketch: SketchFeature): Id[];

// What a curve occupies, compared within the length tolerance: a line its segment (either way),
// a circle its centre and radius, an arc its centre and its two ends in order (both run
// counter-clockwise).
export declare function occupies(a: CurveShape, b: CurveShape, at: (point: Id) => Point2, radius: (curve: Id) => number, idA: Id, idB: Id): boolean;
// The occupation pass, inside `deriveAll` after every entry, in the order of the entries and within
// an entry by copy number; it returns the copies it takes the regions from. A copy that kept
// `regions` loses them when it occupies a curve that forms regions and comes before it (an own
// curve that is not construction, a reference curve with `regions`, a copy that kept them).
// Construction curves, projected edges and the axes do not count: they bound nothing. A curve is
// filed under one place (a line's middle, an arc's start, a circle's centre) in a grid of cells of
// the tolerance, and compared with those of its cell and the eight around it.
export declare function occupation(copies: Record<Id, EntryGeometry>, base: SketchBase): Set<Id>;

// The position stage, after the occupation pass (owner, answers 12 and 19): the ends of the curves
// that are not own and form regions join by position: the copies that kept `regions`, and the
// reference curves whose entry gives them the region flag (6b, 6f), which need no code of their
// own: they are curves of the base. Own curves join only by shared points and `coincident`s.
// 1. only ends of curves take part (a line's `a`, `b`, an arc's `start`, `end`): a copied point alone
//    and a centre join nothing by position, since they are no vertex of a profile;
// 2. the ends of the curves that are not own and form regions, of every entry, are paired with
//    each other when within the length tolerance (each pair as found), through a grid of cells;
// 3. a group (those pairs, transitively) is paired with the ends of the own curves that form
//    regions within the tolerance of one of its members, each pair from the member it is near, when
//    those ends are one vertex already by the joins before the stage (`joinsOf` of the pairs of the
//    base), and with none of them otherwise. Ends of curves that form no regions neither join nor
//    prevent a join.
// So two own points that are two vertices today stay two, and a profile can change only where the
// ends of curves that are not own are. It also answers the open ends. (The revision wrote the
// stage over a predicate, the copies alone or every curve that is not own, while the owner's
// answer was pending; there is one rule now.)
export declare function positionJoins(curves: ReadonlyMap<Id, SketchCurve>, geometry: SketchGeometry, before: (id: Id) => Id): { joins: [Id, Id][]; openEnds?: OpenEnds };

// The stage after the solver: every derived entry in the order of the entries, the occupation
// pass, the position stage. In packages/engine/src/references/derive.ts.
export declare function deriveAll(base: SketchBase): DerivedGeometry;

// `sketchWorld` of 6e (packages/engine/src/references/world.ts) after 6c: the core that the sketch
// step (`sketchWorld(stepBase(feature, references, geometry))`) and every profile a tool builds in
// memory (`sketchWorld(toolBase(sketch, result, more))`) call. In 6e it adds nothing to its base;
// 6c makes it call `deriveAll` and answer the curves with the copies (`source: 'derived'`, the
// regions the occupation pass left them), the positions with theirs, the joins of the pairs of the
// base and of the position stage, and what the step puts into the result. A tool's base holds no
// copy (`toolBase` drops the curves of `result.curves` with `source: 'derived'`): the copies are
// made again from the entries of the sketch it gives, so a profile in memory has the copies of the
// entries as that sketch lists them.
export interface SketchWorldAfter extends SketchWorld {
  derived: DerivedGeometry;
}
export const worldAfter: (base: SketchBase) => SketchWorldAfter = sketchWorld as (base: SketchBase) => SketchWorldAfter;

// The broad phase of the profile (packages/engine/src/sketch.ts): the pairs of shapes whose
// bounding boxes, each widened by the tolerance, overlap, in the order (i, j) of the double loop
// they replace; `profileOf` and `touchingCurves` test `compatible` on these alone. The box of an
// arc holds its two ends as given, the point where it ends on the circle of its first end, and the
// ends of that circle's diameters along the axes that it passes (in a sketch that is not solved the
// second end lies off the circle). `Shape` is the profile's own union.
export type Box = [minX: number, minY: number, maxX: number, maxY: number];
export declare function nearPairs<Shape>(shapes: readonly Shape[], box: (shape: Shape) => Box): [number, number][];

// ================================================================ 4. the slots of 6a that 6c writes

// Two slots of `EntryGeometry` (references/spec.ts) go, with the comment that names them: `joins`
// (no kind declares pairs: the ends join in one stage over all entries) and `keys` (6b's join keys,
// dropped by the owner's answer 19: flagged projections join by position in the same stage). 6c
// removes both, in the commit that writes the stage: it is implemented before 6b, and a slot nobody
// fills would otherwise wait for a package that no longer wants it. `hidden` stays (6a2).
export type EntryGeometryAfter = Omit<EntryGeometry, 'joins' | 'keys'>;

// An entity is derived. `own` stays false for it. `entityOf` asks the kind's `entity` for one ID.
// The validator of a constraint refuses an operand that is derived, with the text below; the check
// of a reference with `notProjected` (a hole's point, a wall's curve) names a copy as a copy.
export interface EntityAfter extends Entity {
  derived?: true;
}
export const COPY_IN_CONSTRAINT = (operand: Id, entry: Id, source: Id): string =>
  `"${operand}" is a copy of the mirror or pattern "${entry}": a copy cannot be constrained in its own sketch, it is computed after the sketch is solved; constrain its source "${source}", or project the copy in a later sketch`;

// The numeric fields of an entry: `validate` reads them through the reader of fields at
// `external/<id>/...`; `addExternal` validates with a fresh reader over no expressions
// (`entryContext`) and hands the expressions it read on; `updateExternal` first sets every address
// under `external/<id>/` to null; `withConstraints` keeps an expression under `external/<id>/`
// while the entry is there and reads the address (learnt by validating the entry once);
// `removeExternal` drops them. So `fieldsOf(sketch)` lists them,
// `setField { feature: <sketch>, path: 'external/v/transform/count' }` changes one,
// `renameParameter` renames in them, and the recompute substitutes their values.
export type EntryFieldPath = `external/${string}/transform/${'count' | 'span/spacing' | 'span/length' | 'span/angle' | `second/${'count' | 'span/spacing' | 'span/length'}`}`;
export const countOfVents: EntryFieldPath = 'external/v/transform/count';
export const exprOfVents: Record<EntryFieldPath, Expr> = { 'external/v/transform/count': 'vents' };

// The check of an update (`updateProblem`, the part 6c writes): an update may not turn an entry
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
// Two entries have the same transform when the `transform` of their input forms is equal field by
// field, an expression compared as its text (`count: 'vents'` and `count: 5` are not the same).
export declare function sameTransform(sketch: SketchFeature, a: Id, b: Id): boolean;

// The face key (`faceKey` of face-roles.ts): a text field of a role that holds a slash or starts
// with a quotation mark is written as a JSON string. No face a feature makes today has a slash in
// such a field; a face whose curve or point ID starts with a quotation mark gets another key (keys
// are never stored). With the second condition no two names share a key.
export const quotedInKey = (part: string): boolean => part.includes('/') || part.startsWith('"');
export const SIDE_OF_A_COPY: Extract<FaceName, { role: 'side' }> = { feature: 'lid', role: 'side', curve: 'm/1/c2' };
export const KEY_OF_SIDE_OF_A_COPY = 'lid/side/"m/1/c2"'; // faceKey(SIDE_OF_A_COPY) after 6c
export const KEYS_THAT_CHANGE = { 'H/holeBore/rim/center': 'H/holeBore/"rim/center"', 'H/holeFlat/2/rim/center': 'H/holeFlat/2/"rim/center"', 'ring/side/outer/@p:1': 'ring/side/"outer/@p:1"' } as const; // the hypothetical names of face-roles.test.ts and of the two insert tests

// ================================================================ 5. the sketch tools and copies

// The sketch tools of D52 and 6e (packages/engine/src/sketch-tools.ts, sketch-cut.ts,
// references/world.ts) and copies. 6e is implemented first and fixes the places a later package
// plugs into (its contract, section 6; its design, "Plug-in points"); what 6c adds at each is here,
// under 6e's names.

// A copy is no curve, corner or point to cut, extend or fillet, no `with` curve, and no snap of an
// anchor: every kind of input refuses it, through one check. A place given to `trim` without
// a curve that lies on a copy is refused by 6e, with this reason for the copy.
export const COPY_IN_TOOL = (id: Id, entry: Id, source: Id): string => `"${id}" is a copy of the mirror or pattern "${entry}"; change its source "${source}", and the copies follow`;
export const COPY_AS_SNAP = (id: Id, entry: Id, source: Id): string => `"${id}" is a copy of the mirror or pattern "${entry}": a new point cannot be tied to a copy; snap to its source "${source}", or place the point by its coordinates`;
export declare function copyProblem(sketch: SketchFeature, id: Id, as: 'curve' | 'point' | 'snap'): string | undefined;

// (a) `curvePredicates`: a copy may not be cut, holds no point, and forms regions as the list of
// curves says (its source's flag, less what the occupation pass took).
export const predicatesOfACopy = (predicates: CurvePredicates, copy: SketchCurve): boolean => !predicates.mayCut(copy) && !predicates.holdsPoint(copy) && predicates.formsRegions(copy) === copy.regions;
export const predicatesAfter: typeof curvePredicates = curvePredicates;

// (b) `sketchWorld`: section 3. For the faces of 6e's region rule the tool gives `toolBase` the
// sketch with the removed pieces put back as curves and into the entries that listed them, so the
// copies of that sketch are the copies as they were, cut where the source is cut.

// (c) The entries a batch patches, from 6e's plan of the batch (`CurveChanges`; the fillet of D52
// gives the same record). For every derived entry, by `updateExternal` of `entryInput` (its
// expressions kept), after the new pieces and the removals and before the `updateFeature` patches:
// - a listed curve the batch cut or trimmed is replaced, in its place in `sources`, by its pieces
//   that stay (`changes.pieces`); a curve removed whole leaves the list (an entry left with no
//   source keeps its last one, and warns);
// - a curve joins the entry (appended to `sources`) when, in the sketch after the batch, its two
//   ends are two different open ends of the curves the entry lists that have its construction flag
//   (an open end is the end of exactly one of them, by the joins of the own points), and the batch
//   is why:
//   (i)  the batch made the curve (`changes.added`), re-pointed it (`changes.changed`) or turned it
//        from a circle into an arc (`changes.rekinded`): the owner's answer 28; or
//   (ii) the curve was there, and one of its ends is the same vertex (by the joins of the own
//        points) as a bound of a stretch the batch took out of a curve the entry lists that has the
//        curve's construction flag (`changes.stretches`; of a stretch over two curves, the curve
//        that bound lies on): the batch opened the end it stands at.
//   A span line of the batch (`changes.span`) never joins, nor a circle (it has no ends), nor
//   a curve of a batch of `split`, which adds only pieces;
// - when no entry takes the curve that way, and one of its ends is an open end of one entry's list
//   and the other of another's (the corner between the sources of two entries), it joins the first
//   of the two in the order of the entries when they have the same transform, and neither
//   otherwise. The curves asked are the same: of (i), or of (ii) with the stretch taken out of
//   a curve either entry lists, with the flag of the listed curves at both its ends, and under the
//   same exclusions.
// `after` is the base of the sketch after the batch (`toolBase` of that sketch with the new points
// and the pairs the batch joins): the rule reads its own curves, its positions and the joins of
// its pairs. It needs no world: the open ends are counted by the joins before the stage after the
// solver, which do not depend on what the entries list.
// `joined` names, for each curve that joined, the entry and the two listed curves it stands
// between, which the rewrite of stored regions by names reads.
export interface EntryPatch {
  entry: Id;
  sources: Id[]; // the list after the batch
}
export interface JoinedCurve {
  curve: Id;
  entry: Id;
  between: [{ entry: Id; curve: Id }, { entry: Id; curve: Id }];
}
export declare function entryPatches(before: SketchFeature, after: SketchBase, changes: CurveChanges, tool: 'fillet' | 'trim' | 'extend' | 'split'): { patches: EntryPatch[]; joined: JoinedCurve[] };
// What the rule reads of 6e's plan: the curves a batch makes, changes and turns into arcs, the
// pieces of each cut curve, the stretches taken out, and the span lines to leave out.
export type PlanReadBy6c = Pick<CurveChanges, 'added' | 'changed' | 'rekinded' | 'pieces' | 'removed' | 'stretches' | 'span'>;

// (d) `piecesOf`: what a curve that a feature names became. 6c makes it answer for a copy:
// `<entry>/<n>/<X>`, for any copy number `n` whatever the count, becomes `<entry>/<n>/<piece>` for
// the pieces of X the patched entry lists. Through it 6e's own code rewrites the edges of chamfers
// and fillets on the sides of copies, and a stored region of a copy the count does not make. The
// curve that joined an entry is added to such a region by 6c: a stored region that holds
// `<e1>/<n>/<c1>` and `<e2>/<n>/<c2>` of `between` with one number `n` gets `<entry>/<n>/<curve>`.
export const piecesOfACopy: typeof piecesOf = piecesOf;
export declare function copiesInStoredRegions(regions: readonly RegionRef[], joined: readonly JoinedCurve[]): RegionRef[];

// (e) `reshapedProbes`: 6c adds the image of each place under every copy of every entry that lists
// the curve it belongs to (a hole of a copy opened by a trim of its source lies in another region).
export const probesWithCopies: typeof reshapedProbes = reshapedProbes;

// (f) `contactFix`: an own curve with a copy that forms regions is `none`, with the copy and its
// entry named; two copies of one entry with one copy number are the image of a contact of their
// sources, which is listed and whose cut cures both, so the image is not listed (undefined); any
// other two copies are `none`.
export const OWN_CROSSES_COPY = (copy: Id, entry: Id): string => `it is a copy of the mirror or pattern "${entry}" ("${copy}"), which is never cut: move the curve or change the source of the copy`;
export const COPIES_CROSS = (a: Id, b: Id): string => `"${a}" and "${b}" are copies, which are never cut: change their sources, the count or the spacing`;
export const fixAtACopy: (a: SketchCurve, b: SketchCurve, kind: ContactKind | 'ends', predicates: CurvePredicates, sketch: SketchFeature) => ContactFix = contactFix;

// (g) The rule of old ends: an end a trim cuts off stays when an entry names it (a listed point,
// the centre of a circular pattern), as when a constraint names it, so no batch removes a centre.

// (h) The lists. `entries` is appended to 6e's fifteen after `broken`, the sixteenth, so no place
// of the fifteen changes; the fillet of D52 gets the same list. `uncut` names the copy at a contact
// of an own curve with a copy (6e: the curve no tool can cut is the one listed). `moved` and
// `shortened` name a feature on a side face of a copy of a changed line as they name one on a side
// face of the line (a copy of a line starts at the copy of its `a`); `broken` names the features
// that name copies of what the batch removes (`readersOf`).
export const ENTRIES_LIST = 'entries of mirrors and patterns the batch changed (updateExternal: the pieces of a cut source in its place, a removed source left out, a curve that closes the gap a trim or a fillet opened in the listed curves added), and those left without their axis or direction line; in the order of the entries';
export const CUT_IDS_AFTER = { ...CUT_IDS, entries: ENTRIES_LIST } as const;
export type CutIdsAfter = { [K in keyof typeof CUT_IDS_AFTER]: Id[] };
export const sixteenth: keyof typeof CUT_IDS_AFTER = 'entries';
export interface CopyPatchIds {
  entries: Id[];
}

// ================================================================ 6. MCP

// `get_sketch` of a derived entry (packages/mcp/src/tools.ts): its input form, then where its
// copies are, in place of 6a's listing of every entity.
// - `copies`: the copy numbers made, as ranges `[from, to]`; those of the last recompute.
// - `step`: where copy k stands: a row the shift of one step (and of one step of `second`), a circle
//   its centre and the angle of one step in radians, a mirror the two points of its axis.
// - `first`: the entities of the first copy made: a curve with its kind, a point with its position.
export type PatternDetail = Input<SketchPattern> & {
  id: Id;
  source: 'derived';
  copies: [number, number][];
  step: { shift: Vec2; second?: Vec2 } | { center: Vec2; angle: number } | { axis: [Vec2, Vec2] } | null;
  first: Record<Id, CurveShape['type'] | Vec2>;
};
// A region of `get_sketch`; with `copies`, one row for the regions of the copy numbers listed: the
// reference is that of the first, and the others have their number in its place. Only regions
// that are equal are one row: the same outer loop up to the copy number, the same `area` as the
// answer writes it (rounded), and the same number of holes. A copy that differs (an own hole drawn
// inside one copy of a square) has a row of its own, and so `numbers` of a row may have gaps.
export interface RegionDetail {
  ref: RegionRef;
  area: number;
  holes: number;
  copies?: { entry: Id; numbers: [number, number][] };
}

// ================================================================ 7. the app

// The row of the kind in the list of entries of the sketch panel (`REFERENCE_UI`), with what 6c
// adds to `ReferenceUi`, all of it data (a function over the sketch mode would make the rows import
// the mode, which imports the rows):
// - `form`: the controls of the entry's form, each with the path of its field in the input form of
//   the entry; the panel draws them and sends `updateExternal` with `entryInput` and the change.
// - `repair` may depend on the entry (a mirror is picked again with the tool Mirror, a row with
//   Linear pattern), so it may be a function of the entry that returns the data.
// - `title`: "Mirror", "Linear pattern" (with `second`: "Grid"), "Circular pattern"; `detail`: the
//   number of sources and the axis, direction or centre with the count ("5 curves about origin/y",
//   "4 curves, 5 along origin/x"); `tag`: "copy".
export type EntryControl =
  | { kind: 'sources'; path: string; title: string }
  | { kind: 'choice'; path: string; title: string; options: readonly string[] }
  | { kind: 'entity'; path: string; title: string; accepts: 'line' | 'point' } // a select of the entities that may serve, not copies
  | { kind: 'number'; path: string; title: string; unit: 'mm' | 'angle' | 'count' } // text that may be an expression
  | { kind: 'switch'; path: string; title: string };
type Repair = NonNullable<ReferenceUi<unknown>['repair']>;
export interface ReferenceUiAfter<R> extends Omit<ReferenceUi<R>, 'repair'> {
  repair?: Repair | ((ref: R) => Repair | undefined);
  form?(ref: Input<R>): EntryControl[];
}
export declare const PATTERN_UI: ReferenceUiAfter<SketchPattern>;
// The names of the three tools join `SketchToolName` of the app.
export type SketchToolNameAfter = SketchToolName | 'mirror' | 'linearPattern' | 'circularPattern';

// The entities of a sketch that are not own, built once per sketch object (the document is
// immutable): those of every entry, each with its entry, and `origin` with the axes of the origin
// (6a2), which belong to no entry and have none. The pickers, the tags, the hover and the row of
// the panel read it, where they ask the engine for the entities of an entry once per ID today; it
// is filled from the engine's own answers (`referenceEntities`, `entityOf`), so the tools and the
// form find an axis of the origin whether or not the result of the sketch lists it.
export declare function entityIndex(sketch: SketchFeature): ReadonlyMap<Id, { kind: EntityKind; entry?: Id; derived: boolean }>;

// Three tools of the sketch bar (`SKETCH_TOOL_UI`, after `fillet` and 6e's three): `mirror`,
// `linearPattern`, `circularPattern`. Each takes the own curves and points (and `origin`) selected
// before it as the sources (none selected: the tool says so and does nothing). `mirror` and
// `linearPattern` pick a line (`picks: 'curve'`, `eligible`: a line that is not a copy; an axis of
// the origin is one); `circularPattern` picks a point (a snap to a point that is not a copy). One
// click adds the entry with `addExternal`, or with an entry to repair replaces its axis, direction
// or centre with `updateExternal`; the options of the pattern tools (the count, and the spacing or
// the angle, as text that may be an expression) are their panel while they are active.
export interface PatternToolOptions {
  count: string;
  span: string;
}
export declare const MIRROR_TOOL: SketchPlaceTool<undefined>;
export declare const LINEAR_PATTERN_TOOL: SketchPlaceTool<PatternToolOptions>;
export declare const CIRCULAR_PATTERN_TOOL: SketchPlaceTool<PatternToolOptions>;
// - The copies are drawn from `SketchResult.curves` in the style of derived geometry (dashed, the
//   colour of projections), their points without handles, marked as derived in the view; the hover
//   of the row marks them.
// - No place snaps to a copy while drawing (a curve may only run over own points; a coincident with
//   a copy would be refused), and the constraint offers skip a selection with a copy.
// - The regions of copies are picked for an extrusion as any region (they are in `regions` of the
//   result).
