// The registry of the kinds of entries of `external` of a sketch (D64, part 1) and what reads an
// entry through it: its validator, the rule of an update, the entities of a sketch, and the first
// stage of the sketch step. It sits above the leaf modules of the sketch (sketch-content.ts,
// sketch.ts) and below the feature modules, document.ts, the queries and the sketch tools, which
// are all the callers of `entityOf`.
import type { EntityKind } from '../catalog';
import { lookup } from '../recompute/services';
import { AXES_GEOMETRY, type Entity, constraintOperands, curvePoints } from '../sketch-content';
import type { Curve, ExternalRef, Id, IssueCode, SketchFeature } from '../types';
import { ORIGIN, has, isOriginAxis } from '../util';
import { type ValidationContext, fail, object } from '../validation';
import { edge } from './edge';
import { outline, placedOutline } from './outline';
import { pattern } from './pattern';
import { projection } from './projection';
import { type AnyKind, type EntryGeometry, type EntryKindName, type KindOf, type ReferenceContext, type ResolvedReference, type StoredValue, projected } from './spec';

export type { DerivedGeometry, EntryGeometry, GeometrySource, ReferenceContext, ResolvedReference, StoredValue } from './spec';

// One entry per member of `ExternalRef`, of the shape its name gives it (a reference kind when it
// has a value in `ReferenceValues`, else a derived kind): a member without an entry does not
// compile.
export const REFERENCE_KINDS: { readonly [T in EntryKindName]: KindOf<T> } = { edge, pattern, sketch: projection, outline };

// The kind of an entry (one cast, as `specOf` of the registry of feature types has). It may be
// a reference or a derived kind: a caller that wants `compute` or `derive` asks `source` first.
export const kindOf = (ref: ExternalRef): AnyKind => REFERENCE_KINDS[ref.type] as unknown as AnyKind;

// The validator of an entry of `external`: reads `type` and hands the entry to its kind.
export function externalRef(context: ValidationContext, sketch: SketchFeature, id: Id, entry: unknown, what: string): ExternalRef {
  const o = object(entry, what);
  if (typeof o.type !== 'string' || !has(REFERENCE_KINDS, o.type)) return fail(`${what}: an entry of a sketch is the projection of an edge (\`edge\`), a mirror or pattern of the sketch (\`pattern\`), the projection of an entity of an earlier sketch (\`sketch\`) or an imported outline (\`outline\`)`);
  return (REFERENCE_KINDS[o.type as EntryKindName] as unknown as AnyKind).validate(context, sketch, id, o, what);
}

// A stored value of `solved.external` by its form (the union of the values of the kinds: positions,
// or the placement of an outline, D72), before it is matched with its entry.
export function storedValue(v: unknown, what: string): StoredValue {
  const o = object(v, what);
  return o.kind === 'outline' ? placedOutline(o, what) : projected(v, what);
}

// The refusals of the rule of an update (D72): an entity a constraint of the sketch names goes, or
// changes its kind.
export const ENTITY_TAKEN = (entry: Id, gone: { entity: Id; constraints: Id[] }[]): string =>
  `the update takes away ${gone.map((g) => `"${g.entity}" (named by ${g.constraints.join(', ')})`).join(', ')} of "${entry}": remove ${gone.length === 1 && gone[0].constraints.length === 1 ? 'that constraint' : 'those constraints'} in the same batch before it (the tool import_outline: \`remove\`), or keep the ${gone.length === 1 ? 'curve' : 'curves'}`;
const article = (kind: string): string => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
export const ENTITY_KIND_CHANGED = (entity: Id, was: EntityKind, will: EntityKind, constraints: Id[]): string =>
  `the update makes "${entity}" ${article(will)} where it was ${article(was)}, and ${constraints.join(', ')} ${constraints.length === 1 ? 'names' : 'name'} it: remove ${constraints.length === 1 ? 'that constraint' : 'those constraints'} in the same batch before it`;

// What one ID under an entry is, by its kind: one look-up when the kind answers `entity`, else from
// the listing of its entities.
function entryEntity(sketch: SketchFeature, id: Id, ref: ExternalRef, entity: Id): EntityKind | undefined {
  const kind = kindOf(ref);
  if (kind.entity) return kind.entity(entity, ref, sketch, id);
  const all = kind.entities(id, ref, sketch);
  return has(all, entity) ? all[entity] : undefined;
}
const answersEntity = (ref: ExternalRef): boolean => {
  const kind = kindOf(ref);
  return kind.source === 'reference' && kind.entity !== undefined;
};

