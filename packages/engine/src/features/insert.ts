// The insertion (D62): a stored document of the section `documents` recomputed from its features with
// the values this feature gives some of its parameters, its bodies placed as one rigid piece with
// every face under its name, the feature IDs prefixed. The step reads the entry of the section
// through `input` and reaches the recompute of the stored document through its context.
import type { FieldSpec, NumberSpec } from '../catalog';
import { evaluateParameters, parameterNameProblem } from '../expression';
import { environmentText, insertedFaceName, losslessNumber, placedSolid } from '../recompute/insertion';
import { frameOf, placementTransform } from '../recompute/placement';
import { issue } from '../recompute/services';
import { movedThread } from '../recompute/thread';
import type { InsertedBody, InsertionRecord, Step, StepContext } from '../recompute/state';
import { bodyOwner } from '../sketch-content';
import { transformFace } from '../solid';
import type { Document, FaceName, Id, InsertFeature, Issue, Solid, StoredDocument } from '../types';
import { faceKey, has } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, base, fail, frameRefs, isObject, newId, object, string } from '../validation';
import { PLACEMENT_FIELDS, bodyPlacement, placementFacts, removablePlacementField } from './mesh';
import type { FeatureModule } from './module';

const PARAMETER_VALUE: NumberSpec = { title: 'Value of a parameter of the inserted document', unit: 'none' };
// The placement of 3b and one field per parameter set: the address with `*` in place of the name,
// as the catalog writes a field under a name.
export const INSERT_FIELDS: readonly FieldSpec[] = [...PLACEMENT_FIELDS, { path: 'parameters/*', spec: PARAMETER_VALUE }];

// The form of a body ID of the inserted document: its feature part could be an ID, its local part
// is not empty.
function bodyId(v: unknown, what: string): Id {
  const id = string(v, what);
  const { feature, local } = bodyOwner(id);
  newId(feature, what);
  if (local === '') fail(`${what}: "${id}" is not a body ID`);
  return id;
}

function insertFeature(o: Dict, what: string, context: ValidationContext): InsertFeature {
  const document = string(o.document, `${what}.document`);
  if (document === '') fail(`${what}.document: the ID of a stored document is expected`);
  context.requireRef({ id: document, kind: 'document' }, `${what}.document`);
  const placement = bodyPlacement(o.placement, `${what}.placement`, context);
  let parameters: Record<string, number> | undefined;
  if (o.parameters !== undefined) {
    const given = object(o.parameters, `${what}.parameters`);
    parameters = {};
    for (const name of Object.keys(given).sort()) {
      const problem = parameterNameProblem(name);
      if (problem) fail(`${what}.parameters.${name}: ${problem}`);
      context.requireRef({ id: name, kind: 'parameter', document }, `${what}.parameters.${name}`);
      parameters[name] = context.fields.number(given[name], `parameters/${name}`, PARAMETER_VALUE, `${what}.parameters.${name}`);
    }
  }
  let bodies: Id[] | undefined;
  if (o.bodies !== undefined) {
    if (!Array.isArray(o.bodies) || o.bodies.length === 0) fail(`${what}.bodies: a list of the body IDs of the inserted document that is not empty is expected; leave the field out for all its bodies`);
    bodies = (o.bodies as unknown[]).map((id, i) => bodyId(id, `${what}.bodies[${i}]`));
    for (const [i, body] of bodies.entries()) context.requireRef({ id: body, kind: 'documentBody', document }, `${what}.bodies[${i}]`);
    const twice = bodies.find((id, i) => bodies?.indexOf(id) !== i);
    if (twice !== undefined) fail(`${what}.bodies: the body "${twice}" is listed twice`);
  }
  return { ...base(o, what), type: 'insert', document, placement, ...(parameters && Object.keys(parameters).length ? { parameters } : {}), ...(bodies ? { bodies } : {}) };
}

