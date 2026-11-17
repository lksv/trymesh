// Contract of package 6a (D64): the preparatory part of step 6 of D36 and the vocabulary that 6b
// to 6f share. A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It
// imports the real types of the engine and states what the package adds or changes; the design is
// design.md, the calls are calls.ts.
//
// Five parts. Parts 1 to 4 change no public type and no answer; part 5 adds one field to
// `SketchResult` and two exported functions, and changes no answer either.
// 1. The kinds of the entries of `external` as a registry (`REFERENCE_KINDS`); the projection of
//    an edge is its one entry.
// 2. The profile, the sides of a profile and the wall read a list of curves (`SketchCurve`), each
//    with a flag whether it forms regions, and one rule of joins.
// 3. Every switch on the kind of a sketch curve is exhaustive (`unreachable`). design.md lists the
//    places one by one.
// 4. The sketch tools of the app as a table (`SKETCH_TOOL_UI`), one file and one line per tool.
// 5. The result of a sketch carries its curves that are not own; the app and `get_sketch` read
//    them and the entities of the registry instead of spelling out the projection of an edge.
//
// The vocabulary (IDs, shapes, regions, joins, one family of entries, what consumers accept, face
// names) is written with the types it concerns, and in design.md, "The vocabulary of step 6".

import type { CurvePointName, CurveShape, ExternalRef, Frame, Id, IssueCode, Point2, Projected, SketchFeature, SketchResult, Vec2 } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { Entity } from '../../../packages/engine/src/sketch-content';
import type { Profile, SketchGeometry } from '../../../packages/engine/src/sketch';
import type { SketchState, State } from '../../../packages/engine/src/recompute/state';
import type { Dict, FeatureRef, RefContext } from '../../../packages/engine/src/validation';

// ================================================================ 1. the registry of kinds

// ---------------------------------------------------------------- the vocabulary of IDs
//
// An ID a caller gives has no slash and is not `origin` (as today). An ID with a slash is derived:
// `<owner>/<local>`, where the owner is the part before the first slash and is either an entry of
// `external` of the same sketch or `origin`. `local` is not empty and may hold slashes.
// - A single curve of a reference (the projection of an edge today; a projection of one entity of
//   another sketch, 6b) is the entry itself, `<owner>`, and its points are `<owner>/<name>` with
//   the names `CURVE_POINTS` gives the kind of the curve: `a`, `b` of a line; `center` of a circle;
//   `center`, `start`, `end` of an arc. A projected point (6b) is `<owner>` itself.
// - An entry of several entities (an imported outline, 6f) names them `<owner>/<local>` with the
//   local IDs it stores, curves and points alike; its curves name its points, so two curves of an
//   outline share a vertex as two own curves share a point.
// - A copy (6c) is `<owner>/<copy>/<source>`: `copy` the number of the copy from 1 written in
//   decimal (a mirror has only copy 1), `source` the ID of the own entity it copies, a curve or
//   a point. The copy of a curve runs over the copies of the source's points. Raising the count of
//   a pattern adds IDs and lowering it removes the highest; the others stay.
// - The axes of the origin (6b) are `origin/x` and `origin/y`, lines through `origin`. They are the
//   only entities under `origin/`; a point a line of an axis needs in the input of the solver is
//   `origin/x/b` or `origin/y/b`, which is no entity (`EntryGeometry.hidden`). An axis enters the
//   input of the solver only when something of the sketch names it, so the stamp of a sketch that
//   does not use the axes does not change and no stored sketch is solved again on load.
// So no document can hold a derived ID already, and no two entries share one.

// ---------------------------------------------------------------- what an entry puts into a sketch

// Where a curve or a point of a sketch comes from:
// - `own`: drawn in the sketch; the solver moves it.
// - `reference`: an entry computed before the solver from the state before the sketch (the
//   projection of an edge today; a projection from another sketch, an imported outline and the axes
//   of the origin later). Fixed for the solver; constraints of the sketch may name it.
// - `derived`: an entry computed after the solver from the solved own geometry (the copies of
//   a mirror or a pattern, 6c). It does not exist when the sketch is solved, so no constraint of
//   its own sketch names it; a later sketch projects it.
export type GeometrySource = 'own' | 'reference' | 'derived';

