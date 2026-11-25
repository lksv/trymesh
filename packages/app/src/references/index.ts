// The entries of `external` of a sketch in the app (D64, part 5): a row of `REFERENCE_UI` per kind,
// typed by the union of the kinds, so a kind added to the engine does not compile in the app until
// it has its row; and what the pickers, the view and the panel read of an entry: its entities.
import { type EntityKind, type ExternalRef, type Id, type SketchFeature, entityIndex, kindOf } from '@trymesh/engine';
import { edge } from './edge';
import { pattern } from './pattern';
import type { ReferenceUi } from './spec';

export type { EntryControl, ReferenceUi } from './spec';

export const REFERENCE_UI: { readonly [T in ExternalRef['type']]: ReferenceUi<Extract<ExternalRef, { type: T }>> } = { edge, pattern };

// The row of an entry (one cast, as the registries of the engine have).
export const referenceUi = (ref: ExternalRef): ReferenceUi<ExternalRef> => REFERENCE_UI[ref.type] as ReferenceUi<ExternalRef>;

// The most entities of one derived entry a picker lists (D68): the rest are not offered (a known
// limit), but a value that names one is shown as what it is (`unlistedLabel`), and the picker says
// how many it left out (`omittedNotes`).
export const PICKER_LIMIT = 100;

// Every entity of every entry, in the order of `external` and within an entry in the order of its
// kind, with the entry it belongs to and the word of its kind for the pickers (`tag`); of a derived
// entry (a mirror or pattern) at most the first `PICKER_LIMIT`. All read the index of the engine,
// built once per sketch.
export function entryEntities(sketch: SketchFeature): { id: Id; kind: EntityKind; entry: Id; tag: string }[] {
  const index = entityIndex(sketch);
  return [...index.byEntry].flatMap(([entry, ids]) => {
    const ref = sketch.external[entry];
    const tag = referenceUi(ref).tag;
    const listed = kindOf(ref).source === 'derived' ? ids.slice(0, PICKER_LIMIT) : ids;
    return listed.map((id) => ({ id, kind: (index.entities.get(id) as { kind: EntityKind }).kind, entry, tag }));
  });
}

// The entry an entity belongs to, if it is an entity of an entry.
export const entryOf = (sketch: SketchFeature, id: Id): Id | undefined => entityIndex(sketch).entities.get(id)?.entry;

// The word the pickers add after an entity of an entry ("projected", "copy"), or undefined for an own one.
export function entryTag(sketch: SketchFeature, id: Id): string | undefined {
  const entry = entryOf(sketch, id);
  return entry === undefined ? undefined : referenceUi(sketch.external[entry]).tag;
}

// What the view marks for a hovered ID: for an entry its curves, or the entry itself when it has
// none (a projected point); anything else as it is.
export function hoverMarks(sketch: SketchFeature, id: Id): Id[] {
  if (!Object.prototype.hasOwnProperty.call(sketch.external, id)) return [id];
  const index = entityIndex(sketch);
  const curves = (index.byEntry.get(id) ?? []).filter((entity) => index.entities.get(entity)?.kind !== 'point');
  return curves.length > 0 ? curves : [id];
}

// What a picker of a sketch says of a value it does not list: an entity of an entry beyond the first
// `PICKER_LIMIT` of a mirror or pattern (D68) is there, tagged as the listed ones are; anything else
// is missing.
export function unlistedLabel(sketch: SketchFeature | undefined, id: Id): string {
  const tag = sketch ? entryTag(sketch, id) : undefined;
  return tag === undefined ? `${id} (missing)` : `${id} (${tag})`;
}
// Whether an ID is an entity of an entry of the sketch, listed by a picker or not.
export const entryHas = (sketch: SketchFeature, id: Id): boolean => entryOf(sketch, id) !== undefined;

// The notes a picker adds (as disabled options) for the entities of the kinds it lists that it left
// out of each derived entry: "… 1880 more copies of p1".
export function omittedNotes(sketch: SketchFeature, kind: (kind: EntityKind) => boolean): string[] {
  const index = entityIndex(sketch);
  return [...index.byEntry].flatMap(([entry, ids]) => {
    if (kindOf(sketch.external[entry]).source !== 'derived' || ids.length <= PICKER_LIMIT) return [];
    const left = ids.slice(PICKER_LIMIT).filter((id) => kind((index.entities.get(id) as { kind: EntityKind }).kind)).length;
    return left > 0 ? [`… ${left} more ${left === 1 ? 'copy' : 'copies'} of ${entry}, not listed`] : [];
  });
}