// The stored document with the values of an insertion put in place of the expressions of its
// parameters, and the settings of this document.
function substituted(stored: StoredDocument, values: Readonly<Record<string, number>>, settings: Document['settings']): Document {
  const parameters = stored.document.parameters.map((p) => (has(values, p.name) ? { name: p.name, expr: losslessNumber(values[p.name]) } : p));
  return { ...stored.document, settings, parameters };
}

// The warning `insertedIssues`: the features of the inserted document in error, the same warning of
// an insertion inside it carried up with its IDs prefixed, and its checks that fail or cannot be
// evaluated.
function insertedIssues(id: Id, doc: Document, record: InsertionRecord): Issue | undefined {
  const { state, checks } = record.recompute;
  const refs: unknown[] = [];
  // a ref of the same warning of an insertion `inner` inside the inserted document, carried up
  const carried = (ref: unknown, inner: Id): unknown => {
    if (!isObject(ref)) return ref;
    if (typeof ref.feature === 'string') return { ...ref, feature: `${id}/${ref.feature}` };
    if (typeof ref.check === 'string') return { check: ref.check, in: `${id}/${typeof ref.in === 'string' ? ref.in : inner}` };
    return ref;
  };
  for (const feature of doc.features) {
    const result = has(state.features, feature.id) ? state.features[feature.id] : undefined;
    if (!result) continue;
    if (result.status === 'error' && result.error) refs.push({ feature: `${id}/${feature.id}`, code: result.error.code });
    for (const warning of result.warnings) if (warning.code === 'insertedIssues') for (const ref of warning.refs ?? []) refs.push(carried(ref, feature.id));
  }
  for (const [name, check] of Object.entries(checks)) if (check.status !== 'ok') refs.push({ check: name });
  return refs.length ? issue('insertedIssues', refs) : undefined;
}

function step(feature: InsertFeature, context: StepContext): Step {
  const { state, done, failed, settings } = context;
  const entry = context.input as StoredDocument | undefined;
  if (!entry) return failed('brokenReference', [{ document: feature.document }], `the document has no stored document "${feature.document}"`);
  const frame = frameOf(feature.placement.frame, state);
  if (typeof frame === 'string') return failed(frame, [feature.placement.frame]);
  const values = feature.parameters ?? {};
  const unknown = Object.keys(values).filter((name) => !entry.document.parameters.some((p) => p.name === name));
  if (unknown.length) return failed('brokenReference', unknown.map((parameter) => ({ parameter })), `the stored document "${feature.document}" has no parameter ${unknown.map((name) => `"${name}"`).join(', ')}`);

  // the recompute: that of an earlier insertion of the same entry with the same environment, else
  // the evaluator's
  const doc = substituted(entry, values, settings);
  const environment = environmentText(evaluateParameters(doc.parameters));
  const earlier = Object.values(state.insertions).find((record) => record.stored === entry && record.environment === environment);
  const record: InsertionRecord = { stored: entry, environment, recompute: earlier?.recompute ?? context.insertion(doc) };
  const inner = record.recompute.state;

  const chosen = feature.bodies ?? Object.keys(inner.bodies);
  const absent = chosen.filter((body) => !has(inner.bodies, body));
  if (absent.length) return failed('brokenReference', absent.map((body) => ({ body })), `the inserted document has no body ${absent.map((body) => `"${body}"`).join(', ')} with these parameters`);
  if (chosen.length === 0) return failed('emptyResult', undefined, 'the inserted document has no body to bring');

  // every face number the chosen bodies have gets one new number here, one map for all of them
  const transform = placementTransform(feature.placement, frame);
  const solids: Solid[] = chosen.map((body) => inner.bodies[body]);
  const faces = [...new Set(solids.flatMap((solid) => [...new Set(solid.faceIds)]))].sort((a, b) => a - b);
  const renumbered = new Map<number, number>();
  const faceNames = [...state.faceNames];
  const faceInfos = [...state.faceInfos];
  const faceIds = new Map(state.faceIds);
  for (const face of faces) {
    const name: FaceName = insertedFaceName(inner.faceNames[face], feature.id);
    renumbered.set(face, faceNames.length);
    faceIds.set(faceKey(name), faceNames.length);
    faceNames.push(name);
    faceInfos.push(transformFace(transform, inner.faceInfos[face]));
  }
  const bodies = { ...state.bodies };
  const inserted: Record<Id, InsertedBody> = { ...state.inserted };
  const created: Id[] = [];
  chosen.forEach((body, i) => {
    const id = `${feature.id}/${body}`;
    bodies[id] = placedSolid(solids[i], transform, renumbered, feature.id);
    inserted[id] = { feature: feature.id, document: feature.document, body, inherited: has(record.recompute.inherited, body) ? record.recompute.inherited[body] : {} };
    created.push(id);
  });
  // the threads on the faces brought, placed and prefixed as the faces are (D76)
  const threads = [...state.threads, ...inner.threads.filter((thread) => renumbered.has(thread.face)).map((thread) => movedThread(thread, transform, renumbered.get(thread.face) as number, `${feature.id}/`))];
  const warning = insertedIssues(feature.id, entry.document, record);
  return {
    state: done(
      { status: warning ? 'warning' : 'ok', warnings: warning ? [warning] : [], bodies: created, facts: placementFacts(transform) },
      { bodies, faceNames, faceInfos, faceIds, insertions: { ...state.insertions, [feature.id]: record }, inserted, threads },
    ),
  };
}

