// The registry of the kinds of entries of `external` of a sketch (D64, part 1) and what reads an
// entry through it: its validator, the rule of an update, the entities of a sketch, and the first
// stage of the sketch step. It sits above the leaf modules of the sketch (sketch-content.ts,
// sketch.ts) and below the feature modules, document.ts, the queries and the sketch tools, which
// are all the callers of `entityOf`.
import type { EntityKind } from '../catalog';
import { lookup } from '../recompute/services';
import type { Entity } from '../sketch-content';
import type { ExternalRef, Id, IssueCode, SketchFeature } from '../types';
import { ORIGIN, has } from '../util';
import { type ValidationContext, fail, object } from '../validation';
import { edge, projected } from './edge';
import type { ReferenceContext, ReferenceKindName, ReferenceKindSpec, ReferenceOf, ReferenceValues, ResolvedReference, StoredValue } from './spec';

export type { EntryGeometry, GeometrySource, ReferenceContext, ResolvedReference, StoredValue } from './spec';

// One entry per member of `ExternalRef`: a member without an entry does not compile.
export const REFERENCE_KINDS: { readonly [T in ReferenceKindName]: ReferenceKindSpec<ReferenceOf<T>, ReferenceValues[T]> } = { edge };

// The kind of an entry (one cast, as `specOf` of the registry of feature types has).
export const kindOf = (ref: ExternalRef): ReferenceKindSpec<ExternalRef, StoredValue> => REFERENCE_KINDS[ref.type] as unknown as ReferenceKindSpec<ExternalRef, StoredValue>;

// The validator of an entry of `external`: reads `type` and hands the entry to its kind. The text
// for an unknown type names the edge while it is the one kind.
export function externalRef(context: ValidationContext, sketch: SketchFeature, id: Id, entry: unknown, what: string): ExternalRef {
  const o = object(entry, what);
  if (typeof o.type !== 'string' || !has(REFERENCE_KINDS, o.type)) return fail(`${what}: promítnout jde jen hranu`);
  return REFERENCE_KINDS[o.type as ReferenceKindName].validate(context, sketch, id, o, what);
}

// A stored value of `solved.external` by its form (the union of the values of the kinds), before it
// is matched with its entry.
export const storedValue = (v: unknown, what: string): StoredValue => projected(v, what);

// What an update of an entry may not do, or undefined. 6a has the rule of today: an entity that
// stays (the same ID) keeps its kind, so the curve of an edge stays a line or a circle. (A change
// of source and an entity a constraint names that goes are refused by the packages that can reach
// them, 6c and 6f, design.md of 6a, part 1.)
export function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRef, after: ExternalRef): string | undefined {
  const [was, will] = [kindOf(before).entities(id, before, sketch), kindOf(after).entities(id, after, sketch)];
  if (Object.keys(will).some((entity) => has(was, entity) && was[entity] !== will[entity])) return 'druh promítnutí změnit nejde';
  return undefined;
}

// ---------------------------------------------------------------- entities

// Every entity of one entry, in the order of its kind (an edge: the curve, then `a` and `b`, or the
// curve and `center`).
export function referenceEntities(sketch: SketchFeature, id: Id): Record<Id, EntityKind> {
  const ref = sketch.external[id];
  return kindOf(ref).entities(id, ref, sketch);
}

// What an ID is in a sketch: `origin`, an own point or curve, or an entity of an entry of
// `external` (the entry itself or `<entry>/<local>`), by the kind of the entry.
export function entityOf(sketch: SketchFeature, id: Id): Entity | undefined {
  if (id === ORIGIN) return { kind: 'point', own: false };
  if (has(sketch.points, id)) return { kind: 'point', own: true };
  if (has(sketch.curves, id)) return { kind: sketch.curves[id].type, own: true };
  const slash = id.indexOf('/');
  const owner = slash > 0 ? id.slice(0, slash) : id;
  if (!has(sketch.external, owner)) return undefined;
  const entities = referenceEntities(sketch, owner);
  return has(entities, id) ? { kind: entities[id], own: false } : undefined;
}

// ---------------------------------------------------------------- the sketch step

// The first stage of the step: every entry in the order of its ID, its value from `compute`, else
// the last valid one stored (through `value`), else none. `lost` names the entries whose value is
// not fresh, with the code of the warning.
export function resolveReferences(feature: SketchFeature, context: ReferenceContext): { resolved: Record<Id, ResolvedReference>; lost: [Id, IssueCode][] } {
  const resolved: Record<Id, ResolvedReference> = {};
  const lost: [Id, IssueCode][] = [];
  for (const id of Object.keys(feature.external).sort()) {
    const ref = feature.external[id];
    const kind = kindOf(ref);
    const computed = kind.compute(ref, context);
    if (typeof computed !== 'string') resolved[id] = { value: computed, geometry: kind.geometry(id, ref, computed) };
    else {
      // A reference that cannot be computed does not fail the sketch: it keeps its last valid value.
      const stored = lookup(feature.solved.external, id);
      const frozen = stored === undefined ? undefined : kind.value(stored, ref, `solved.external.${id}`);
      if (frozen) resolved[id] = { value: frozen, geometry: kind.geometry(id, ref, frozen) };
      lost.push([id, computed]);
    }
  }
  return { resolved, lost };
}
