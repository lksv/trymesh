// Contract of package 6b (D69): the projection of a point, line, circle or arc of another sketch,
// and the axes of the origin. A draft for review, only type-checked (`npx tsc -p
// docs/d36/tsconfig.json`). It imports the real types of the engine (6a, D64, is implemented: the
// registry of kinds in packages/engine/src/references/) and the contracts of 6c (D68) and 6e (D65),
// which are implemented before 6b, and states what 6b adds or changes. The design is design.md,
// the calls are calls.ts.
//
// What changes:
// 1. A reference kind of entry of `external`, `sketch`: one entity of an earlier sketch on a
//    parallel plane, its `kind` stored, a flag `regions`. `ExternalRef` gets the member.
// 2. Its value (`ProjectedEntity`): the projected positions and the vertex of each source point in
//    the source; stored in `solved.external` and stamped. A projected arc is made exact.
// 3. The join keys of 6a's slot, read by `joinPairs`: projections of one point of a source join.
// 4. The axes of the origin `origin/x`, `origin/y`: lines of every sketch, in the solver only when
//    a constraint names one, not in `SketchResult`.
// 5. What the registry's spec gains: a detail of a failure, `reads`, `keepsValue`.
// 6. A sketch tool `projectSketch` with an input kind `sketch`; the app's tool *From sketch* and
//    the row of the kind.
// No command, no query, no feature type, no face role, no issue code, no schema step.

import type { Frame, Id, IssueCode, Projected, SketchFeature, Vec2 } from '../../../packages/engine/src/index';
import type { NewId, SketchToolContext } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { SketchState, State } from '../../../packages/engine/src/recompute/state';
import type { EntryGeometry, ReferenceContext, ReferenceKindSpec } from '../../../packages/engine/src/references/spec';
import type { Dict, FeatureRef, ValidationContext } from '../../../packages/engine/src/validation';
import type { CommandAfter, DocumentAfter } from '../00-prep/contract';
import type { PlaceStandIn, SketchContextStandIn, SketchHostStandIn, SketchModeStandIn, SketchPlaceTool } from '../6a-sketch-prep/contract';
import type { EdgeProjection, SketchPattern } from '../6c-sketch-mirror-pattern/contract';
import type { SketchToolInputAfter, SketchToolInputsAfter, SketchToolResultAfter } from '../6e-trim-extend-split/contract';

// ================================================================ 1. the entry

// The projection of one entity of an earlier sketch (D69): reference geometry, fixed for the solver
// and computed at every recompute from the solved sketch `sketch` before this one. In types.ts this
// comment is read by the AI.
// - `sketch`: a sketch before this one on the timeline, on a plane parallel to this sketch's (either
//   normal, any offset); the projection runs along this sketch's normal. A plane that is not
//   parallel gives the warning `unsupportedProjection`, whose message says the angle.
// - `entity`: a point or a curve of it: an own point or curve (a construction curve too), `origin`,
//   or an entity of one of its entries (`fl1`, `fl1/a`, `h/center`, a copy of a mirror `m/1/c2`).
//   Not its axes `origin/x`, `origin/y`: this sketch has its own (project its `origin` when its
//   origin lies elsewhere).
// - `kind`: the kind of `entity`, `point`, `line`, `circle` or `arc`; a command checks it against
//   the source (get_sketch of the source lists the kinds; the tool `projectSketch` fills it in).
// - `regions`: `true` when the projected curve bounds regions of this sketch, as an own curve that
//   is not construction does; without it the curve is reference only, as a projected edge. Not on
//   a point.
// - The entry is the projected entity: `<id>` (a point, or the curve), and the points of a curve
//   are `<id>/a`, `<id>/b` (a line), `<id>/center` (a circle), `<id>/center`, `<id>/start`,
//   `<id>/end` (an arc, counter-clockwise from `start`; on a sketch whose normal is opposite to the
//   source's the ends swap, so it stays counter-clockwise here). Constrain own geometry to them;
//   a constraint needs one own operand. Hold an own arc on a projected one by its two ends
//   (`coincident`) and `equalRadius`, not by its centre as well (that is a conflict).
// - Projected points of one source point are one point of this sketch's profile: eight entries
//   projecting a rounded rectangle close into one loop. Projections of two different sketches meet
//   only through an own point tied to both by `coincident`.
// - The values follow the source at every recompute. When the source sketch is not evaluated before
//   this one, its entity is gone or is of another kind now (a circle trimmed into an arc), the
//   projection keeps its last values with the warning `brokenProjection`, and constraints on it
//   keep acting.
// - A side face of an extrusion of a region bounded by a projected curve is named by the entry's ID
//   (`{ feature, role: 'side', curve: <id> }`).
// - One entry per entity of the source: a second one is refused, naming the first.
export interface SketchProjection {
  type: 'sketch';
  sketch: Id;
  entity: Id;
  kind: ProjectedKind;
  regions?: true;
}
export type ProjectedKind = Extract<EntityKind, 'point' | 'line' | 'circle' | 'arc'>;

