// The shape of a kind of entry of `external` of a sketch (D64, part 1). An entry is reference
// geometry, computed before the solver from the state before the sketch (the projection of an edge
// today), and from 6c also derived geometry, computed after the solver; each kind is a module of
// this directory and one line of `REFERENCE_KINDS` (index.ts). The vocabulary the kinds share (the
// derived IDs, the regions, the joins) is in docs/architecture/sketch.md.
import type { EntityKind } from '../catalog';
import type { State } from '../recompute/state';
import type { CurveShape, ExternalRef, FaceName, Frame, Id, IssueCode, Point2, Projected, ResultCurve, SketchFeature } from '../types';
import type { Dict, FeatureRef, ValidationContext } from '../validation';

// Where a curve or a point of a sketch comes from: drawn in it (`own`, the solver moves it), an
// entry computed before the solver (`reference`, fixed for the solver; constraints may name it),
// or an entry computed after the solver from the solved own geometry (`derived`, 6c).
// The sources that are not own are those a curve of the result has (`ResultCurve`, types.ts).
export type GeometrySource = 'own' | ResultCurve['source'];

// The geometry of one entry in the coordinates of its sketch, under the IDs of its entities.
// - `curves` run over IDs of `points` (or `origin`); the radius of a circle is in `radii`.
// - `regions`: the curves of the entry that form regions (never for the projection of an edge).
// - `joins`, `keys`, `hidden`: slots that no kind of today fills (the pairs of points that join,
//   a join key per point, points that are no entities); design.md of 6a says who writes them.
export interface EntryGeometry {
  points: Record<Id, Point2>;
  curves: Record<Id, CurveShape>;
  radii: Record<Id, number>;
  regions: Id[];
  joins?: [Id, Id][];
  keys?: Record<Id, string>;
  hidden?: Id[];
}

// What computing a reference may read: the state before the sketch and the frame of the sketch.
export interface ReferenceContext {
  state: State;
  frame: Frame;
}

// A kind of reference geometry.
// - `validate` reads one entry (the fields other than `type` are the kind's own) and fails as
//   validators do. It gets the sketch as validated so far and the reader of numeric fields (a field
//   of an entry is read at `external/<id>/<name>`; no kind of today has one).
// - `refs`: the references of the entry to other features, at `path` (`external/<id>`).
// - `faces`: the faces of bodies the entry reads (the fillet's list `shortened`).
// - `entities`: every entity of the entry by its derived ID, with its kind, in the order of the
//   kind, computed from the sketch alone, so commands and `load` are validated from the document.
// - `compute`: its value from the state before the sketch, or the code of the warning.
// - `value`: the last valid value stored in `solved.external` read for this reference; it fails for
//   a value that is malformed and answers undefined for one that does not fit the reference.
// - `geometry`: the entities the value gives, fixed for the solver. The value, not the geometry,
//   goes into the stamp of the sketch.
export interface ReferenceKindSpec<R, V> {
  source: 'reference';
  title: string;
  validate(context: ValidationContext, sketch: SketchFeature, id: Id, entry: Dict, what: string): R;
  refs(ref: R, path: string): FeatureRef[];
  faces(ref: R): FaceName[];
  entities(id: Id, ref: R, sketch: SketchFeature): Record<Id, EntityKind>;
  compute(ref: R, context: ReferenceContext): V | IssueCode;
  value(stored: unknown, ref: R, what: string): V | undefined;
  geometry(id: Id, ref: R, value: V): EntryGeometry;
}

// The names of the kinds, and the value each stores in `solved.external`. A kind added to
// `ExternalRef` (a member of the union) needs its value here and its entry in the registry.
export type ReferenceKindName = ExternalRef['type'];
export interface ReferenceValues {
  edge: Projected;
}
export type StoredValue = ReferenceValues[ReferenceKindName];
export type ReferenceOf<T extends ReferenceKindName> = Extract<ExternalRef, { type: T }>;

// One entry as the sketch step resolved it: its value (fresh or the last valid one) and its
// geometry. A resolved reference without a value, under a key that is no entry, enters the input
// of the solver and is neither stamped nor stored (a slot: the axes of the origin, 6b).
export interface ResolvedReference {
  value?: StoredValue;
  geometry: EntryGeometry;
}
