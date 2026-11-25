// The shape of a kind of entry of `external` of a sketch (D64, part 1). An entry is reference
// geometry, computed before the solver from the state before the sketch (the projection of an edge
// today), and from 6c also derived geometry, computed after the solver; each kind is a module of
// this directory and one line of `REFERENCE_KINDS` (index.ts). The vocabulary the kinds share (the
// derived IDs, the regions, the joins) is in docs/architecture/sketch.md.
import type { EntityKind } from '../catalog';
import type { Entity } from '../sketch-content';
import type { State } from '../recompute/state';
import type { CurveShape, ExternalRef, FaceName, Frame, Id, IssueCode, OpenEnds, PlacedOutline, Point2, Projected, ResultCurve, SketchFeature, StoredValue, Vec2 } from '../types';
import { type Dict, type FeatureRef, type ValidationContext, fail, finite, object } from '../validation';
import type { SketchBase } from './world';

// Where a curve or a point of a sketch comes from: drawn in it (`own`, the solver moves it), an
// entry computed before the solver (`reference`, fixed for the solver; constraints may name it),
// or an entry computed after the solver from the solved own geometry (`derived`, 6c).
// The sources that are not own are those a curve of the result has (`ResultCurve`, types.ts).
export type GeometrySource = 'own' | ResultCurve['source'];

// The geometry of one entry in the coordinates of its sketch, under the IDs of its entities.
// - `curves` run over IDs of `points` (or `origin`); the radius of a circle is in `radii`.
// - `regions`: the curves of the entry that form regions (never for the projection of an edge).
// - `hidden`: points that are no entities, which the result of a sketch does not list (the far
//   points of the axes of the origin, `AXES_GEOMETRY` of sketch-content.ts, D71).
// (6a had two more slots, pairs of points an entry joins and a join key per point; no kind declares
// either: the ends of the curves that are not own and form regions join by position in one stage
// after every derived entry, references/derive.ts, D68.)
export interface EntryGeometry {
  points: Record<Id, Point2>;
  curves: Record<Id, CurveShape>;
  radii: Record<Id, number>;
  regions: Id[];
  hidden?: Id[];
}

// What computing a reference may read: the state before the sketch and the frame of the sketch.
export interface ReferenceContext {
  state: State;
  frame: Frame;
}

// What every kind of entry says on the side of the document (D64, typed in two halves by D68).
// - `validate` reads one entry (the fields other than `type` are the kind's own) and fails as
//   validators do. It gets the sketch as validated so far and the reader of numeric fields: a field
//   of an entry is read at `external/<id>/<name>` (`context.fields`), so it takes an expression
//   kept in the sketch's `expressions` under that address. It checks the form only: it runs on
//   `load`, where an entry may name what was removed since.
// - `refs`: the references of the entry to other features, at `path` (`external/<id>`).
// - `faces`: the faces of bodies the entry reads (the fillet's list `shortened`).
// - `entities`: every entity of the entry by its derived ID, with its kind, in the order of the
//   kind, computed from the sketch alone, so commands and `load` are validated from the document.
// - `summary`: what the kind is, its IDs and what may name them, for the description of the API
//   (`describe_api`, section "Entries of a sketch").
// - `example`: an entry of the kind over the fixture of that section (a box `box` from a rectangle
//   `b1`..`b4` in the sketch `base`, and the sketch `top` on its top face with a rectangle `l1`..`l4`
//   and a construction line `cl`); the tests of MCP add it with addExternal.
export interface KindBase<R> {
  title: string;
  summary: string;
  example: { id: Id; ref: R };
  validate(context: ValidationContext, sketch: SketchFeature, id: Id, entry: Dict, what: string): R;
  refs(ref: R, path: string): FeatureRef[];
  faces(ref: R): FaceName[];
  entities(id: Id, ref: R, sketch: SketchFeature): Record<Id, EntityKind>;
}

// Why a reference could not be computed: the code of the warning and a detail for its message
// ("board has no circle bh3"), D69.
export interface ReferenceFailure {
  code: IssueCode;
  detail: string;
}

// A kind of reference geometry: computed before the solver from the state before the sketch, fixed
// for the solver; constraints may name its entities.
// - `compute`: its value from the state before the sketch, or the code of the warning, bare or with
//   a detail (D69).
// - `value`: the last valid value stored in `solved.external` read for this reference; it fails for
//   a value that is malformed and answers undefined for one that does not fit the reference.
// - `geometry`: the entities the value gives, fixed for the solver. The value, not the geometry,
//   goes into the stamp of the sketch.
// - `keepsValue`: whether `updateExternal` from `before` to `after` keeps the stored value (the same
//   source, another flag; D69). Absent: never, the value belonged to the source replaced.
// Three optional members, which only an imported outline says (D72):
// - `entity`: what one ID under the entry is, with one look-up, as the derived half has (an
//   outline of 2000 curves has 5000 entities, which every validation of a constraint would
//   otherwise list). `entityOf` asks it when it is there, and `entities` otherwise.
// - `narrow`: the solver gets of the entry only the entities a constraint of the sketch names (a
//   curve with its points and its radius, a point alone; `ResolvedReference.solver`); the step puts
//   the points and the radii of the rest into its geometry after the solver.
// - `partial`: `updateExternal` may leave fields of the entry out, which then keep what the entry
//   has, when the command's `type` is the type of the entry it updates.
export interface ReferenceKindSpec<R, V> extends KindBase<R> {
  source: 'reference';
  compute(ref: R, context: ReferenceContext): V | IssueCode | ReferenceFailure;
  value(stored: unknown, ref: R, what: string): V | undefined;
  geometry(id: Id, ref: R, value: V): EntryGeometry;
  keepsValue?(before: R, after: R): boolean;
  entity?(id: Id, ref: R, sketch: SketchFeature, entry: Id): EntityKind | undefined;
  narrow?: true;
  partial?: true;
}