// `ExternalRef` after 6c and 6b (6c named the edge `EdgeProjection` and made the union).
export type ExternalRef6b = EdgeProjection | SketchPattern | SketchProjection;

declare module '../00-prep/contract' {
  interface Commands {
    // `addExternal` and `updateExternal` of today with a projection from a sketch. A command takes
    // `regions: false` as no flag (the document holds only `true`).
    sketchProjection: { type: 'addExternal' | 'updateExternal'; sketch: Id; id: Id; ref: SketchProjectionInput };
  }
}
export type SketchProjectionInput = Omit<SketchProjection, 'regions'> & { regions?: boolean };

// The registry gets the kind and its value: in the code a line of `REFERENCE_KINDS` and
// `ReferenceValues.sketch: ProjectedEntity` (references/spec.ts). (Not merged into 6a's draft
// `ReferenceKinds` here: that would retype 6a's calls.ts, which reads a stored value as an edge's.)
export interface ReferenceValues6b {
  edge: Projected;
  sketch: ProjectedEntity;
}

// ================================================================ 2. the value

// The value of a projection from a sketch in the coordinates of this sketch, stored in
// `solved.external` as its last valid value and stamped. `vertices` are the vertices of the source
// points in the source (its joins: the point with the smallest ID of those joined with it), in the
// order of `CURVE_POINTS[kind]` (a point: itself), after the swap of the ends of a flipped arc.
// An arc's `end` lies on the circle of its `start` exactly (made so by `compute`).
export type ProjectedEntity =
  | { kind: 'point'; at: Vec2; vertices: [Id] }
  | { kind: 'line'; a: Vec2; b: Vec2; vertices: [Id, Id] }
  | { kind: 'circle'; center: Vec2; radius: number; vertices: [Id] }
  | { kind: 'arc'; center: Vec2; start: Vec2; end: Vec2; vertices: [Id, Id, Id] };

// What `solved.external` holds after 6b (`SolveStamp.external` in types.ts), and the reader of
// a stored value by its form before it is matched with its entry (6a's `storedValue`): a value with
// `vertices` is a `ProjectedEntity`, one without an edge's `Projected`. The edge's `value` refuses
// a value with `vertices`, the sketch kind's one without; either answers undefined, which the
// validator of the sketch reports with the text of today.
export type StoredValue6b = Projected | ProjectedEntity;
export declare function storedValue(v: unknown, what: string): StoredValue6b;
export declare function projectedEntity(v: unknown, what: string): ProjectedEntity;

// The key of a projected point (6a's `EntryGeometry.keys`): the source sketch and the vertex there,
// as a JSON tuple led by the kind.
export const projectionKey = (sketch: Id, vertex: Id): string => JSON.stringify(['sketch', sketch, vertex]);

// ================================================================ 3. the kind

// What 6b adds to the spec of a reference kind (references/spec.ts):
// - `compute` may say why it failed: `{ code, detail }` beside a bare code. `resolveReferences`
//   keeps the detail with the entry in `lost`, and the step's warning carries it ("(board has no
//   curve c1; the constraints on it were left out of the solve)").
// - `reads`: the entities of other sketches an entry reads. The fillet (D52) and 6e's tools list a
//   sketch whose entry reads a curve they change in `shortened`, as one that projects an edge of its
//   side face. Absent: none (the edge).
// - `keepsValue`: whether `updateExternal` from `before` to `after` keeps the stored value (the same
//   source, another flag). Absent: never (the edge, as today).
export type Failure = { code: IssueCode; detail: string };
export interface ReferenceKindSpec6b<R, V> extends Omit<ReferenceKindSpec<R, V>, 'compute'> {
  compute(ref: R, context: ReferenceContext): V | IssueCode | Failure;
  reads?(ref: R): { sketch: Id; entity: Id }[];
  keepsValue?(before: R, after: R): boolean;
}
export interface ResolvedReferences6b {
  resolved: Record<Id, { value?: StoredValue6b; geometry: EntryGeometry }>;
  lost: [Id, IssueCode, string?][];
}

