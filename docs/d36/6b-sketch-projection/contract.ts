// Contract of package 6b (D69): the projection of a point, line, circle or arc of another sketch.
// A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). Revised 2026-11-24
// after the review of the design and the owner's answers, and fixed the same day after the second
// round of reviews (design.md, "Reviews"): the axes of the origin left for the point 6a2 (D71,
// ../6a2-origin-axes), the join keys are gone (projections that form regions join by position, in
// the stage 6c writes inside 6e's `sketchWorld`: no code of 6b's), and the sketch tool reads the
// planes. It imports the real types of the engine (6a, D64, is implemented) and the contracts of
// 6a2, 6e (D65) and 6c (D68), both as merged, which are implemented before 6b, and states what 6b
// adds or changes. The design is design.md, the calls are calls.ts.
//
// What changes:
// 1. A reference kind of entry of `external`, `sketch`: one entity of an earlier sketch on a
//    parallel plane, its `kind` stored, a flag `regions`. `ExternalRef` gets the member.
// 2. `Projected`, the stored value of reference geometry, gets two more forms (a point, an arc).
//    A projected arc is made exact.
// 3. What the registry's spec gains: a detail of a failure, `keepsValue`.
// 4. Nothing in the joins: the position stage of `sketchWorld` takes every curve that is not own
//    and forms regions, a flagged projection among them.
// 5. What 6b adds at the plug-in points of 6e: a reader of an entity of another sketch in
//    `readersOf`, a name for an old end, a reader of regions for `repairsByDefault`, the reason of
//    `contactFix`.
// 6. A sketch tool `projectSketch` with two input kinds, `sketch` and `entities`; the tools get the
//    results of the features.
// 7. A query `sketchSources`: what a sketch can project.
// 8. The app's tool *From sketch*, the row of the kind, the curves of such a sketch in the model.
// No command, no feature type, no face role, no issue code, no schema step.

import type { FeatureResult, Frame, Id, IssueCode, SketchFeature, Vec2 } from '../../../packages/engine/src/index';
import type { NewId, SketchToolContext } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { SketchState, State } from '../../../packages/engine/src/recompute/state';
import type { ReferenceContext, ReferenceKindSpec } from '../../../packages/engine/src/references/spec';
import type { SketchCurve } from '../../../packages/engine/src/sketch';
import type { Dict, FeatureRef, ValidationContext } from '../../../packages/engine/src/validation';
import type { ArgSpecs, CommandAfter, DocumentAfter } from '../00-prep/contract';
import type { PlaceStandIn, SketchContextStandIn, SketchHostStandIn, SketchModeStandIn, SketchPlaceTool } from '../6a-sketch-prep/contract';
import { underOrigin } from '../6a2-origin-axes/contract';
import type { EdgeProjection, OpenEnds, SketchPattern } from '../6c-sketch-mirror-pattern/contract';
import { entryOrder, occupies } from '../6c-sketch-mirror-pattern/contract';
import type { ContactFix, CurveChanges, SketchBase, SketchToolInputAfter, SketchToolInputsAfter, SketchToolResultAfter } from '../6e-trim-extend-split/contract';

// ================================================================ 1. the entry

