// The registry of the kinds of entries of `external` of a sketch (D64, part 1) and what reads an
// entry through it: its validator, the rule of an update, the entities of a sketch, and the first
// stage of the sketch step. It sits above the leaf modules of the sketch (sketch-content.ts,
// sketch.ts) and below the feature modules, document.ts, the queries and the sketch tools, which
// are all the callers of `entityOf`.
import type { EntityKind } from '../catalog';
import { lookup } from '../recompute/services';
import { AXES_GEOMETRY, type Entity, constraintOperands } from '../sketch-content';
import type { ExternalRef, Id, IssueCode, SketchFeature } from '../types';
import { ORIGIN, has, isOriginAxis } from '../util';
import { type ValidationContext, fail, object } from '../validation';
import { edge } from './edge';
import { pattern } from './pattern';
import { projection } from './projection';
import { type AnyKind, type EntryKindName, type KindOf, type ReferenceContext, type ResolvedReference, type StoredValue, projected } from './spec';

export type { DerivedGeometry, EntryGeometry, GeometrySource, ReferenceContext, ResolvedReference, StoredValue } from './spec';

// One entry per member of `ExternalRef`, of the shape its name gives it (a reference kind when it
// has a value in `ReferenceValues`, else a derived kind): a member without an entry does not
// compile.
export const REFERENCE_KINDS: { readonly [T in EntryKindName]: KindOf<T> } = { edge, pattern, sketch: projection };

// The kind of an entry (one cast, as `specOf` of the registry of feature types has). It may be
// a reference or a derived kind: a caller that wants `compute` or `derive` asks `source` first.
export const kindOf = (ref: ExternalRef): AnyKind => REFERENCE_KINDS[ref.type] as unknown as AnyKind;

// The validator of an entry of `external`: reads `type` and hands the entry to its kind.
export function externalRef(context: ValidationContext, sketch: SketchFeature, id: Id, entry: unknown, what: string): ExternalRef {
  const o = object(entry, what);
  if (typeof o.type !== 'string' || !has(REFERENCE_KINDS, o.type)) return fail(`${what}: an entry of a sketch is the projection of an edge (\`edge\`), a mirror or pattern of the sketch (\`pattern\`) or the projection of an entity of an earlier sketch (\`sketch\`)`);
  return (REFERENCE_KINDS[o.type as EntryKindName] as unknown as AnyKind).validate(context, sketch, id, o, what);
}

// A stored value of `solved.external` by its form (the union of the values of the kinds), before it
// is matched with its entry.
export const storedValue = (v: unknown, what: string): StoredValue => projected(v, what);