// The geometry of one entry in the coordinates of its sketch, under the IDs of its entities.
// - `curves` run over IDs of `points` (or `origin`); the radius of a circle is in `radii`.
// - `regions`: the curves of the entry that form regions (D64, the owner's answer to question 4 of
//   the plan): never for the projection of an edge and the axes; for a projection from another
//   sketch when its reference says so (6b); always for an imported outline (6f); for a copy as for
//   its source (6c: a copy of a construction curve forms none).
// - `joins`: pairs of points that are one point of the profile when they are within the length
//   tolerance in the used positions, as the two operands of a satisfied `coincident` are (6c: a copy
//   and its source, so that a point on the axis of a mirror joins its image).
// - `hidden`: points the curves need that are no entities: no constraint names them, the app does
//   not draw them, `get_sketch` does not list them (the far point of an axis, 6b).
export interface EntryGeometry {
  points: Record<Id, Point2>;
  curves: Record<Id, CurveShape>;
  radii: Record<Id, number>;
  regions: Id[];
  joins?: [Id, Id][];
  hidden?: Id[];
}

// What computing a reference may read: the state before the sketch and the frame of the sketch.
export interface ReferenceContext {
  state: State;
  frame: Frame;
}

// What every kind says, whatever its source. `validate` reads one entry of `external` (the fields
// other than `type` are its own) and fails as validators do; it gets the sketch as validated so far
// (the points, and the curves when the kind is derived: the validator of the sketch reads the
// entries of a derived kind after the curves). `refs` are the references of the entry to other
// features, at the path `external/<id>`. `entities` is every entity of the entry, by its derived
// ID, with its kind, computed from the sketch alone (no recompute), so that a command and `load`
// are validated from the document: a kind whose entities come from elsewhere (a stored outline,
// 6f) copies into its entry what this needs.
interface KindBase<R> {
  title: string;
  validate(context: RefContext, sketch: SketchFeature, entry: Dict, what: string): R;
  refs(ref: R, path: string): FeatureRef[];
  entities(id: Id, ref: R, sketch: SketchFeature): Record<Id, EntityKind>;
}

// A kind of reference geometry: fixed before the solver.
// - `compute` gives its value from the state before the sketch, or the code of the warning when it
//   cannot (`brokenProjection`, `unsupportedProjection`, `degenerateProjection` for an edge).
// - `value` reads the last valid value stored in `solved.external` (on load, and when the step
//   falls back to it); it fails for a value that is malformed and answers undefined for one that
//   does not fit the reference (another kind of curve), which the caller reports as today.
// - `geometry` turns a value into the entities the solver gets as fixed. The value, not the
//   geometry, goes into the stamp of the sketch, as the values of projections do today, so that
//   the stamps of stored sketches stay what they are.
export interface ReferenceKindSpec<R, V> extends KindBase<R> {
  source: 'reference';
  compute(ref: R, context: ReferenceContext): V | IssueCode;
  value(stored: unknown, ref: R, what: string): V | undefined;
  geometry(id: Id, ref: R, value: V): EntryGeometry;
}

// A kind of derived geometry (6c): computed after the solver from the solved own geometry. Nothing
// of it is stored or stamped; the step computes it every time. Its failure is a warning of the
// sketch that names the entry, and the entry has no geometry then. Written here so that 6c plugs
// into the same registry and the same commands; 6a adds no derived kind and no code for one.
export interface DerivedKindSpec<R> extends KindBase<R> {
  source: 'derived';
  derive(id: Id, ref: R, solved: SolvedOwn): EntryGeometry | { code: IssueCode; refs: Id[] };
}
// What a derived kind reads: the own curves of the sketch and every used position after the solver.
export interface SolvedOwn {
  sketch: SketchFeature;
  geometry: SketchGeometry;
}

// The values of each kind of reference, by the `type` of its entry. 6a has the projection of an
// edge; a package adds its kind by declaration merging (in the code: a member of the union
// `ExternalRef` in types.ts, an entry of `REFERENCE_KINDS`, and the value in the union of what
// `solved.external` may hold).
export interface ReferenceKinds {
  edge: { ref: ExternalRef; value: Projected };
}
// A package of derived geometry adds its kind here (6c).
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DerivedKinds {}

export type ExternalRefAfter = ReferenceKinds[keyof ReferenceKinds]['ref'] | DerivedKinds[keyof DerivedKinds];
export type StoredValue = ReferenceKinds[keyof ReferenceKinds]['value'];

// The registry, typed by the union, so a member of `ExternalRef` without an entry does not compile.
// It lives in packages/engine/src/references/index.ts; the entry of the projection of an edge in
// references/edge.ts (the validator `externalRef`, the reader of a stored value `projected`, the
// references and the first stage of the sketch step move there from features/sketch.ts).
export declare const REFERENCE_KINDS: {
  [T in keyof ReferenceKinds]: ReferenceKindSpec<ReferenceKinds[T]['ref'], ReferenceKinds[T]['value']>;
} & {
  [T in keyof DerivedKinds]: DerivedKindSpec<DerivedKinds[T]>;
};