const REMOVABLE = new Set(['parameters', 'bodies']);

export const insert: FeatureModule<InsertFeature> = {
  info: {
    title: 'Inserted document',
    summary:
      'Another document (a stored document of the section `documents`) inserted as a part: the bodies at the end of its timeline, recomputed from its features, placed by `placement` (a frame: a base plane, a plane feature, a planar face, or a sketch point; turns rx, ry, rz about the X axis, the Y axis and the normal of the frame, then offsets x, y, z in it). ' +
      '`parameters` sets parameters of the inserted document for this insertion (a value or an expression over the parameters of this document); `bodies` chooses which of its bodies come in (all without it). A body is `<feature>/<its ID there>`; its faces keep their names with the feature IDs prefixed `<feature>/`, so sketches, planes and projections may use them, and features may change it. ' +
      'Its body properties (colour, material, use, density or mass) come from the inserted document unless this document sets them for the body.',
    fields: INSERT_FIELDS,
    bodies: 'derived',
  },
  validate: insertFeature,
  refs: (f) => [
    ...frameRefs(f.placement.frame, 'placement/frame'),
    { path: 'document', id: f.document, kind: 'document' },
    ...Object.keys(f.parameters ?? {}).map((name): FeatureRef => ({ path: `parameters/${name}`, id: name, kind: 'parameter', document: f.document })),
    ...(f.bodies ?? []).map((body, i): FeatureRef => ({ path: `bodies/${i}`, id: body, kind: 'documentBody', document: f.document })),
  ],
  // every local name in the form of a body ID, or the listed ones; whether the stored document can
  // make it is asked by `bodyProblem` and `requireRef`, which see the document
  createsBody: (f, local) => {
    if (local === undefined) return false;
    const { feature, local: rest } = bodyOwner(local);
    return feature !== '' && !feature.includes('/') && rest !== '' && (f.bodies === undefined || f.bodies.includes(local));
  },
  namesFaces: true,
  producesTool: () => false,
  patch: {
    fields: ['document', 'placement', 'parameters', 'bodies'],
    dictionaries: ['parameters'],
    removable: (_f, path) => removablePlacementField(path) || (path.length === 1 && REMOVABLE.has(path[0])) || (path.length === 2 && path[0] === 'parameters'),
  },
  input: (f, doc) => (has(doc.documents, f.document) ? doc.documents[f.document] : undefined),
  step,
};