// The projection of one entity of an earlier sketch (D69): reference geometry, fixed for the solver
// and computed at every recompute from the solved sketch `sketch` before this one. In types.ts this
// comment is read by the AI.
// - `sketch`: a sketch before this one on the timeline, on a plane parallel to this sketch's (either
//   normal, any offset); the projection runs along this sketch's normal. A plane that is not
//   parallel gives the warning `unsupportedProjection`, whose message says the angle.
// - `entity`: a point or a curve of it: an own point or curve (a construction curve too), `origin`,
//   or an entity of one of its entries (`fl1`, `fl1/a`, `h/center`, a copy of a mirror `m/1/c2`).
//   Nothing under `origin/`: this sketch has its own axes `origin/x` and `origin/y` (project the
//   `origin` of the other sketch when its origin lies elsewhere).
// - `kind`: the kind of `entity`, `point`, `line`, `circle` or `arc`; a command checks it against
//   the source (get_sketch of the source lists the kinds; the tool `projectSketch` fills it in).
// - `regions`: whether the projected curve bounds regions of this sketch, as an own curve that is
//   not construction does. A command may leave it out: then it is `false`, and the curve is
//   reference only, as a projected edge. `true` is refused on a point. The document always holds it.
// - The entry is the projected entity: `<id>` (a point, or the curve), and the points of a curve
//   are `<id>/a`, `<id>/b` (a line), `<id>/center` (a circle), `<id>/center`, `<id>/start`,
//   `<id>/end` (an arc, counter-clockwise from `start`; on a sketch whose normal is opposite to the
//   source's the ends swap, so it stays counter-clockwise here). Constrain own geometry to them;
//   a constraint needs one own operand.
// - The ends of projected curves that form regions join the curve ends at their place (within
//   1e-6 mm): those of other such projections, of any source, and the end of an own curve that
//   forms regions, unless two own ends there are not one point already. So eight entries projecting
//   a rounded rectangle close into one loop. Own curves join each other only at a common point or
//   a `coincident`.
// - The values follow the source at every recompute. When the source sketch is not evaluated before
//   this one, its entity is gone or is of another kind now (a circle trimmed into an arc), the
//   projection keeps its last values with the warning `brokenProjection`, and constraints on it
//   keep acting. A source curve with no extent (a line of no length, an arc whose end lies on its
//   centre) is `degenerateProjection`, likewise.
// - A side face of an extrusion of a region bounded by a projected curve is named by the entry's ID
//   (`{ feature, role: 'side', curve: <id> }`).
// - One entry per entity of the source: a second one is refused, naming the first.
// - To draw own curves over projected ones (an outline the sketch tools can cut), use the sketch
//   tool `projectSketch` with `as: 'own'`.
export interface SketchProjection {
  type: 'sketch';
  sketch: Id;
  entity: Id;
  kind: ProjectedKind;
  regions: boolean;
}
export type ProjectedKind = Extract<EntityKind, 'point' | 'line' | 'circle' | 'arc'>;

// `ExternalRef` after 6c and 6b (6c named the edge `EdgeProjection` and made the union).
export type ExternalRef6b = EdgeProjection | SketchPattern | SketchProjection;

// The flag of an entry (the convention 6f's outline follows, whose default is `true`): the
// document always holds the boolean; the input form of a command may leave it out, and the
// validator of the kind writes the kind's default. So one field name has one meaning in
// `describe_api`, whatever the default of the kind, and a document never depends on it.
export type SketchProjectionInput = Omit<SketchProjection, 'regions'> & { regions?: boolean };
export const REGIONS_DEFAULT = { sketch: false } as const; // 6f adds its kind with `true`
declare module '../00-prep/contract' {
  interface Commands {
    // `addExternal` and `updateExternal` of today with a projection from a sketch
    sketchProjection: { type: 'addExternal' | 'updateExternal'; sketch: Id; id: Id; ref: SketchProjectionInput };
  }
}

// ================================================================ 2. the value

// `Projected` of types.ts after 6b: the value of a reference in the coordinates of its sketch,
// stored in `solved.external` as its last valid value and stamped. Two forms are new, a point and
// an arc; an edge still stores a line or a circle. Nothing but positions is in it: the joins of a
// sketch are found from positions after the solver (section 4). An arc's `end` lies on the circle
// of its `start` exactly (made so by `compute`).
export type Projected6b =
  | { kind: 'point'; at: Vec2 }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; start: Vec2; end: Vec2 };
// The registry: `ReferenceValues.edge` narrows to the two forms an edge has, `ReferenceValues.sketch`
// is the whole union (references/spec.ts). `SolveStamp.external` stays `Record<Id, Projected>`.
export interface ReferenceValues6b {
  edge: Extract<Projected6b, { kind: 'line' | 'circle' }>;
  sketch: Projected6b;
}
// The reader of a stored value by its form (`projected` of references/edge.ts moves to the registry
// and reads the four forms); the kind's `value` then checks that it fits its entry: the same `kind`
// as the entry's. An edge's entry is a line or a circle, so a stored point or arc never fits one.
export declare function projected(v: unknown, what: string): Projected6b;

// ================================================================ 3. the kind

// What 6b adds to the spec of a reference kind (references/spec.ts):
// - `compute` may say why it failed: `{ code, detail }` beside a bare code. `resolveReferences`
//   keeps the detail with the entry in `lost`, and the step's warning carries it ("(board has no
//   circle bh3; the constraints on it were left out of the solve)").
// - `keepsValue`: whether `updateExternal` from `before` to `after` keeps the stored value (the same
//   source, another flag). Absent: never (the edge, as today).
// The first design also added `reads` (the entities of other sketches an entry reads); the lists of
// the tools find them in `refs` instead (section 5).
export type Failure = { code: IssueCode; detail: string };
export interface ReferenceKindSpec6b<R, V> extends Omit<ReferenceKindSpec<R, V>, 'compute'> {
  compute(ref: R, context: ReferenceContext): V | IssueCode | Failure;
  keepsValue?(before: R, after: R): boolean;
}
export interface ResolvedReferences6b {
  lost: [Id, IssueCode, string?][];
}