// The kind of an entry (one cast, as `specOf` of the registry of feature types has).
export declare function kindOf(ref: ExternalRefAfter): ReferenceKindSpec<ExternalRefAfter, StoredValue> | DerivedKindSpec<ExternalRefAfter>;

// The validator of an entry of `external`: reads `type` and hands the entry to its kind. An unknown
// type fails with the text of today while the registry has one kind ("promítnout jde jen hranu");
// the package that adds the second kind makes the text list the kinds.
export declare function externalRef(context: RefContext, sketch: SketchFeature, entry: unknown, what: string): ExternalRefAfter;

// What an update of an entry may not change: its entities (the same IDs with the same kinds), since
// constraints and features name them. Today's rule "the kind of a projection cannot change" is this
// rule for the edge, and keeps its text ("druh promítnutí změnit nejde"). A change of `type` that
// keeps the entities is allowed (a projection repaired from an edge to another source, after 6b).
export declare function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRefAfter, after: ExternalRefAfter): string | undefined;

// ---------------------------------------------------------------- entities, by the registry

// As today: what an ID is in a sketch (`origin`, an own point or curve, an entry, an entity of an
// entry by its owner). Moves from sketch-content.ts to references/index.ts; document.ts keeps
// re-exporting it, so the public surface does not change. 6c adds to `Entity` that a derived entity
// is no operand of a constraint of its own sketch.
export declare function entityOf(sketch: SketchFeature, id: Id): Entity | undefined;
// As today, for the kinds whose entities follow from the entry alone (the projection of an edge):
// the derived points of the entry. Kept because the engine exports it; nothing in the engine, the
// app or MCP calls it after part 5. A kind whose entities need the sketch (6c) does not go through
// it: 6c removes it from the exports or makes it take the sketch.
export declare function derivedPoints(id: Id, ref: ExternalRef): Id[];
// Every entity of one entry, in the order of its kind (for the edge: the curve, then `a` and `b`,
// or the curve and `center`): what `get_sketch`, the pickers of the app and the list of entries
// read (part 5).
export declare function referenceEntities(sketch: SketchFeature, id: Id): Record<Id, EntityKind>;

// ---------------------------------------------------------------- the step of the sketch

// One entry of `external` as the sketch step resolved it: its value (fresh, or the last valid one)
// and its geometry. `lost` holds the code when the value is the last valid one or missing.
export interface ResolvedReference {
  value: StoredValue;
  geometry: EntryGeometry;
}
export interface ResolvedReferences {
  resolved: Record<Id, ResolvedReference>;
  lost: [Id, IssueCode][];
}
// The first stage of the step, by the registry: every reference entry in the order of its ID, its
// value from `compute`, else the stored one through `value`, else nothing.
export declare function resolveReferences(feature: SketchFeature, context: ReferenceContext): ResolvedReferences;

// The input of the solver from the own content and the resolved references, with the stamp. The
// stamp is the fingerprint of the curves of the input, the driving constraints and the values of
// the resolved entries by their IDs, which is what it is today, so the stamp of every stored sketch
// stays the same. `fixed` holds every point of the resolved geometry and every circle of it, in the
// order of the entries. The signature takes resolved references in place of `Record<Id, Projected>`;
// the tests that call it with `{}` do not change.
export interface SolverSetupAfter {
  input: import('../../../packages/engine/src/index').SolveInput;
  stamp: string;
  skipped: Id[];
}
export declare function solverSetup(sketch: SketchFeature, references: Record<Id, ResolvedReference>): SolverSetupAfter;

// ================================================================ 2. the profile from a list of curves

// A curve of a sketch as the profile, the sides of a profile and the wall read it: its shape over
// IDs of points (positions in `SketchGeometry.points`, the radius of a circle in `radii`), where it
// comes from, and whether it forms regions. An own curve forms regions when it is not
// a construction curve; an entry's curve when its kind says so (`EntryGeometry.regions`).
export interface SketchCurve {
  id: Id;
  shape: CurveShape;
  source: GeometrySource;
  regions: boolean;
}

// The curves of a sketch: the own ones, then those of the resolved entries (6c adds the derived
// ones after the solver). The order does not matter to a reader: the profile takes the curves that
// form regions sorted by ID, as `detectProfile` takes the own curves today, so its loops and
// polylines stay the same to the bit.
export declare function sketchCurves(feature: SketchFeature, references: Record<Id, ResolvedReference>): SketchCurve[];

