// The registry of feature types and what reads it. A new feature type is a module in this directory
// and one line here; the compiler guards that an entry is complete, the step of the recompute
// included. Validation of references, the order on the timeline, `updateFeature`, the recompute and
// the description of the API for the AI all read the registry.
import { bodyOwner, entityOf } from '../sketch-content';
import type { Document, Feature, Id, InsertFeature } from '../types';
import { ORIGIN, has } from '../util';
import { type FeatureRef, REF_LABEL, type RefContext, fail } from '../validation';
import { chamfer } from './chamfer';
import { combine } from './combine';
import { extrude } from './extrude';
import { fillet } from './fillet';
import { hole } from './hole';
import { insert } from './insert';
import { mesh } from './mesh';
import type { FeatureModule, FeatureTypeInfo } from './module';
import { pattern } from './pattern';
import { plane } from './plane';
import { revolve } from './revolve';
import { sketch } from './sketch';
import { split } from './split';

export const FEATURE_TYPES: { [K in Feature['type']]: FeatureModule<Extract<Feature, { type: K }>> } = { plane, sketch, extrude, pattern, hole, mesh, combine, split, revolve, chamfer, fillet, insert };

// The public part of the registry.
export const FEATURE_TYPE_INFO: Record<Feature['type'], FeatureTypeInfo> = Object.fromEntries(
  Object.entries(FEATURE_TYPES).map(([type, spec]) => [type, { ...spec.info, updatable: (spec as FeatureModule<Feature>).patch?.fields ?? [] }]),
) as Record<Feature['type'], FeatureTypeInfo>;

// The module of a feature. Indexing the registry by `feature.type` loses the tie between the entry
// and the feature, so the cast is written here, once.
export const specOf = (f: Feature): FeatureModule<Feature> => FEATURE_TYPES[f.type] as FeatureModule<Feature>;

// The bodies a feature names (its targets, its tools, the body it splits), by body ID.
export const bodyRefs = (f: Feature): Id[] => [...new Set(specOf(f).refs(f).filter((ref) => ref.kind === 'body').map((ref) => ref.id))];
// Can a pattern repeat the feature (does it leave a tool recipe)?
export const producesTool = (f: Feature): boolean => specOf(f).producesTool(f);
// The generator of the profile of the feature, when it has a profile that comes from one.
export const generatorOf = (f: Feature): string | undefined => specOf(f).generator?.(f);

// Why no feature of the document can create the body (D48): the feature is not there, or its type
// does not create a body of that ID. The order on the timeline is not asked: a section of the
// document has no place on it. Undefined when a feature can.
export function bodyProblem(doc: Document, body: Id): string | undefined {
  const { feature, local } = bodyOwner(body);
  const f = doc.features.find((candidate) => candidate.id === feature);
  if (!f) return `no feature of the document creates the body "${body}": the feature "${feature}" is not in the document`;
  if (!specOf(f).createsBody(f, local)) return `the feature "${feature}" does not create a body "${body}" (a body is made by an extrusion with the operation new by a mesh feature and by a split, under its ID, by a pattern of a body, as "<pattern>/<number>" from 1, a mirror only "<pattern>/1", and by an insertion as "<insertion>/<body of the inserted document>")`;
  return f.type === 'insert' ? insertedBodyProblem(doc, f, local as Id) : undefined;
}

// Why the stored document of an insertion has no feature that can create the body `local` there
// (D62): `setBodyProperties { body: 'b1/typo' }` is refused as for any feature. Whether the body is
// there in a recompute is the recompute's question.
function insertedBodyProblem(doc: Document, f: InsertFeature, local: Id): string | undefined {
  const stored = has(doc.documents, f.document) ? doc.documents[f.document] : undefined;
  if (!stored) return `the insertion "${f.id}" inserts the stored document "${f.document}", which the document does not have`;
  const problem = bodyProblem(stored.document, local);
  return problem === undefined ? undefined : `the stored document "${f.document}" of the insertion "${f.id}" cannot make the body "${local}": ${problem}`;
}

// A feature of the document, or of a document it inserts, by its ID as this document names it
// (`b1/ring`, `kit/b/ring`; D62), with the document it is in. Undefined when the feature, an
// insertion on the way or its stored document is not there.
export function insertedFeature(doc: Document, id: Id): { feature: Feature; document: Document } | undefined {
  const slash = id.indexOf('/');
  const own = (key: Id): Feature | undefined => doc.features.find((f) => f.id === key);
  if (slash < 0) {
    const feature = own(id);
    return feature ? { feature, document: doc } : undefined;
  }
  const insertion = own(id.slice(0, slash));
  if (insertion?.type !== 'insert' || !has(doc.documents, insertion.document)) return undefined;
  return insertedFeature(doc.documents[insertion.document].document, id.slice(slash + 1));
}