// What an update of an entry may not do, or undefined:
// 1. turn reference geometry into derived geometry or back (the source decides whether constraints
//    may name its entities, D68);
// 2. change the kind of an entity that stays (the same ID), so the curve of an edge stays a line or
//    a circle;
// 3. take away an entity a constraint of the sketch names: the document it leaves would not load
//    (D72).
// When the kind of either entry answers `entity` (an outline, D72), parts 2 and 3 are one pass over
// the operands of the constraints of the sketch (driving and reference) that are the entry's ID or
// under it, with no listing of either entry: an entity no constraint names may go, come or change
// its kind. The other kinds keep part 2 by their listings, and part 3 by the operands.
export function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRef, after: ExternalRef): string | undefined {
  if (kindOf(before).source !== kindOf(after).source) return 'an entry of reference geometry cannot become derived geometry, or the other way; remove it and add the other';
  const byOperand = answersEntity(before) || answersEntity(after);
  if (!byOperand) {
    const [was, will] = [kindOf(before).entities(id, before, sketch), kindOf(after).entities(id, after, sketch)];
    if (Object.keys(will).some((entity) => has(was, entity) && was[entity] !== will[entity])) return 'druh promítnutí změnit nejde';
  }
  const gone = new Map<Id, Id[]>();
  const changed = new Map<Id, { was: EntityKind; will: EntityKind; constraints: Id[] }>();
  for (const [constraint, c] of Object.entries(sketch.constraints)) {
    for (const operand of new Set(constraintOperands(c))) {
      if (operand !== id && !operand.startsWith(`${id}/`)) continue;
      const was = entryEntity(sketch, id, before, operand);
      if (was === undefined) continue;
      const will = entryEntity(sketch, id, after, operand);
      if (will === undefined) gone.set(operand, [...(gone.get(operand) ?? []), constraint]);
      else if (will !== was && byOperand) {
        const found = changed.get(operand);
        if (found) found.constraints.push(constraint);
        else changed.set(operand, { was, will, constraints: [constraint] });
      }
    }
  }
  if (gone.size > 0) return ENTITY_TAKEN(id, [...gone].map(([entity, constraints]) => ({ entity, constraints })));
  const [first] = changed;
  if (first) return ENTITY_KIND_CHANGED(first[0], first[1].was, first[1].will, first[1].constraints);
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
  if (kind.entity) {
    // the same for an imported outline (D72): 2000 curves are 5000 entities
    const found = kind.entity(id, ref, sketch, owner);
    return found ? { kind: found, own: false } : undefined;
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
  let named: Set<Id> | undefined;
  // of a kind with `narrow` (an outline, D72) the solver gets what the constraints name
  const narrow = (id: Id, reference: ResolvedReference): ResolvedReference => {
    const kind = kindOf(feature.external[id]);
    if (kind.source !== 'reference' || !kind.narrow) return reference;
    named ??= new Set(Object.values(feature.constraints).flatMap(constraintOperands));
    return { ...reference, solver: narrowed(reference.geometry, named) };
  };
  for (const id of Object.keys(feature.external).sort()) {
    const ref = feature.external[id];
    const kind = kindOf(ref);
    // derived geometry is made after the solver (references/derive.ts): nothing of it is resolved
    if (kind.source !== 'reference') continue;
    const computed = kind.compute(ref, context);
    const failure: { code: IssueCode; detail?: string } | undefined = typeof computed === 'string' ? { code: computed } : 'code' in computed ? computed : undefined;
    if (!failure) resolved[id] = narrow(id, { value: computed as StoredValue, geometry: kind.geometry(id, ref, computed as StoredValue) });
    else {
      // A reference that cannot be computed does not fail the sketch: it keeps its last valid value.
      const stored = lookup(feature.solved.external, id);
      const frozen = stored === undefined ? undefined : kind.value(stored, ref, `solved.external.${id}`);
      if (frozen) resolved[id] = narrow(id, { value: frozen, geometry: kind.geometry(id, ref, frozen) });
      lost.push(failure.detail === undefined ? [id, failure.code] : [id, failure.code, failure.detail]);
    }
  }
  return { resolved, lost };
}

// The part of the geometry of an entry that the operands of the constraints name (D72): a named
// curve with its points and its radius, a named point alone; `regions` and `hidden` empty. The
// points and the curves in the order of the geometry.
export function narrowed(geometry: EntryGeometry, named: ReadonlySet<Id>): EntryGeometry {
  const want = new Set<Id>();
  const curves: EntryGeometry['curves'] = {};
  const radii: EntryGeometry['radii'] = {};
  for (const [id, shape] of Object.entries(geometry.curves)) {
    if (!named.has(id)) continue;
    curves[id] = shape;
    for (const point of curvePoints(shape as Curve)) want.add(point);
    if (has(geometry.radii, id)) radii[id] = geometry.radii[id];
  }
  const points: EntryGeometry['points'] = {};
  for (const [id, at] of Object.entries(geometry.points)) if (want.has(id) || named.has(id)) points[id] = at;
  return { points, curves, radii, regions: [] };
}