// What an update of an entry may not do, or undefined: turn reference geometry into derived
// geometry or back (the source decides whether constraints may name its entities, D68), or change
// the kind of an entity that stays (the same ID), so the curve of an edge stays a line or a circle.
// (An entity a constraint names that goes is refused by the package that can reach it, 6f.)
export function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRef, after: ExternalRef): string | undefined {
  if (kindOf(before).source !== kindOf(after).source) return 'an entry of reference geometry cannot become derived geometry, or the other way; remove it and add the other';
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

// Every entity of every entry of a sketch with its kind and its entry, in the order of `external`
// and within an entry in the order of its kind (`byEntry`: the IDs of each entry). Built once per
// sketch object (the document is immutable, so a sketch object never changes): a pattern of 200
// slots has 2,000 entities, which the readers of the app would otherwise list for every ID (D68).
export interface EntityIndex {
  entities: ReadonlyMap<Id, { kind: EntityKind; entry: Id }>;
  byEntry: ReadonlyMap<Id, readonly Id[]>;
}
const entityIndexes = new WeakMap<SketchFeature, EntityIndex>();
export function entityIndex(sketch: SketchFeature): EntityIndex {
  let found = entityIndexes.get(sketch);
  if (!found) {
    const entities = new Map<Id, { kind: EntityKind; entry: Id }>();
    const byEntry = new Map<Id, Id[]>();
    for (const entry of Object.keys(sketch.external)) {
      const ids: Id[] = [];
      for (const [id, kind] of Object.entries(referenceEntities(sketch, entry))) {
        entities.set(id, { kind, entry });
        ids.push(id);
      }
      byEntry.set(entry, ids);
    }
    entityIndexes.set(sketch, (found = { entities, byEntry }));
  }
  return found;
}

// What an ID is in a sketch: `origin`, an axis of the origin (`origin/x`, `origin/y`: a line that is
// not own; their far points are no entities), an own point or curve, or an entity of an entry of
// `external` (the entry itself or `<entry>/<local>`), by the kind of the entry.
export function entityOf(sketch: SketchFeature, id: Id): Entity | undefined {
  if (id === ORIGIN) return { kind: 'point', own: false };
  if (isOriginAxis(id)) return { kind: 'line', own: false };
  if (has(sketch.points, id)) return { kind: 'point', own: true };
  if (has(sketch.curves, id)) return { kind: sketch.curves[id].type, own: true };
  const slash = id.indexOf('/');
  const owner = slash > 0 ? id.slice(0, slash) : id;
  if (!has(sketch.external, owner)) return undefined;
  const ref = sketch.external[owner];
  const kind = kindOf(ref);
  if (kind.source === 'derived') {
    // one look-up, not a listing: a derived entry may have thousands of entities
    const found = kind.entity(id, ref, sketch, owner);
    return found ? { kind: found, own: false, derived: true } : undefined;
  }
  const entities = referenceEntities(sketch, owner);
  return has(entities, id) ? { kind: entities[id], own: false } : undefined;
}

// The entry an entity of derived geometry belongs to and the ID of what it is a copy of, for the
// texts that refuse it (`<entry>/<copy>/<source>`, D68); undefined for any other ID.
export function derivedOrigin(sketch: SketchFeature, id: Id): { entry: Id; source: Id } | undefined {
  if (!entityOf(sketch, id)?.derived) return undefined;
  const entry = id.slice(0, id.indexOf('/'));
  const rest = id.slice(entry.length + 1);
  const slash = rest.indexOf('/');
  return { entry, source: slash < 0 ? rest : rest.slice(slash + 1) };
}

// The text of a copy named as an operand of a constraint of its own sketch.
export const copyInConstraint = (operand: Id, entry: Id, source: Id): string =>
  `"${operand}" is a copy of the mirror or pattern "${entry}": a copy cannot be constrained in its own sketch, it is computed after the sketch is solved; constrain its source "${source}", or project the copy in a later sketch`;

// ---------------------------------------------------------------- the sketch step

// Whether a constraint of the sketch names an axis of the origin (a reference dimension too: it is
// measured from the curves of the solver's input).
export const axesNamed = (feature: SketchFeature): boolean => Object.values(feature.constraints).some((c) => constraintOperands(c).some(isOriginAxis));

// The first stage of the step: every entry of reference geometry in the order of its ID, its value from `compute`, else
// the last valid one stored (through `value`), else none. `lost` names the entries whose value is
// not fresh, with the code of the warning and the detail `compute` gave, if any (D69). When a constraint names an axis of the origin, the axes
// come under the key `origin`, without a value: the solver gets them fixed, and the stamp of a
// sketch whose constraints name no axis stays what it was before the axes (D71).
export function resolveReferences(feature: SketchFeature, context: ReferenceContext): { resolved: Record<Id, ResolvedReference>; lost: [Id, IssueCode, string?][] } {
  const resolved: Record<Id, ResolvedReference> = axesNamed(feature) ? { [ORIGIN]: { geometry: AXES_GEOMETRY } } : {};
  const lost: [Id, IssueCode, string?][] = [];
  for (const id of Object.keys(feature.external).sort()) {
    const ref = feature.external[id];
    const kind = kindOf(ref);
    // derived geometry is made after the solver (references/derive.ts): nothing of it is resolved
    if (kind.source !== 'reference') continue;
    const computed = kind.compute(ref, context);
    const failure: { code: IssueCode; detail?: string } | undefined = typeof computed === 'string' ? { code: computed } : 'code' in computed ? computed : undefined;
    if (!failure) resolved[id] = { value: computed as StoredValue, geometry: kind.geometry(id, ref, computed as StoredValue) };
    else {
      // A reference that cannot be computed does not fail the sketch: it keeps its last valid value.
      const stored = lookup(feature.solved.external, id);
      const frozen = stored === undefined ? undefined : kind.value(stored, ref, `solved.external.${id}`);
      if (frozen) resolved[id] = { value: frozen, geometry: kind.geometry(id, ref, frozen) };
      lost.push(failure.detail === undefined ? [id, failure.code] : [id, failure.code, failure.detail]);
    }
  }
  return { resolved, lost };
}
