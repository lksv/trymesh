// What the content of a sketch is, without validation: its entities, the operands and the keys of
// its constraints, the IDs of a document. A leaf of the engine: it imports only the types, the
// catalog and the utilities, so the sketch solver setup, the diagnosis and the feature modules can
// all read it below the registry of feature types.
import { CONSTRAINTS, type EntityKind } from './catalog';
import type { EntryGeometry } from './references/spec';
import type { Constraint, Curve, CurvePointName, CurveShape, Dimension, Document, FieldPath, Id, PlaneRef, SketchFeature } from './types';
import { ORIGIN, has, unreachable } from './util';

export const emptySketch = (id: Id, name: string, plane: PlaneRef): SketchFeature => ({
  id,
  name,
  suppressed: false,
  type: 'sketch',
  plane,
  points: {},
  radii: {},
  curves: {},
  constraints: {},
  external: {},
  solved: { inputs: '', external: {} },
});

// All IDs in the document: features and the entities of all sketches.
export function documentIds(doc: Document): Set<Id> {
  const ids = new Set<Id>();
  for (const f of doc.features) {
    ids.add(f.id);
    if (f.type === 'sketch') for (const group of [f.points, f.curves, f.constraints, f.external]) for (const id of Object.keys(group)) ids.add(id);
  }
  return ids;
}

// The ID of a body is the ID of the feature that created it, or `<feature>/<local name>` when the
// feature creates more of them. An ID given by the caller must not contain a slash, so the split is
// unambiguous.
export function bodyOwner(body: Id): { feature: Id; local?: string } {
  const slash = body.indexOf('/');
  return slash < 0 ? { feature: body } : { feature: body.slice(0, slash), local: body.slice(slash + 1) };
}

export type { EntityKind };
export interface Entity {
  kind: EntityKind;
  own: boolean; // false = the origin or projected geometry: the solver does not move it
  // an entity of an entry of derived geometry (a copy of a mirror or pattern, D68): computed after
  // the sketch is solved, so no constraint of its own sketch may name it
  derived?: true;
}

// What an ID is in a sketch (`entityOf`) and the derived points of an entry of `external` are in
// references/index.ts, by the registry of the kinds of entries.

// The axes of the origin (D71) as geometry: `origin/x` and `origin/y` from `origin` to the hidden
// far points at (1, 0) and (0, 1), so their sense is +X and +Y of the sketch. What `sketchCurves`
// adds to the list of every sketch (`AXIS_CURVES` of sketch.ts), what the state's geometry holds,
// and what the first stage of the sketch step puts into the solver under the key `origin` when a
// constraint of the sketch names an axis.
export const AXES_GEOMETRY: EntryGeometry = {
  points: { 'origin/x/b': { x: 1, y: 0 }, 'origin/y/b': { x: 0, y: 1 } },
  curves: { 'origin/x': { type: 'line', a: ORIGIN, b: 'origin/x/b' }, 'origin/y': { type: 'line', a: ORIGIN, b: 'origin/y/b' } },
  radii: {},
  regions: [],
  hidden: ['origin/x/b', 'origin/y/b'],
};

// The named points a curve is given by, by the kind of the curve (D52): the fields of the shape that
// hold one ID, so the table cannot name a point a curve does not have. A spline has none: its
// control points are a list (`points`), which `setCurvePoint` does not re-point (D70).
export const CURVE_POINTS = { line: ['a', 'b'], circle: ['center'], arc: ['center', 'start', 'end'], spline: [] } as const satisfies {
  [T in CurveShape['type']]: readonly PointFields<Extract<CurveShape, { type: T }>>[];
};
// The fields of a shape that hold one ID (not `type`, not a list).
type PointFields<S> = { [K in keyof S]: K extends 'type' ? never : S[K] extends Id ? K : never }[keyof S];
type TableName = (typeof CURVE_POINTS)[keyof typeof CURVE_POINTS][number];
// every name of the table is a CurvePointName, and every CurvePointName is in the table
true satisfies (TableName extends CurvePointName ? (CurvePointName extends TableName ? true : false) : false);
// and each kind lists every point field its shape has
type Complete = { [T in CurveShape['type']]: [PointFields<Extract<CurveShape, { type: T }>>] extends [(typeof CURVE_POINTS)[T][number]] ? true : false };
({ line: true, circle: true, arc: true, spline: true }) satisfies Complete;

// The kinds of a sketch curve the validator of a curve accepts: the keys of the table, so a kind
// added to `CurveShape` is accepted only once the table and the validator's switch have it.
export const CURVE_KINDS = Object.keys(CURVE_POINTS) as CurveShape['type'][];

// Every point a curve is given by: a line's ends, a circle's centre, an arc's centre and ends, a
// spline's control points in order, the closing repeat included (readers that need each point once
// make a set).
export function curvePoints(curve: Curve): Id[] {
  switch (curve.type) {
    case 'line':
      return [curve.a, curve.b];
    case 'circle':
      return [curve.center];
    case 'arc':
      return [curve.center, curve.start, curve.end];
    case 'spline':
      return [...curve.points];
    default:
      return unreachable(curve, 'curve');
  }
}

// The operands of a constraint in the order of the catalog.
export function constraintOperands(c: Constraint): Id[] {
  return CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
}

// A dimension is a constraint the catalog marks with the `dimension` flag: it has a value and `driving`.
export const isDimension = (c: Constraint): c is Dimension => CONSTRAINTS[c.type].dimension === true;

// The address of a constraint value among the numeric fields of a sketch.
export const constraintPath = (constraint: Id, value = 'value'): FieldPath => `constraints/${constraint}/${value}`;

// The constraints the solver gets: geometric ones and driving dimensions.
export const isDriving = (c: Constraint): boolean => !isDimension(c) || c.driving;

// The key of a constraint for finding duplicates: the type and the operands. Operands the catalog
// marks as interchangeable (for oriented dimensions and the angle a swap only flips the sign of
// the value) are sorted.
export function constraintKey(c: Constraint): string {
  const spec = CONSTRAINTS[c.type];
  const value = (field: string): Id => (c as unknown as Record<string, Id>)[field];
  const unordered = (spec.unordered ?? []).map(value).sort();
  const ordered = spec.operands.filter((operand) => !spec.unordered?.includes(operand.field)).map((operand) => value(operand.field));
  return JSON.stringify([c.type, ...unordered, ...ordered]);
}

// A driving constraint with the same type and operands that is already in the sketch (other than
// the constraint `except`).
export function duplicateOf(sketch: SketchFeature, c: Constraint, except?: Id): Id | undefined {
  if (!isDriving(c)) return undefined;
  const key = constraintKey(c);
  return Object.keys(sketch.constraints).find((id) => id !== except && isDriving(sketch.constraints[id]) && constraintKey(sketch.constraints[id]) === key);
}