// The pairs of points that may join: the operands of every `coincident` of the sketch, then the
// `joins` of the entries. One rule for the profile and the chain of a wall: a pair is joined when
// its two points are within the length tolerance in the used positions, transitively, and a vertex
// is named by the smallest ID it holds (as today). The corner of the fillet keeps `pointJoins`
// (the coincident pairs alone): only own curves count there.
export declare function joinPairs(feature: SketchFeature, references: Record<Id, ResolvedReference>): [Id, Id][];
export declare function joinsOf(pairs: readonly [Id, Id][], geometry: SketchGeometry): (id: Id) => Id;

// The profile of a list of curves. `detectProfile(sketch, geometry, chordTolerance)` stays as it
// is for its callers (the tests): the profile of the own curves with the coincident joins.
export declare function profileOf(curves: readonly SketchCurve[], joins: (id: Id) => Id, geometry: SketchGeometry, chordTolerance: number): Profile;

// The solved sketch the recompute keeps gets the list and the joins. `curveOf` of
// recompute/profile.ts (the shape of a side) and the wall read the curves from `curves` instead of
// `feature.curves`; a wall still takes own curves only (its validator refuses others).
export interface SketchStateAfter extends SketchState {
  curves: ReadonlyMap<Id, SketchCurve>;
  joins: (id: Id) => Id;
}

// ================================================================ 3. exhaustive switches

// A switch on the kind of a curve ends in this, so a kind added to `CurveShape` (the spline of 6d)
// does not compile until the switch has a case for it. At run time it throws: a validated document
// never reaches it. In util.ts of the engine; the solver adapter and the app write the same two
// lines locally (`const kind: never = value`), so nothing is exported for it.
export declare function unreachable(value: never, what: string): never;

// The kinds of a sketch curve the validator of a curve accepts: the keys of `CURVE_POINTS`, not
// a hand-written list, so a kind added to `CurveShape` (and so to the table) is accepted only
// after the validator's switch has its case.
export type CurveKind = CurveShape['type'];
export declare const CURVE_KINDS: readonly CurveKind[];

// ================================================================ 4. the sketch tools of the app

// The app's types cannot be imported into a draft (packages/app imports three.js; see 1b). The
// stand-ins below have the members the table uses; in the code they are `SketchHost`,
// `SketchMode` and `SketchContext` of packages/app/src/sketch-mode.ts, `ViewPick` of host.ts and
// `Anchor` of the engine's sketch-tools.ts.
export interface AnchorStandIn {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}
export interface ViewPickStandIn {
  kind: 'face' | 'edge' | 'plane';
}
export interface SketchHostStandIn {
  say(text: string, error?: boolean): void;
  run(command: unknown, done?: string): boolean;
  renderPanel(): void;
  renderScene(): void;
}
export interface SketchModeStandIn {
  id: Id;
  tool: SketchToolName;
  clicks: AnchorStandIn[];
  selection: Id[];
  construction?: boolean;
}
export interface SketchContextStandIn {
  feature: SketchFeature;
  result: SketchResult;
}
export type HTMLElementStandIn = { readonly tagName: string };

