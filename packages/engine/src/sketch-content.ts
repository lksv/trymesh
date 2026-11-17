// What the content of a sketch is, without validation: its entities, the operands and the keys of
// its constraints, the IDs of a document. A leaf of the engine: it imports only the types, the
// catalog and the utilities, so the sketch solver setup, the diagnosis and the feature modules can
// all read it below the registry of feature types.
import { CONSTRAINTS, type EntityKind } from './catalog';
import type { Constraint, Curve, CurvePointName, CurveShape, Dimension, Document, FieldPath, Id, PlaneRef, SketchFeature } from './types';
import { has, unreachable } from './util';

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

// Všechna ID v dokumentu: features a entity všech skic.
export function documentIds(doc: Document): Set<Id> {
  const ids = new Set<Id>();
  for (const f of doc.features) {
    ids.add(f.id);
    if (f.type === 'sketch') for (const group of [f.points, f.curves, f.constraints, f.external]) for (const id of Object.keys(group)) ids.add(id);
  }
  return ids;
}

// ID tělesa je ID feature, která ho vytvořila, nebo `<feature>/<místní jméno>`, když jich feature
// vytváří víc. Lomítko v ID zadaném volajícím být nesmí, takže rozklad je jednoznačný.
export function bodyOwner(body: Id): { feature: Id; local?: string } {
  const slash = body.indexOf('/');
  return slash < 0 ? { feature: body } : { feature: body.slice(0, slash), local: body.slice(slash + 1) };
}

export type { EntityKind };
export interface Entity {
  kind: EntityKind;
  own: boolean; // false = počátek nebo promítnutá geometrie: solver s ní nehýbe
}

// What an ID is in a sketch (`entityOf`) and the derived points of an entry of `external` are in
// references/index.ts, by the registry of the kinds of entries.

// The points a curve is given by, by the kind of the curve (D52): the fields of the shape other
// than `type`, so the table cannot name a point a curve does not have.
export const CURVE_POINTS = { line: ['a', 'b'], circle: ['center'], arc: ['center', 'start', 'end'] } as const satisfies {
  [T in CurveShape['type']]: readonly Exclude<keyof Extract<CurveShape, { type: T }>, 'type'>[];
};
type TableName = (typeof CURVE_POINTS)[keyof typeof CURVE_POINTS][number];
// every name of the table is a CurvePointName, and every CurvePointName is in the table
true satisfies (TableName extends CurvePointName ? (CurvePointName extends TableName ? true : false) : false);
// and each kind lists every point its shape has
type Complete = { [T in CurveShape['type']]: [Exclude<keyof Extract<CurveShape, { type: T }>, 'type'>] extends [(typeof CURVE_POINTS)[T][number]] ? true : false };
({ line: true, circle: true, arc: true }) satisfies Complete;

// The kinds of a sketch curve the validator of a curve accepts: the keys of the table, so a kind
// added to `CurveShape` is accepted only once the table and the validator's switch have it.
export const CURVE_KINDS = Object.keys(CURVE_POINTS) as CurveShape['type'][];

export function curvePoints(curve: Curve): Id[] {
  switch (curve.type) {
    case 'line':
      return [curve.a, curve.b];
    case 'circle':
      return [curve.center];
    case 'arc':
      return [curve.center, curve.start, curve.end];
    default:
      return unreachable(curve, 'curve');
  }
}

// Operandy vazby v pořadí katalogu.
export function constraintOperands(c: Constraint): Id[] {
  return CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
}

// A dimension is a constraint the catalog marks with the `dimension` flag: it has a value and `driving`.
export const isDimension = (c: Constraint): c is Dimension => CONSTRAINTS[c.type].dimension === true;

// The address of a constraint value among the numeric fields of a sketch.
export const constraintPath = (constraint: Id, value = 'value'): FieldPath => `constraints/${constraint}/${value}`;

// Vazby, které dostává solver: geometrické a řídicí kóty.
export const isDriving = (c: Constraint): boolean => !isDimension(c) || c.driving;

// Klíč vazby pro hledání duplicit: typ a operandy. Operandy, které katalog označuje za
// zaměnitelné (u orientovaných kót a úhlu záměna jen obrací znaménko hodnoty), se seřadí.
export function constraintKey(c: Constraint): string {
  const spec = CONSTRAINTS[c.type];
  const value = (field: string): Id => (c as unknown as Record<string, Id>)[field];
  const unordered = (spec.unordered ?? []).map(value).sort();
  const ordered = spec.operands.filter((operand) => !spec.unordered?.includes(operand.field)).map((operand) => value(operand.field));
  return JSON.stringify([c.type, ...unordered, ...ordered]);
}

// Řídicí vazba se stejným typem a operandy, která už ve skice je (kromě vazby `except`).
export function duplicateOf(sketch: SketchFeature, c: Constraint, except?: Id): Id | undefined {
  if (!isDriving(c)) return undefined;
  const key = constraintKey(c);
  return Object.keys(sketch.constraints).find((id) => id !== except && isDriving(sketch.constraints[id]) && constraintKey(sketch.constraints[id]) === key);
}