// The kind, in packages/engine/src/references/sketch.ts:
// - `validate`: the fields (`type`, `sketch`, `entity`, `kind`, `regions` and no other); `kind` one
//   of the four; `entity` not `origin/x` or `origin/y` (AXIS_OF_ANOTHER_SKETCH); `regions` a boolean,
//   `true` refused on a point (REGIONS_ON_A_POINT), `false` dropped; `context.requireRef` of the
//   sketch and of the entity with `accepts: [kind]` (a command: earlier on the timeline, there, of
//   that kind; `load`: not checked, as every reference); no other entry of this sketch with the same
//   `sketch` and `entity`, the entry `id` itself excepted (DUPLICATE).
// - `refs`: the sketch and the entity, at `external/<id>`.
// - `faces`: none. `reads`: `[{ sketch, entity }]`.
// - `entities`: `<id>` of `kind`, then the points `<id>/<name>` of `CURVE_POINTS[kind]`.
// - `compute`: below (`projectFromSketch`).
// - `value`: `projectedEntity(stored)` when its `kind` is the entry's, else undefined.
// - `geometry`: the points under the entity IDs, the curve, a circle's radius, `regions: [id]` with
//   the flag on a curve, and `keys` of every point from `vertices` (`projectionKey`).
// - `keepsValue`: the same `sketch`, `entity` and `kind`.
export declare const SKETCH_KIND: ReferenceKindSpec6b<SketchProjection, ProjectedEntity> & { source: 'reference' };
export declare function validateSketchProjection(context: ValidationContext, sketch: SketchFeature, id: Id, entry: Dict, what: string): SketchProjection;
export declare function sketchProjectionRefs(ref: SketchProjection, path: string): FeatureRef[];

// The map from the plane of one sketch to the plane of another, as the projection uses it:
// `toPlane(to, toWorld(from, p))`, the distance along the normal dropped. `parallel` within
// ANGLE_TOLERANCE (1e-4 rad), `flips` when the normals are opposite (the map reflects; an arc swaps
// its ends), `angle` the angle between the planes (for the message). Exported by the engine for the
// app's picker, so what it draws is what the projection gives.
export interface SketchMap {
  at(p: Vec2): Vec2;
  parallel: boolean;
  flips: boolean;
  angle: number;
}
export declare function sketchMap(from: Frame, to: Frame): SketchMap;

// `compute` of the kind: the source's `SketchState` from `state.sketches`; the planes; the entity
// (a point from `geometry.points`, a curve from `curves`, a circle's radius from `geometry.radii`);
// the positions mapped; the vertices from `joins`; an arc's ends swapped across a flip and its end
// put on the circle of its start: end = center + |start − center| · (end − center) / |end − center|.
// The failures, each with its detail (the texts below): the sketch not in the state
// (`brokenProjection`, SOURCE_NOT_EVALUATED), the planes not parallel (`unsupportedProjection`,
// NOT_PARALLEL), no such point or curve (`brokenProjection`, ENTITY_GONE), a curve of another kind
// (`brokenProjection`, KIND_CHANGED).
export declare function projectFromSketch(ref: SketchProjection, source: SketchState | undefined, frame: Frame): ProjectedEntity | Failure;
export const projectionContext = (state: State, frame: Frame): ReferenceContext => ({ state, frame });

