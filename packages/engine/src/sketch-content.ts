// What the content of a sketch is, without validation: its entities, the operands and the keys of
// its constraints, the IDs of a document. A leaf of the engine: it imports only the types, the
// catalog and the utilities, so the sketch solver setup, the diagnosis and the feature modules can
// all read it below the registry of feature types.
import { CONSTRAINTS, type EntityKind } from './catalog';
import type { Constraint, Curve, Dimension, Document, ExternalRef, FieldPath, Id, PlaneRef, SketchFeature } from './types';
import { ORIGIN, has } from './util';

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

// Odvozené entity promítnuté geometrie plynou z `kind`: `<id>`, `<id>/a`, `<id>/b` u úsečky,
// `<id>`, `<id>/center` u kružnice.
export function derivedPoints(id: Id, ref: ExternalRef): Id[] {
  return ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`];
}

export function entityOf(sketch: SketchFeature, id: Id): Entity | undefined {
  if (id === ORIGIN) return { kind: 'point', own: false };
  if (has(sketch.points, id)) return { kind: 'point', own: true };
  if (has(sketch.curves, id)) return { kind: sketch.curves[id].type, own: true };
  if (has(sketch.external, id)) return { kind: sketch.external[id].kind, own: false };
  const slash = id.indexOf('/');
  if (slash > 0) {
    const parent = id.slice(0, slash);
    if (has(sketch.external, parent) && derivedPoints(parent, sketch.external[parent]).includes(id)) return { kind: 'point', own: false };
  }
  return undefined;
}

export function curvePoints(curve: Curve): Id[] {
  if (curve.type === 'line') return [curve.a, curve.b];
  if (curve.type === 'circle') return [curve.center];
  return [curve.center, curve.start, curve.end];
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