// The kind, in packages/engine/src/references/projection.ts:
// - `validate`: the fields (`type`, `sketch`, `entity`, `kind`, `regions` and no other); `kind` one
//   of the four; `entity` nothing under `origin/` (UNDER_ORIGIN; a rule of the form, so `load`
//   checks it too); `regions` a boolean or absent (then REGIONS_DEFAULT), `true` refused on a point
//   (REGIONS_ON_A_POINT); `context.requireRef` of the sketch and of the entity with
//   `accepts: [kind]` (a command: earlier on the timeline, there, of that kind; `load`: not checked,
//   as every reference); no other entry of this sketch with the same `sketch` and `entity`, the
//   entry `id` itself excepted (DUPLICATE).
//   What the kind of the entity IS in the source is the check of a command alone (`requireRef`):
//   `validate` on `load` reads this sketch only. So an entity that became another kind after the
//   entry was made (6e: a circle trimmed into an arc; 6d: a spline put under the ID of a line)
//   leaves a document that loads, and `compute` answers `brokenProjection` (KIND_CHANGED). 6d's
//   refusal of a spline as the entity is this same check of a command, with its text; the form
//   check of `kind` (one of the four) refuses `kind: 'spline'` on `load` too, which no legal
//   command writes.
// - `refs`: the sketch, and the entity as `{ id: entity, kind: 'entity', sketch, accepts: [kind] }`,
//   both at `external/<id>`.
// - `faces`: none.
// - `entities`: `<id>` of `kind`, then the points `<id>/<name>` of `CURVE_POINTS[kind]`.
// - `compute`: below (`projectFromSketch`).
// - `value`: `projected(stored)` when its `kind` is the entry's, else undefined.
// - `geometry`: the points under the entity IDs, the curve, a circle's radius, and `regions: [id]`
//   when the flag is set on a curve. No `keys`, no `joins`.
// - `keepsValue`: the same `sketch`, `entity` and `kind`.
// - `summary` and `example` of 6c's `KindInfo`, from which the section of `describe_api` on the
//   kinds of entries is generated: PROJECTION_SUMMARY, PROJECTION_EXAMPLE.
export declare const PROJECTION_KIND: ReferenceKindSpec6b<SketchProjection, Projected6b> & { source: 'reference'; summary: string; example: SketchProjectionInput };
export declare function validateProjection(context: ValidationContext, sketch: SketchFeature, id: Id, entry: Dict, what: string): SketchProjection;
export declare function projectionRefs(ref: SketchProjection, path: string): FeatureRef[];
export const PROJECTION_SUMMARY =
  'The projection of a point, a line, a circle or an arc of an earlier sketch on a parallel plane: fixed geometry that follows its source. With `regions: true` the curve bounds regions of this sketch.';
export const PROJECTION_EXAMPLE: SketchProjectionInput = { type: 'sketch', sketch: 'base', entity: 'r1', kind: 'line' };
export const notUnderOrigin = (entity: Id): boolean => !underOrigin(entity);

// The map from the plane of one sketch to the plane of another, as the projection uses it.
// - `parallel`: the normals parallel or opposite within ANGLE_TOLERANCE (1e-4 rad); `flips` when
//   they are opposite; `angle` the angle between the planes (for the message).
// - `at`, for planes that are parallel in that sense, is a RIGID motion of the plane, not the
//   orthogonal projection: `at(p) = o + p.x · u + p.y · v`, where `o` is the orthogonal projection
//   of the source's origin into the target (`toPlane(to, toWorld(from, 0, 0))`), `u` the direction
//   of the source's x axis projected into the target and made a unit vector, and `v` a quarter turn
//   from `u`, to the left, or to the right when the map flips (then it reflects, and an arc swaps
//   its ends). Lengths, radii and the joints of a chain are kept exactly whatever the tilt inside
//   the tolerance. (The first revision projected every point orthogonally and then put the end of
//   an arc on the circle of its start: on planes tilted by 9e-5 rad a quarter disc of radius 300
//   was foreshortened by 1.2e-6 mm along one axis, the line's end stayed there, the arc's end was
//   moved, and the outline opened without a word; the second round, finding 3.) A point lies
//   within `d · angle² / 2` of its orthogonal projection, `d` its distance from the source's
//   origin: 5e-6 mm at 1 m.
// - For planes that are not parallel `at` is the orthogonal projection, for the picture a caller
//   may draw; nothing is projected through it.
// One function for the kind's `compute`, the sketch tool and the query, so what they answer is what
// the projection gives.
export interface SketchMap {
  at(p: Vec2): Vec2;
  parallel: boolean;
  flips: boolean;
  angle: number;
}
export declare function sketchMap(from: Frame, to: Frame): SketchMap;