// Every feature of the document and of the documents it inserts, in the order of the timeline, the
// features of an inserted document at the place of its insertion, each with its ID as this document
// names it (D62). An insertion of a document the section does not have adds nothing.
export function featuresWithInserted(doc: Document, prefix = ''): { id: Id; feature: Feature; document: Document }[] {
  return doc.features.flatMap((feature) => [
    { id: `${prefix}${feature.id}`, feature, document: doc },
    ...(feature.type === 'insert' && has(doc.documents, feature.document) ? featuresWithInserted(doc.documents[feature.document].document, `${prefix}${feature.id}/`) : []),
  ]);
}

// The body a body was copied from (D48), by the registry: undefined when its feature is not in the
// document, does not create it, or copies it from none.
export function bodySource(doc: Document, body: Id): Id | undefined {
  const { feature, local } = bodyOwner(body);
  const f = doc.features.find((candidate) => candidate.id === feature);
  if (!f) return undefined;
  const spec = specOf(f);
  return spec.createsBody(f, local) ? spec.bodySource?.(f, local) : undefined;
}

// The chain of sources of a body over `bodySource`, the body first and nearest first. It stops at
// a body it has seen (a document edited by hand may hold a cycle). Its bodies need not be bodies
// of a state.
export function sourceChain(doc: Document, body: Id): Id[] {
  const chain: Id[] = [body];
  for (let source = bodySource(doc, body); source !== undefined && !chain.includes(source); source = bodySource(doc, source)) chain.push(source);
  return chain;
}
// The body the chain of sources of a body starts at (D57); the body itself when it has no source.
export const sourceRoot = (doc: Document, body: Id): Id => sourceChain(doc, body).at(-1) ?? body;

// Kde odkaz nastavuje příkaz (`before` je index odkazující feature), musí cíl existovat, mít
// správný druh a ležet před ní. Při načítání dokumentu (`before` není) se ověřuje jen tvar:
// odkaz na feature, která v dokumentu není, vzniká povoleným smazáním.
export function requireRef(doc: Document, before: number | undefined, ref: Omit<FeatureRef, 'path'>, what: string): void {
  if (before === undefined) return;
  // a stored mesh (D55) is no feature: the section has it or not, and it has no place on the timeline
  if (ref.kind === 'mesh') {
    if (!has(doc.meshes, ref.id)) fail(`${what}: the document has no stored mesh "${ref.id}" (the section meshes; the tool import_mesh stores one)`);
    return;
  }
  // a stored document (D62), as a stored mesh
  if (ref.kind === 'document') {
    if (!has(doc.documents, ref.id)) fail(`${what}: the document has no stored document "${ref.id}" (the section documents; the tool insert_document stores one)`);
    return;
  }
  // a parameter of a stored document (D62): a value an insertion sets
  if (ref.kind === 'parameter') {
    const stored = ref.document !== undefined && has(doc.documents, ref.document) ? doc.documents[ref.document] : undefined;
    if (!stored) return fail(`${what}: the document has no stored document "${String(ref.document)}"`);
    if (!stored.document.parameters.some((p) => p.name === ref.id)) fail(`${what}: the stored document "${ref.document}" has no parameter "${ref.id}"; its parameters are ${stored.document.parameters.map((p) => p.name).join(', ') || 'none'}`);
    return;
  }
  // a body of a stored document (D62) that an insertion lists: one a feature there can make, as
  // `setBodyProperties` of the inserted body asks
  if (ref.kind === 'documentBody') {
    const stored = ref.document !== undefined && has(doc.documents, ref.document) ? doc.documents[ref.document] : undefined;
    if (!stored) return fail(`${what}: the document has no stored document "${String(ref.document)}"`);
    const problem = bodyProblem(stored.document, ref.id);
    if (problem !== undefined) fail(`${what}: the stored document "${ref.document}" cannot make the body "${ref.id}": ${problem}`);
    return;
  }
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
    if (!spec.producesTool(target)) fail(`${what}: feature "${ref.id}" is not a feature that applies a tool (an extrusion or a revolve with the operation add or cut, a hole)`);
  } else {
    const accepted =
      ref.kind === 'body'
        ? spec.createsBody(target, local)
        : ref.kind === 'faceSource'
          ? spec.namesFaces
          : ref.kind === 'pattern'
            ? (spec.tagsFaces?.(target) ?? false)
            : ref.kind === 'insertion'
              ? target.type === 'insert'
              : target.type === ref.kind;
    if (!accepted) fail(`${what}: feature "${ref.id}" není ${REF_LABEL[ref.kind]}`);
    // a body of an insertion: the stored document can make it there (D62)
    const inner = ref.kind === 'body' && target.type === 'insert' ? insertedBodyProblem(doc, target, local as Id) : undefined;
    if (inner) fail(`${what}: ${inner}`);
  }
  if (index >= before) fail(`${what}: feature "${ref.id}" musí ležet před odkazující feature`);
}

// The context of a validator or of a command that checks a reference: `requireRef` bound to the
// document and to the place of the referring feature.
export const refContext = (doc: Document, before: number | undefined): RefContext => ({ doc, before, requireRef: (ref, what) => requireRef(doc, before, ref, what) });
