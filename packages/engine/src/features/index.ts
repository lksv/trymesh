// The registry of feature types and what reads it. A new feature type is a module in this directory
// and one line here; the compiler guards that an entry is complete, the step of the recompute
// included. Validation of references, the order on the timeline, `updateFeature`, the recompute and
// the description of the API for the AI all read the registry.
import { bodyOwner, entityOf } from '../sketch-content';
import type { Document, Feature } from '../types';
import { ORIGIN } from '../util';
import { type FeatureRef, REF_LABEL, type RefContext, fail } from '../validation';
import { extrude } from './extrude';
import { hole } from './hole';
import type { FeatureModule, FeatureTypeInfo } from './module';
import { pattern } from './pattern';
import { plane } from './plane';
import { sketch } from './sketch';

export const FEATURE_TYPES: { [K in Feature['type']]: FeatureModule<Extract<Feature, { type: K }>> } = { plane, sketch, extrude, pattern, hole };

// The public part of the registry.
export const FEATURE_TYPE_INFO: Record<Feature['type'], FeatureTypeInfo> = Object.fromEntries(
  Object.entries(FEATURE_TYPES).map(([type, spec]) => [type, { ...spec.info, updatable: (spec as FeatureModule<Feature>).patch?.fields ?? [] }]),
) as Record<Feature['type'], FeatureTypeInfo>;

// The module of a feature. Indexing the registry by `feature.type` loses the tie between the entry
// and the feature, so the cast is written here, once.
export const specOf = (f: Feature): FeatureModule<Feature> => FEATURE_TYPES[f.type] as FeatureModule<Feature>;

// Can a pattern repeat the feature (does it leave a tool recipe)?
export const producesTool = (f: Feature): boolean => specOf(f).producesTool(f);
// The generator of the profile of the feature, when it has a profile that comes from one.
export const generatorOf = (f: Feature): string | undefined => specOf(f).generator?.(f);

// Kde odkaz nastavuje příkaz (`before` je index odkazující feature), musí cíl existovat, mít
// správný druh a ležet před ní. Při načítání dokumentu (`before` není) se ověřuje jen tvar:
// odkaz na feature, která v dokumentu není, vzniká povoleným smazáním.
export function requireRef(doc: Document, before: number | undefined, ref: Omit<FeatureRef, 'path'>, what: string): void {
  if (before === undefined) return;
  if (ref.kind === 'entity') {
    // The sketch itself is verified by its own reference; here only the entity inside it.
    const sketch = doc.features.find((f) => f.id === ref.sketch);
    if (!sketch || sketch.type !== 'sketch') return fail(`${what}: the sketch "${String(ref.sketch)}" of the entity "${ref.id}" does not exist`);
    const entity = entityOf(sketch, ref.id);
    if (!entity) return fail(`${what}: the sketch "${sketch.id}" has no entity "${ref.id}"`);
    if (!ref.accepts?.includes(entity.kind)) fail(`${what}: "${ref.id}" is a ${entity.kind}, expected ${(ref.accepts ?? []).join(' or ')}`);
    if (ref.notProjected && !entity.own && ref.id !== ORIGIN) fail(`${what}: "${ref.id}" is projected geometry; an own ${(ref.accepts ?? []).join(' or ')} of the sketch "${sketch.id}" is expected`);
    return;
  }
  const { feature, local } = ref.kind === 'body' ? bodyOwner(ref.id) : { feature: ref.id, local: undefined };
  const index = doc.features.findIndex((f) => f.id === feature);
  if (index < 0) fail(`${what}: feature "${ref.id}" neexistuje`);
  const target = doc.features[index];
  const spec = specOf(target);
  if (ref.kind === 'generated') {
    const generator = spec.generator?.(target);
    if (generator === undefined || !ref.accepts?.includes(generator)) fail(`${what}: feature "${ref.id}" is not an extrusion with a profile from the generator ${(ref.accepts ?? []).join(' or ')}`);
  } else if (ref.kind === 'tool') {
    if (!spec.producesTool(target)) fail(`${what}: feature "${ref.id}" is not a feature that applies a tool (an extrusion with the operation add or cut, a hole)`);
  } else {
    const accepted = ref.kind === 'body' ? spec.createsBody(target, local) : ref.kind === 'faceSource' ? spec.namesFaces : target.type === ref.kind;
    if (!accepted) fail(`${what}: feature "${ref.id}" není ${REF_LABEL[ref.kind]}`);
  }
  if (index >= before) fail(`${what}: feature "${ref.id}" musí ležet před odkazující feature`);
}

// The context of a validator or of a command that checks a reference: `requireRef` bound to the
// document and to the place of the referring feature.
export const refContext = (doc: Document, before: number | undefined): RefContext => ({ doc, before, requireRef: (ref, what) => requireRef(doc, before, ref, what) });