// `compute` of the kind: the source's `SketchState` from `state.sketches`; the planes; the entity
// (a point from `geometry.points`, a curve from `curves`, a circle's radius from `geometry.radii`);
// the positions mapped; an arc's ends swapped across a flip and its end put on the circle of its
// start: end = center + |start − center| · (end − center) / |end − center| (the map is rigid, so
// this moves the end by what the source's solve left, under 1e-11 mm).
// The failures, each with its detail (the texts below):
// - the sketch not in the state: `brokenProjection`, SOURCE_NOT_EVALUATED;
// - the planes not parallel: `unsupportedProjection`, NOT_PARALLEL;
// - no such point or curve: `brokenProjection`, ENTITY_GONE;
// - a curve of another kind, one this package cannot project among them (a spline, after 6d):
//   `brokenProjection`, KIND_CHANGED. No case of the switch on the source's kind throws;
// - a curve with no extent, checked before the arc is made exact (the division above would give
//   NaN, which would reach the result and the stored value): a position that is not finite, a line
//   shorter than the length tolerance, a circle whose radius is under it, an arc whose start or end
//   is within it of the centre: `degenerateProjection`, NO_EXTENT. A sketch that never solved keeps
//   the positions it was drawn with, and those may be anything (the second round, finding 4).
// After a failure the entry has its stored value, or, when it never had one, no geometry at all and
// the constraints on it are left out of the solve, as for a lost edge.
export declare function projectFromSketch(ref: SketchProjection, source: SketchState | undefined, frame: Frame): Projected6b | Failure;
export const projectionContext = (state: State, frame: Frame): ReferenceContext => ({ state, frame });