// The texts of the kind (English, new).
export const AXIS_OF_ANOTHER_SKETCH = (sketch: Id): string => `the axes of another sketch are not projected: use origin/x and origin/y of this sketch, or project the origin of ${sketch}`;
export const REGIONS_ON_A_POINT = 'a projected point forms no regions; regions is for a line, a circle or an arc';
export const DUPLICATE = (entity: Id, sketch: Id, entry: Id): string => `${entity} of ${sketch} is projected already as ${entry}`;
export const SOURCE_NOT_EVALUATED = (sketch: Id): string => `${sketch} is not evaluated before this sketch: removed, suppressed, in error, or later on the timeline`;
export const NOT_PARALLEL = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degrees.toFixed(1)}° to this sketch; only a parallel plane is projected`;
export const ENTITY_GONE = (sketch: Id, entity: Id, kind: ProjectedKind): string => `${sketch} has no ${kind} ${entity}`;
export const KIND_CHANGED = (sketch: Id, entity: Id, now: string, kind: ProjectedKind): string => `${entity} of ${sketch} is a ${now} now, not a ${kind}`;
// The general texts of the warnings (recompute/services.ts, `MESSAGE`), English and for every kind;
// the detail of a kind follows in brackets, as `issue(code, refs, detail)` composes it.
export const MESSAGES = {
  brokenProjection: 'The projected geometry is no longer in its source; it keeps its last valid place.',
  unsupportedProjection: 'The geometry cannot be projected into this sketch.',
  degenerateProjection: 'The edge is perpendicular to the sketch plane and projects to a point.',
} as const satisfies Partial<Record<IssueCode, string>>;

// ================================================================ 4. joins

// `joinPairs(feature, references)` of sketch.ts, 6a's slot written: the operands of every
// `coincident`, then the `joins` the entries declare, then every two points of the entries that
// carry the same key: in the order of the entry IDs, each later point paired with the first point
// of its key (`joinsOf` closes them transitively, joining only pairs within the length tolerance).
// 6c's join stage adds its pairs after these.
export declare function joinPairs(feature: SketchFeature, references: Record<Id, { geometry: EntryGeometry }>): [Id, Id][];

// ================================================================ 5. the axes of the origin

// `origin/x` and `origin/y`: lines of every sketch from `origin` to the hidden points `origin/x/b`
// at (1, 0) and `origin/y/b` at (0, 1), so their sense is +X and +Y of the sketch (an `angle`
// dimension, a revolve about `sketchLine`, a direction of 6c read it). In util.ts beside ORIGIN.
export const ORIGIN_AXES = ['origin/x', 'origin/y'] as const;
export type OriginAxis = (typeof ORIGIN_AXES)[number];
export const isOriginAxis = (id: Id): id is OriginAxis => id === 'origin/x' || id === 'origin/y';
// How far the sketch tools (`shapeOf` of sketch-tools.ts) and the app's view reach along an axis:
// they see it as the line from −AXIS_REACH to +AXIS_REACH (mm), since they clamp a line to its
// segment.
export const AXIS_REACH = 1e6;

// Their geometry (references/axes.ts): what `sketchCurves` adds to the list of every sketch, what
// the state's `geometry` holds, and what `resolveReferences` puts into the solver under the key
// `origin` (no value, not stamped) when a constraint of the sketch names an axis.
export const AXES_GEOMETRY: EntryGeometry = {
  points: { 'origin/x/b': { x: 1, y: 0 }, 'origin/y/b': { x: 0, y: 1 } },
  curves: { 'origin/x': { type: 'line', a: 'origin', b: 'origin/x/b' }, 'origin/y': { type: 'line', a: 'origin', b: 'origin/y/b' } },
  radii: {},
  regions: [],
  hidden: ['origin/x/b', 'origin/y/b'],
};
// Whether a constraint of the sketch names an axis (a reference dimension too: `measure` reads the
// curves of the input).
export declare function axesNamed(feature: SketchFeature): boolean;
// `entityOf(sketch, 'origin/x')` answers `{ kind: 'line', own: false }`; `referenceEntities` does
// not list the axes (they are no entry). The points of an axis for the catalog's rules (a symmetric
// point no end of its axis): `['origin']`.
// The catalog's `check` of `midpoint` and `equalLength` refuses an axis:
export const AXIS_HAS_NO_LENGTH = (axis: OriginAxis): string => `${axis} is an axis of the origin, a whole line: it has no length and no middle`;

// The step after 6b, in order:
// 1. `resolveReferences`: the entries in the order of their IDs, each fresh, else stored, else none,
//    with the detail of a failure; then `origin` with AXES_GEOMETRY when `axesNamed`.
// 2. `solverSetup` and the solver, as today (the far points fixed; the stamp holds the entries'
//    values, the curves of the input with the axes when named).
// 3. The state: `geometry` the solved positions and the axes' far points always; `curves` from
//    `sketchCurves`, the axes always (once); `joins` from `joinPairs` with the keys; then 6c's
//    derived stage.
// 4. The profile; the result: `points` without hidden points, `curves` of the entries (the axes
//    not among them); the warnings with their details.
export interface SketchResultNote {
  // `SketchResult.points` and `curves` hold no axis and no far point: the readers that need the
  // axes (the app's view, the sketch tools, 6c's tools in memory) take AXES_GEOMETRY.
  axesInResult: false;
}

// ================================================================ 6. the sketch tool

// `projectSketch`: every curve of `sketch` that is not a construction curve (own curves, then the
// curves of its entries in the order of `external` and of their kinds; never the axes) and every
// lone point (an own point no own curve uses, and the point entries of the source), projected into
// the sketch of the context, each by one `addExternal` with a fresh ID (`x…`), its `kind` from the
// source and, with `as: 'regions'`, `regions: true` on the curves. An entity this sketch projects
// already is skipped.
// - `ids`: `entries` (the new entries), `sources` (the entity each projects), `skipped` (entities
//   projected already, with no entry made).
// - Refused: a sketch the document does not have or that is not a sketch, this sketch, a sketch
//   after it on the timeline, a source with nothing to project (or all of it projected already).
// - The planes are not known to a tool (no recompute): a tilted source gives the warning on every
//   entry.
export interface ProjectSketchInput {
  sketch: Id;
  as?: 'reference' | 'regions';
}
export interface SketchToolInputs6b extends SketchToolInputsAfter {
  projectSketch: ProjectSketchInput;
}
// The input kind `sketch`: the ID of a sketch of the document (MCP: "the ID of an earlier sketch of
// the document").
export type SketchToolInput6b = SketchToolInputAfter | { kind: 'sketch' };
export const PROJECT_SKETCH_IDS = {
  entries: 'the new entries of external, one per projected entity, in the order of `sources`',
  sources: 'the entity of the source sketch each entry projects',
  skipped: 'entities of the source this sketch projects already; no entry was made for them',
} as const;
export interface SketchToolCall6b extends SketchToolContext {
  document: DocumentAfter;
}
export declare function sketchTool<K extends keyof SketchToolInputs6b>(tool: K, context: SketchToolCall6b, input: SketchToolInputs6b[K], newId: NewId): SketchToolResultAfter;
export const TOOL_EXAMPLE: ProjectSketchInput = { sketch: 'frame', as: 'regions' };

// ================================================================ 7. the app

// The row of the kind in the list of entries (`REFERENCE_UI.sketch`, packages/app/src/references/
// sketch.ts), in the form 6a implemented (`repair` is data) with two members 6b adds to the
// interface: `flag` (a checkbox in the row, which sends `updateExternal` with the flag switched)
// and the host of `detail` gets `featureName`.
export interface ReferenceUi6b<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string; featureName(id: Id): string }): string;
  tag: string;
  repair?: { title: string; tool: string; hint: string };
  flag?: { label: string; get(ref: R): boolean | undefined; set(ref: R, on: boolean): R };
}
// title "Point" | "Line" | "Circle" | "Arc"; detail "<sketch name>: <entity>"; tag "projected";
// repair by the tool `projectSketch`; flag "regions" on a curve (undefined on a point).
export declare const SKETCH_PROJECTION_UI: ReferenceUi6b<SketchProjection>;

// The tool *From sketch* (`projectSketch` in SKETCH_TOOL_UI, after `project`): its own picker over
// the earlier sketches on parallel planes, their entities mapped into the open sketch by `sketchMap`
// (drawn dashed by `draw` while the tool is active), points before curves, the latest sketch first;
// a place with a foreign snap. A click: `addExternal` (or `updateExternal` of the entry being
// repaired or the one projection selected); with *Whole sketch*, the engine's tool `projectSketch`.
export interface ProjectSketchOptions {
  regions: boolean;
  whole: boolean;
  from?: Id; // one sketch only; absent: any
}
export declare const PROJECT_SKETCH_TOOL: SketchPlaceTool<ProjectSketchOptions>;
export declare function pickInSketches(host: SketchHostStandIn, event: { clientX: number; clientY: number }, context: SketchContextStandIn, options: ProjectSketchOptions): PlaceStandIn | undefined;
export declare function projectClick(host: SketchHostStandIn, m: SketchModeStandIn & { repair?: Id }, place: PlaceStandIn, context: SketchContextStandIn, options: ProjectSketchOptions): CommandAfter | undefined;
