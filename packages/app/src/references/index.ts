// The entries of `external` of a sketch in the app (D64, part 5): a row of `REFERENCE_UI` per kind,
// typed by the union of the kinds, so a kind added to the engine does not compile in the app until
// it has its row; and what the pickers, the view and the panel read of an entry: its entities.
import { type EntityKind, type ExternalRef, type Id, type SketchFeature, referenceEntities } from '@trymesh/engine';
import { edge } from './edge';
import type { ReferenceUi } from './spec';

export type { ReferenceUi } from './spec';

export const REFERENCE_UI: { readonly [T in ExternalRef['type']]: ReferenceUi<Extract<ExternalRef, { type: T }>> } = { edge };

// The row of an entry (one cast, as the registries of the engine have).
export const referenceUi = (ref: ExternalRef): ReferenceUi<ExternalRef> => REFERENCE_UI[ref.type] as ReferenceUi<ExternalRef>;

// Every entity of every entry, in the order of `external` and within an entry in the order of its
// kind, with the entry it belongs to and the word of its kind for the pickers (`tag`).
export function entryEntities(sketch: SketchFeature): { id: Id; kind: EntityKind; entry: Id; tag: string }[] {
  return Object.keys(sketch.external).flatMap((entry) => {
    const tag = referenceUi(sketch.external[entry]).tag;
    return Object.entries(referenceEntities(sketch, entry)).map(([id, kind]) => ({ id, kind, entry, tag }));
  });
}

// The entry an entity belongs to, if it is an entity of an entry.
export function entryOf(sketch: SketchFeature, id: Id): Id | undefined {
  const slash = id.indexOf('/');
  const owner = slash > 0 ? id.slice(0, slash) : id;
  return Object.prototype.hasOwnProperty.call(sketch.external, owner) && Object.prototype.hasOwnProperty.call(referenceEntities(sketch, owner), id) ? owner : undefined;
}

// The word the pickers add after an entity of an entry ("projected"), or undefined for an own one.
export function entryTag(sketch: SketchFeature, id: Id): string | undefined {
  const entry = entryOf(sketch, id);
  return entry === undefined ? undefined : referenceUi(sketch.external[entry]).tag;
}

// What the view marks for a hovered ID: for an entry its curves, or the entry itself when it has
// none (a projected point); anything else as it is.
export function hoverMarks(sketch: SketchFeature, id: Id): Id[] {
  if (!Object.prototype.hasOwnProperty.call(sketch.external, id)) return [id];
  const curves = Object.entries(referenceEntities(sketch, id)).filter(([, kind]) => kind !== 'point').map(([curve]) => curve);
  return curves.length > 0 ? curves : [id];
}