// The texts of the kind (English, new).
export const UNDER_ORIGIN = (entity: Id, sketch: Id): string => `${entity} of ${sketch} is not projected: this sketch has its own axes origin/x and origin/y; project the origin of ${sketch} for a point at its origin`;
export const REGIONS_ON_A_POINT = 'a projected point forms no regions; regions is for a line, a circle or an arc';
export const DUPLICATE = (entity: Id, sketch: Id, entry: Id): string => `${entity} of ${sketch} is projected already as ${entry}`;
export const SOURCE_NOT_EVALUATED = (sketch: Id): string => `${sketch} is not evaluated before this sketch: removed, suppressed, in error, or later on the timeline`;
export const NOT_PARALLEL = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degrees.toFixed(1)}° to this sketch; only a parallel plane is projected`;
export const ENTITY_GONE = (sketch: Id, entity: Id, kind: ProjectedKind): string => `${sketch} has no ${kind} ${entity}`;
export const KIND_CHANGED = (sketch: Id, entity: Id, now: string, kind: ProjectedKind): string => `${entity} of ${sketch} is a ${now} now, not a ${kind}`;
export const NO_EXTENT = (sketch: Id, entity: Id, kind: ProjectedKind): string => `the ${kind} ${entity} of ${sketch} has no extent there (no length or no radius)`;
// The general texts of the warnings (recompute/services.ts, `MESSAGE`), English and for every kind;
// the detail of a kind follows in brackets, as `issue(code, refs, detail)` composes it.
export const MESSAGES = {
  brokenProjection: 'The projected geometry is no longer in its source; it keeps its last valid place.',
  unsupportedProjection: 'The geometry cannot be projected into this sketch.',
  degenerateProjection: 'The geometry has no extent in this sketch: it projects to a point.',
} as const satisfies Partial<Record<IssueCode, string>>;

// ================================================================ 4. joins: by position, no code of 6b's

// The owner's answer 19: projections that form regions join by position, in one stage with the
// copies of 6c; 6b's join keys (`vertices` in the stored value, key pairs in `joinPairs`) are
// dropped. Where that leaves 6b:
// - `joinPairs` stays the pairs of the `coincident` constraints;
// - the stage is the inside of 6e's `sketchWorld(base)` (references/world.ts), written by 6c: the
//   ends of the curves that are not own and form regions are paired with each other within the
//   length tolerance, and a group with the own ends at its place when those are one vertex. It has
//   no predicate to widen: a flagged projection is a reference curve of the base with `regions`,
//   and the stage takes it as it finds it. 6b writes no line there (6e, "Plug-in points": "6b, 6f:
//   … no code here");
// - the sketch step builds its base with `stepBase` and a tool with `toolBase`, and both call the
//   core, so a profile in memory closes a projected outline as the recompute does;
// - `EntryGeometry.keys` (6a's slot for the keys) and `EntryGeometry.joins` are removed by 6c;
// - an end of a flagged projection that stays open is in `SketchResult.openEnds` (6c's `OpenEnds`:
//   the end, the reason `twoVertices` or `apart`, the nearest end and its distance).
// What a projection is in a base, as a check of the types: a curve that is not own, with its flag.
export type OpenEndsOfProjections = OpenEnds;
export const inBase = (base: SketchBase, entry: Id): SketchCurve | undefined => base.curves.find((curve) => curve.id === entry && curve.source === 'reference');

// ================================================================ 5. at the plug-in points of 6e

// (a) `readersOf(document, sketch, changes)` of sketch-cut.ts computes the lists `moved`,
// `shortened` and `broken` for the fillet of D52 and the three tools. 6b adds one kind of reader,
// read from the references the registry of feature types already gives (`refs` of a feature:
// `{ kind: 'entity', sketch, id }`), so no member is added to a kind: a sketch with an entry of
// `external` whose references name an entity of the changed sketch is
// - in `shortened` when that entity is a curve that keeps its ID and its kind with another extent
//   (`changes.changed`, `changes.restarted`; a split curve: only the piece that keeps the ID is
//   projected);
// - in `broken` when that entity is removed (`changes.removed`, `changes.removedPoints`) or is of
//   another kind now (`changes.rekinded`: a circle that became an arc; `brokenProjection` at the
//   recompute).
export interface EntityReader {
  feature: Id; // the sketch that holds the entry
  path: string; // `external/<entry>`
  sketch: Id; // the sketch whose entity it reads
  entity: Id;
}
export declare function entityReaders(document: DocumentAfter, sketch: Id): EntityReader[];
export declare function projectionReaders(document: DocumentAfter, sketch: Id, changes: CurveChanges): { shortened: Id[]; broken: Id[] };

// (b) The rule of old ends ("an end stays when anything names it"): a point that an entry of
// a later sketch projects IS named, by the entity reference of that entry, as a feature that names
// the point is. So an end cut off a curve whose point is projected as a point stays, held on the
// curve (6e's virtual end), and its projection follows it there; it is never in `broken` for
// a trim of an end. The ends of a projected CURVE are not named by its entry: the entry names the
// curve, which is in `shortened`.
export declare function namedByProjection(document: DocumentAfter, sketch: Id, point: Id): boolean;

// (c) `repairsByDefault(document, sketch)`: what counts as a feature that reads regions of the
// sketch. 6b adds: a later sketch that projects a curve of this sketch with the region flag. Its
// outline is made of this sketch's curves, and a T left here is a T there, where nothing can cut
// it.
export declare function projectedWithRegions(document: DocumentAfter, sketch: Id): boolean;

// (d) `contactFix`: what `split` without a curve does at a contact, and the field `fix` of the
// query `sketchContacts`. A contact of an own curve with a flagged projection away from its ends,
// and two flagged projections that cross or lie on each other, are `none`, with this reason:
export const FLAGGED_NOT_CUT = (entry: Id): string =>
  `${entry} is a projection that forms regions and is not cut: draw an own outline over it (the sketch tool projectSketch with as: "own") and take the flag off, or remove the curve that meets it`;
export const flaggedFix = (entry: Id): ContactFix => ({ fix: 'none', why: FLAGGED_NOT_CUT(entry) });

// ================================================================ 6. the sketch tool

// `projectSketch`: entities of the sketch `sketch` projected into the sketch of the context, each by
// one `addExternal` with a fresh ID (`x…`) and its `kind` from the source.
// - `entities`: which entities of the source, curves and points, in this order. Absent: the whole
//   sketch, which is its own curves that are not construction curves, then the curves of its
//   entries in 6c's `entryOrder` (of a reference entry every curve: that is what a skeleton is made
//   of; of a mirror or a pattern the copies that form regions), then its lone points (an own point
//   no own curve names, a point entry). Never anything under `origin/`. A lone point may be
//   a leftover: the virtual corner a fillet keeps, the old end of a trimmed line; they are
//   projected as the points they are.
// - `as`: the role of the projected curves here.
//   - `source` (the default): a curve forms regions here exactly when it forms regions in the
//     source (an own curve that is not construction, an entry's curve with its flag, a copy as the
//     source's result has it).
//   - `reference`: none forms regions (a skeleton).
//   - `regions`: every curve forms regions. Refused when two of them occupy one place in the source
//     (6c's `occupies`; an own outline drawn over its projections: both would bound the same
//     regions here), naming the pair (LYING): "every curve" cannot be met, and `source` is the
//     role that takes one of each.
//   - `own`: none forms regions, and an own curve is drawn over a projected curve and held on it:
//     an outline the sketch tools can cut. **One own curve per place**: of the curves that occupy
//     one place in the source (`occupies`: a line its segment either way, a circle its centre and
//     radius, an arc its centre and its two ends in order) the first in the order above is
//     projected and drawn over; the others get no entry and no own curve and are listed in
//     `doubled`. So the whole of a sketch that holds an own outline over its projections (what this
//     tool makes) gives one own outline, not two on each other. One own point per place where ends
//     of the projected curves lie, `coincident` with the first projected end there; an own line
//     between two of them; an own circle with its centre `coincident` with the projected centre
//     and `equalRadius`; an own arc with a centre of its own, started at the projected centre,
//     a construction line from that centre to the arc's start, and the projected centre held on
//     that line (`pointOnCurve`). With the two ends that leaves the centre one place (two lines
//     that cross once), at every sweep. A projected point gets no own point.
// - An entity this sketch projects already is skipped: no entry and no own curve for it.
// - `ids`: PROJECT_SKETCH_IDS. What the tool leaves out is listed, one list per reason, and the
//   description of the list (shown by `describe_api` and by `sketch_tool`) says the reason:
//   `skipped` (projected already), `doubled` (with `own`: another curve at its place). A later
//   package that brings an entity the tool cannot project adds its list the same way: 6d adds
//   `splines`, described by its text (a spline of the source is not projected).
// - Refused: a sketch the document does not have or that is not a sketch, this sketch, a sketch
//   after it on the timeline, a source or a target that is not evaluated, planes that are not
//   parallel (with the angle), an entity the source does not have, anything under `origin/`,
//   nothing to project (or all of it projected already). With 6d: a spline named in `entities`
//   (the caller asked for it by name; a whole sketch leaves its splines out and lists them).
export interface ProjectSketchInput {
  sketch: Id;
  entities?: Id[];
  as?: 'source' | 'reference' | 'regions' | 'own';
}
export interface SketchToolInputs6b extends SketchToolInputsAfter {
  projectSketch: ProjectSketchInput;
}
// Two input kinds:
// - `sketch`: the ID of a sketch of the document (MCP: "the ID of an earlier sketch of the
//   document"; the app: a list of the earlier sketches);
// - `entities`: IDs of entities of the sketch named by the input `of` (MCP: "IDs of points and
//   curves of that sketch, as its get_sketch lists them"; the app: the picker of the tool).
export type SketchToolInput6b = SketchToolInputAfter | { kind: 'sketch' } | { kind: 'entities'; of: string; optional?: boolean };
export const PROJECT_SKETCH_INPUTS = {
  sketch: { kind: 'sketch' },
  entities: { kind: 'entities', of: 'sketch', optional: true },
  as: { kind: 'option', options: ['source', 'reference', 'regions', 'own'], optional: true },
} as const satisfies Record<keyof ProjectSketchInput, SketchToolInput6b>;
export const PROJECT_SKETCH_IDS = {
  entries: 'the new entries of external, one per projected entity, in the order of `sources`',
  sources: 'the entity of the source sketch each entry projects',
  skipped: 'entities of the source this sketch projects already; nothing was made for them',
  doubled: 'with `as: "own"`: curves of the source that lie on a curve projected before them (one own curve is drawn per place); nothing was made for them',
  curves: 'with `as: "own"`: the own curves, one per projected curve, in the order of the entries that are curves',
  points: 'with `as: "own"`: the own points (the ends, then the centres)',
  helpers: 'with `as: "own"`: the construction lines from the centre of each own arc to its start',
  constraints: 'with `as: "own"`: the constraints that hold the own curves on the projected ones',
} as const;
// What `sketchTool` takes after 6b: the context with the document (D52) and the results of the
// features (`evaluation.features`). A tool that reads another sketch reads its solved result and
// its plane there, and the plane of its own sketch: `projectSketch` maps the positions of the
// source, so it refuses a tilted plane with the angle and starts every own point at its place.
// Required, as the document is: MCP's `sketch_tool` and the app have the evaluation at hand. Every
// caller of `sketchTool` and of `sketchContextOf` gets it (design.md, "Where the code lives", names
// the files, the tests among them); the calls.ts of earlier packages are drafts against their own
// contracts and stay.
export interface SketchToolCall6b extends SketchToolContext {
  document: DocumentAfter;
  features: Record<Id, Pick<FeatureResult, 'sketch' | 'plane'>>;
}
export declare function sketchTool<K extends keyof SketchToolInputs6b>(tool: K, context: SketchToolCall6b, input: SketchToolInputs6b[K], newId: NewId): SketchToolResultAfter;
export const TOOL_EXAMPLE: ProjectSketchInput = { sketch: 'frame', entities: ['fa0', 'fl0', 'fa1', 'fl1', 'fa2', 'fl2', 'fa3', 'fl3'], as: 'own' };
export const TILTED = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degrees.toFixed(1)}° to this sketch; only a sketch on a parallel plane is projected`;
export const LYING = (a: Id, b: Id, sketch: Id): string => `${a} and ${b} of ${sketch} lie on each other: projected with regions both would bound the same regions; name the entities, or use as: "source"`;
// What the tool reads of 6c: the order of the entries of the source, and whether two curves of it
// occupy one place (the refusal of `regions`, the one own curve per place of `own`).
export const TOOL_READS_OF_6C = { entryOrder, occupies } as const;
// What 6d hands the tool (its text SPLINES_LEFT_OUT is the description of the list): the hook is
// the name of the list and where it is described.
export const LEFT_OUT_LISTS = ['skipped', 'doubled'] as const; // 6d: 'splines'