// One tool of the sketch bar. A tool is a file in packages/app/src/sketch-tools/ and one line of
// the table; the bar shows the tools in the order of the table.
// - `label`, `hint`: the button and what the status line says when the tool is chosen.
// - `picks`: what the pointer looks for while the tool is active. `sketch` (the default): a place
//   in the sketch, snapped to a point or a curve (an `Anchor`); `edge`: an edge of the model.
// - `clicks`: how many places a shape takes (a line 2, an arc 3). The places before the last are
//   kept in the mode and drawn; the last one calls `click` with all of them. Without it `click` is
//   called at every click with the places kept so far and this one (a spline of 6d collects its
//   control points so).
// - `click` returns the places to keep for the next click, or nothing: the line keeps its end, so
//   the chain goes on; a tool without `clicks` keeps what it collects.
// - `finish`: what the key Enter does with the places kept (6d: the spline is drawn through them).
//   Escape drops them, for every tool, as today.
// - `infer`: the second place of the tool snaps horizontal or vertical from the first (the line).
// - `hovers`: the point or curve under the pointer is highlighted (the select tool).
// - `drags`: a press on an own point starts its drag (the select tool).
// - A drawing tool sends its batch through `drawn`, which applies the switch of construction
//   curves; a tool whose batch must stay as the engine made it (the fillet; trim, extend and split
//   of 6e) runs it itself with `host.run`.
// - `draw`: what the tool draws while the pointer moves, as polylines in the coordinates of the
//   sketch: the shape in progress (the rubber band), or what a click would change (the piece
//   a trim would remove, 6e). Drawn dashed, as the rubber band is today; the marker of a snap is
//   drawn by the app for every tool that picks places, except the select tool.
// - `options`: what the tool remembers between sketches (the sides of the polygon, the radius of
//   the fillet) with its start value, and its part of the panel while the tool is active. The app
//   keeps it by tool; nothing else reads it.
interface ToolBase<O> {
  label: string;
  hint: string;
  options?: { initial: O; panel(host: SketchHostStandIn, value: O, set: (value: O) => void): HTMLElementStandIn[] };
}
export interface SketchPlaceTool<O> extends ToolBase<O> {
  picks?: 'sketch';
  clicks?: number;
  infer?: boolean;
  hovers?: boolean;
  drags?: boolean;
  // The place of a click is where the last move of the pointer put the cursor (it carries the
  // inferred direction of a line), except for a tool with `atClick`: the place under the click
  // (the select tool and the fillet, as today).
  atClick?: boolean;
  click(host: SketchHostStandIn, m: SketchModeStandIn, places: AnchorStandIn[], context: SketchContextStandIn, options: O, event: { shiftKey: boolean }): AnchorStandIn[] | void;
  finish?(host: SketchHostStandIn, m: SketchModeStandIn, places: AnchorStandIn[], context: SketchContextStandIn, options: O): void;
  draw?(places: Vec2[], cursor: AnchorStandIn, context: SketchContextStandIn, options: O): Vec2[][];
}
export interface SketchEdgeTool<O> extends ToolBase<O> {
  picks: 'edge';
  click(host: SketchHostStandIn, m: SketchModeStandIn, pick: ViewPickStandIn | undefined, context: SketchContextStandIn): void;
}
export type SketchToolUi<O = undefined> = SketchPlaceTool<O> | SketchEdgeTool<O>;

// The names of the tools of today. The table is written with each entry's own type of options and
// forgets it (as `FEATURE_UI` does); `SketchToolName` is its keys, so `SketchMode.tool` follows the
// table and a tool added there is a tool of the mode.
export type SketchToolName = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'fillet' | 'project';
export declare const SKETCH_TOOL_UI: { readonly [T in SketchToolName]: SketchToolUi<any> };

// A batch of a drawing tool: the switch of construction curves applied, then run. True when the
// engine took it. (Today the private `batch` of `sketchClick`.)
export declare function drawn(host: SketchHostStandIn, m: SketchModeStandIn, commands: unknown[] | undefined): boolean;

// ================================================================ 5. the result and its readers

// The result of a sketch gets its curves that are not own, by their IDs: reference geometry with
// values (a projection that never had values has none, as it has no points today) and, after 6c,
// derived geometry. `shape` runs over IDs whose positions are in `points` (a circle's radius in
// `radii`). The entries come in the order of `external` in the document, and the curves of one entry
// in the order of its kind, which is the order the app draws and hit-tests them in today.
export interface ResultCurve {
  shape: CurveShape;
  source: Exclude<GeometrySource, 'own'>;
  regions: boolean;
}
export interface SketchResultAfter extends SketchResult {
  curves: Record<Id, ResultCurve>;
}

// The points of a curve by the names of its kind (moves from sketch-content.ts to the exports of
// the engine, for the app's view of a result curve).
export declare function curvePoints(shape: CurveShape): Id[];

// The app reads the entries of `external` through a table by kind, typed by the union, so a kind
// added to the engine does not compile in the app until it has its row:
// - `title`: the name of a row in the list of entries of the panel ("Úsečka", "Kružnice" for an
//   edge by its `kind`), and `detail` what follows it (the body today).
// - `tag`: the word the pickers of the app add after an entity of the entry ("projected").
// - `repair`: the button that replaces the source of the entry and keeps its ID (the edge: the tool
//   Project with the entry to repair); absent where there is nothing to pick again.
export interface ReferenceUi<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string }): string;
  tag: string;
  repair?: { title: string; start(host: SketchHostStandIn, m: SketchModeStandIn, id: Id): void };
}
export declare const REFERENCE_UI: { readonly [T in keyof ReferenceKinds]: ReferenceUi<ReferenceKinds[T]['ref']> };

// What `get_sketch` lists for an entry does not change: `id`, the fields of the entry, `entities`
// (now from `referenceEntities`: the same IDs in the same order), `at` (the positions of its point
// entities in that order) and `radius` when the entry itself is a circle.
export interface SketchDetailEntry {
  id: Id;
  entities: Id[];
  at: ([number, number] | null)[];
  radius?: number;
}

// The names of a curve's points, as `CURVE_POINTS` gives them (re-exported for the stand-ins).
export type { CurvePointName };