// The failure of a derive: a warning of the sketch (`refs` the entry first), which may come with
// the geometry that could be made (a source gone, the rest copied).
export interface DerivedFailure {
  code: IssueCode;
  refs: unknown[];
  detail?: string;
  geometry?: EntryGeometry;
}

// A kind of derived geometry (D68): computed after the solver from the solved geometry of the
// sketch (the base of `sketchWorld`, references/world.ts). Nothing of it is stored, stamped or
// handed to the solver, and no constraint of its own sketch may name its entities.
// - `entity`: what one ID under the entry is, from the document alone and with one look-up (an ID
//   may be an entity whatever the count of the document, as a body of a pattern of features is).
//   `entities` (the base) lists those the document makes now.
// - `commandProblem`: what `addExternal` and `updateExternal` refuse beyond the form, read from the
//   sketch as it is (`entityOf`, what an ID is in it, handed in: the module of a kind is below the
//   registry). `before` is the entry as it was, for an update: only what it brings in is asked.
// - `derive`: the geometry of the entry, or the failure.
export interface DerivedKindSpec<R> extends KindBase<R> {
  source: 'derived';
  entity(id: Id, ref: R, sketch: SketchFeature, entry: Id): EntityKind | undefined;
  commandProblem(sketch: SketchFeature, ref: R, before: R | undefined, entityOf: (id: Id) => Entity | undefined): string | undefined;
  derive(id: Id, ref: R, base: SketchBase): EntryGeometry | DerivedFailure;
}

// The names of the kinds. A kind is a reference kind exactly when it stores a value in
// `solved.external` (it has its value here); the others are derived kinds. A kind added to
// `ExternalRef` (a member of the union) needs its entry in the registry, of the shape its name
// gives it, and a reference kind its value here.
export type EntryKindName = ExternalRef['type'];
export interface ReferenceValues {
  edge: Extract<Projected, { kind: 'line' | 'circle' }>;
  sketch: Projected;
  outline: PlacedOutline;
}
export type ReferenceKindName = keyof ReferenceValues & EntryKindName;
export type DerivedKindName = Exclude<EntryKindName, ReferenceKindName>;
// The values of the kinds are what `solved.external` may hold (`StoredValue` of types.ts).
export type { StoredValue };

export type ReferenceOf<T extends EntryKindName> = Extract<ExternalRef, { type: T }>;
export type KindOf<T extends EntryKindName> = T extends ReferenceKindName ? ReferenceKindSpec<ReferenceOf<T>, ReferenceValues[T]> : DerivedKindSpec<ReferenceOf<T>>;
export type AnyKind = ReferenceKindSpec<ExternalRef, StoredValue> | DerivedKindSpec<ExternalRef>;

// What the stage after the solver gives (references/derive.ts): the geometry of each derived entry
// (`regions` as the occupation pass left them), the pairs of the joins by position, the warnings of
// the entries, the open ends. It is not the record of the resolved references and no part of it is
// one: a resolved reference without a value enters the input of the solver, and nothing derived may.
export interface DerivedGeometry {
  entries: Record<Id, EntryGeometry>;
  joins: [Id, Id][];
  warnings: DerivedFailure[];
  openEnds?: OpenEnds;
}

// One entry as the sketch step resolved it: its value (fresh or the last valid one) and its
// geometry. A resolved reference without a value, under a key that is no entry, enters the input
// of the solver and is neither stamped nor stored: the axes of the origin under the key `origin`,
// when a constraint of the sketch names one (D71).
// `solver`: of an entry of a kind with `narrow`, what the input of the solver gets (the entities the
// constraints name); `geometry` is whole, for the curves of the sketch, the profile and the result.
export interface ResolvedReference {
  value?: StoredValue;
  geometry: EntryGeometry;
  solver?: EntryGeometry;
}

// A stored value of `solved.external` by its form (`Projected`: a point, a line, a circle, an arc),
// whatever the entry it belongs to; the `value` of a kind then says whether it fits the entry. It
// fails for a value that is malformed.
export function projected(v: unknown, what: string): Projected {
  const o = object(v, what);
  const vec2 = (value: unknown, name: string): Vec2 => {
    if (!Array.isArray(value) || value.length !== 2) fail(`${what}.${name}: čeká se dvojice čísel`);
    const pair = value as unknown[];
    return [finite(pair[0], `${what}.${name}`), finite(pair[1], `${what}.${name}`)];
  };
  switch (o.kind) {
    case 'point':
      return { kind: 'point', at: vec2(o.at, 'at') };
    case 'line':
      return { kind: 'line', a: vec2(o.a, 'a'), b: vec2(o.b, 'b') };
    case 'circle': {
      const radius = finite(o.radius, `${what}.radius`);
      if (radius <= 0) fail(`${what}.radius: poloměr musí být kladný`);
      return { kind: 'circle', center: vec2(o.center, 'center'), radius };
    }
    case 'arc':
      return { kind: 'arc', center: vec2(o.center, 'center'), start: vec2(o.start, 'start'), end: vec2(o.end, 'end') };
    default:
      return fail(`${what}.kind: point, line, circle or arc is expected`);
  }
}