// ================================================================ 7. the query

// `sketchSources` (query/sketch.ts, one line of `QUERIES`, its rows in the two typed tables of
// packages/mcp/test/queries.test.ts): what the sketch `sketch` can project. Without `from`: every
// sketch before it on the timeline, with whether its plane is parallel. With `from`: the entities of
// that sketch with their places in the coordinates of `sketch`, as a projection would put them.
// It reads what the recompute kept of both sketches (`context.sketch`: the state, whose curves and
// positions hold the axes and far points of 6a2, which the query leaves out) and no body
// (`geometry: 'none'`), and is kept by the two solved sketches (`context.memo`). The picker of the
// app's tool *From sketch* is its view: it asks once per candidate sketch.
export const SKETCH_SOURCES_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch', summary: 'The sketch that would project.' },
  from: { kind: 'sketch', title: 'From', summary: 'One earlier sketch, to list its entities; without it the earlier sketches are listed.', optional: true },
  max: { kind: 'number', title: 'Most entities', summary: 'The most entities to list; `total` counts them all.', optional: true, spec: { title: 'Most entities to list', unit: 'count', integer: true, min: { value: 1 }, default: 200 } },
} as const satisfies ArgSpecs;
// One earlier sketch as a source.
// - `status`: `parallel` (it can be projected), `tilted` (its plane is at `angle` rad to this
//   sketch's: a projection would be `unsupportedProjection`), `notEvaluated` (suppressed or in
//   error: a projection would be `brokenProjection`).
// - `flips`: the normals are opposite, so the projection reflects (an arc swaps its ends).
// - `curves`, `points`: how many entities it has to project (every curve and every point a
//   projection may name, as `entities` lists them with `from`).
export interface SketchSource {
  sketch: Id;
  name: string;
  status: 'parallel' | 'tilted' | 'notEvaluated';
  angle: number;
  flips: boolean;
  curves: number;
  points: number;
}
// One entity of the sketch `from`, placed in the coordinates of `sketch`. EVERY entity a projection
// may name is listed: the own curves (construction curves too) and the curves of the entries, the
// own points (the ends and centres of own curves among them: `hc0`), `origin`, and the points of
// the entries (`fh0/center`, a copy's point). Nothing under `origin/` (the state of a sketch holds
// the axes and their far points since 6a2; the query filters by `underOrigin`).
// - `whole`: the whole-sketch form of `projectSketch` takes it (a curve that is not an own
//   construction curve, a copy that forms regions, a lone point). The rest is projected by naming
//   it: `addExternal`, or the tool with `entities`.
// - `regions`: whether it forms regions in its own sketch (the role `projectSketch` keeps).
// - `construction`: an own construction curve.
// - `entry`: the entry of `sketch` that projects it already, if one does.
// - the place: `at` of a point; `a`, `b` of a line; `center`, `radius` of a circle; `center`,
//   `start`, `end` of an arc, its ends already swapped when the map flips. An entity without
//   a place is one that cannot be projected: none in 6b; 6d lists a spline so, with its kind, so
//   that a caller sees why the whole sketch left it out.
export type SourceEntity = { id: Id; whole: boolean; regions: boolean; construction?: true; entry?: Id } & (
  | { kind: 'point'; at: Vec2 }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; start: Vec2; end: Vec2 }
);
// What 6d adds to the union: `{ kind: 'spline' }` with no place.
export type SourceEntityHook<K extends string> = { id: Id; whole: false; regions: boolean; construction?: true; kind: K };
// `sources`: without `from` the sketches before `sketch`, in the order of the timeline; with it the
// one. `entities` and `total` only with `from`, and only when that sketch is `parallel`: at most
// `max`, in the order of `projectSketch` for those it takes whole (the curves, then the lone
// points), then the other curves, then the other points.
export interface SketchSourcesResult {
  sources: SketchSource[];
  entities?: SourceEntity[];
  total?: number;
}
declare module '../00-prep/contract' {
  interface Queries {
    sketchSources: { spec: typeof SKETCH_SOURCES_ARGS; result: SketchSourcesResult };
  }
}
export const SKETCH_SOURCES = {
  title: 'What a sketch can project from earlier sketches',
  summary:
    'The sketches before a sketch on the timeline and whether each lies on a parallel plane, and, for one of them, its points and curves placed in the coordinates of the asking sketch. Ask it before addExternal with `type: "sketch"` or the sketch tool projectSketch.',
  returns:
    '`sources` (each `sketch`, `name`, `status`: parallel, tilted or notEvaluated; `angle` in rad; `flips`; counts) and, with `from`, `entities`: every curve and point of that sketch a projection may name (each `id`, `kind`, `whole` when the sketch tool projectSketch takes it without `entities`, `regions`, `entry` when projected already, and its place in mm in the asking sketch) with `total`.',
  geometry: 'none',
} as const;

// ================================================================ 8. the app

// The row of the kind in the list of entries (`REFERENCE_UI.sketch`, packages/app/src/references/
// projection.ts), in the form 6a implemented (`repair` is data) with three members 6b adds to the
// interface: `flag` (a checkbox in the row, which sends `updateExternal` with the flag switched),
// `inModel` (the curves of such an entry are drawn in the model view outside the sketch mode: a
// sketch made of projections alone is otherwise invisible; an edge's projection lies on its body
// and is not), and the host of `detail` gets `featureName`.
export interface ReferenceUi6b<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string; featureName(id: Id): string }): string;
  tag: string;
  repair?: { title: string; tool: string; hint: string };
  flag?: { label: string; get(ref: R): boolean | undefined; set(ref: R, on: boolean): R };
  inModel?: boolean;
}
// title "Point" | "Line" | "Circle" | "Arc"; detail "<sketch name>: <entity>"; tag "projected";
// repair by the tool `projectSketch`; flag "regions" on a curve (undefined on a point); inModel.
export declare const PROJECTION_UI: ReferenceUi6b<SketchProjection>;

// The tool *From sketch* (`projectSketch` in SKETCH_TOOL_UI, after `project`): its own picker over
// the answers of the query `sketchSources` (the earlier sketches on parallel planes, their entities
// where a projection would put them, drawn dashed by `draw` while the tool is active), points before
// curves, the latest sketch first; a place with a foreign snap. A click: `addExternal` (or
// `updateExternal` of the entry being repaired or the one projection selected); with *Whole sketch*,
// the engine's tool `projectSketch` with the role of the options.
export interface ProjectSketchOptions {
  regions: boolean; // a single pick: the flag of the new entry
  whole: boolean;
  as: NonNullable<ProjectSketchInput['as']>; // with `whole`
  from?: Id; // one sketch only; absent: any
}
export declare const PROJECT_SKETCH_TOOL: SketchPlaceTool<ProjectSketchOptions>;
export declare function pickInSketches(host: SketchHostStandIn, event: { clientX: number; clientY: number }, context: SketchContextStandIn, options: ProjectSketchOptions): PlaceStandIn | undefined;
export declare function projectClick(host: SketchHostStandIn, m: SketchModeStandIn & { repair?: Id }, place: PlaceStandIn, context: SketchContextStandIn, options: ProjectSketchOptions): CommandAfter | undefined;
