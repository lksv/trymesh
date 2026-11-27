// Tools for the AI over the engine. Pure functions with no dependency on Node or on the browser: the same code
// serves the engine inside the MCP server and the engine of the running app (through the bridge).
//
// The tools are few and general. What the engine can do (commands, constraints, shapes of the document)
// gets into the description from the engine's sources: from the catalog of constraints and from the types.
// A new constraint or command in the engine thus shows up in the tools with no change here.
import {
  type BodyEdge,
  type BodyResult,
  CONSTRAINTS,
  type Command,
  type CommandResult,
  type Constraint,
  type Document,
  type Engine,
  type EngineState,
  type FaceName,
  type Feature,
  type FeatureResult,
  type Id,
  type Interference,
  type ExportFormat,
  type Issue,
  FEATURE_TYPE_INFO,
  QUERIES,
  type AnyQuery,
  type QueryName,
  type QueryOptions,
  INTERFERENCE_THRESHOLD,
  SKETCH_TOOLS,
  type SketchFeature,
  type Point2,
  splineBox,
  splineThrough,
  type SketchToolName,
  type BodyPropertiesResult,
  QueryFailure,
  bodyFileName,
  bodyPropertiesWithoutBody,
  constraintOperands,
  constraintPath,
  faceParts,
  freshIds,
  isDimension,
  referenceEntities,
  entryInput,
  kindOf,
  solvedCurves,
  type SketchPattern,
  type ImportedCurve,
  type ListedCurve,
  OUTLINE_FORMATS,
  OUTLINE_LIMITS,
  type OutlineFormat,
  type OutlineReport,
  type OutlineRevision,
  type RegionRef,
  type SketchOutline,
  fileStemOf,
  importOutline,
  outlineEntryId,
  outlineFormatOf,
  outlineRevision,
  placedOutlineBox,
  updateHolds,
  type SketchResult,
  poseNote,
  printedBodies,
  sketchTool,
  takenOver,
} from '@trymesh/engine';
import { apiLookup } from './api';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonSchema = { [key: string]: unknown };

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  hidden?: boolean; // an internal tool of the bridge and the server, not in the list for the AI
  run(engine: Engine, args: Record<string, unknown>): unknown;
}

// `about`: a note beside the result that is not part of it (the pose a query answered for, D49);
// the server prints it as a second text.
export type ToolOutcome = { ok: true; result: Json; about?: Json } | { ok: false; error: string };

// What a tool returns when it has a note beside its result.
export class Noted {
  constructor(
    readonly result: unknown,
    readonly about: Json,
  ) {}
}
// The answer of a tool computed in the pose of the state asked about: with the note of the joints
// that move the model, the result alone otherwise (a document without a pose answers as before the
// mechanism).
function posed(result: unknown, state: Pick<EngineState, 'document' | 'evaluation'>): unknown {
  const note = poseNote(state.evaluation.mechanism, state.document.mechanism);
  return note ? new Noted(result, { pose: Object.fromEntries(Object.entries(note.pose).map(([joint, value]) => [joint, round(value)])) }) : result;
}

// What a tool may answer with besides plain data. A result goes through JSON (`callTool`, the bridge
// to the app), so bytes do not survive it: a file travels as base64 in this envelope, and the
// server acts on the kind. `ToolOutcome.result` stays JSON; a `ToolAnswer` is JSON.
// - `files`: the server writes them where the caller said (the tool `export`).
// - `image`: returned to the client as image content (the operation `view_image`). `about` says
//   what the picture shows that pixels do not (its scale, the colour of every body); the server
//   prints it as text next to the picture.
export interface FileEnvelope {
  path: string; // relative, as `ExportFile.path` of the engine
  mediaType: string;
  base64: string;
  about?: Record<string, unknown>;
}
export type ToolAnswer = { kind: 'data'; data: Json } | { kind: 'files'; layout: 'file' | 'directory'; files: FileEnvelope[] } | { kind: 'image'; mediaType: 'image/png'; base64: string; about?: { [key: string]: Json } };

// An error of a call: a wrong argument, an unknown sketch. It goes back to the caller as text.
export class ToolError extends Error {}

const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;
// The result of a query as a tool prints it: numbers to six decimal places, as the tools round
// geometry. A key the query lists in `significant` gets that many significant digits instead, for
// values that are small on purpose (a volume above a small threshold must not round to zero).
function roundedResult(value: unknown, significant: { readonly [key: string]: number } = {}, key?: string): unknown {
  if (typeof value === 'number') return key !== undefined && Object.prototype.hasOwnProperty.call(significant, key) ? Number(value.toPrecision(significant[key])) : round(value);
  if (Array.isArray(value)) return value.map((item) => roundedResult(item, significant, key));
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, roundedResult(item, significant, name)]));
  return value;
}
const text = (args: Record<string, unknown>, name: string): string => {
  const value = args[name];
  if (typeof value !== 'string' || value === '') throw new ToolError(`argument "${name}": a non-empty string is expected`);
  return value;
};
const optionalText = (args: Record<string, unknown>, name: string): string | undefined => (args[name] === undefined || args[name] === null ? undefined : text(args, name));

function stateAt(engine: Engine, at: string | undefined): EngineState {
  if (at !== undefined && !engine.getState().document.features.some((feature) => feature.id === at)) throw new ToolError(`the feature "${at}" is not in the document`);
  return engine.getState(at);
}
function sketchOf(engine: Engine, id: string): SketchFeature {
  const feature = engine.getState().document.features.find((f) => f.id === id);
  if (feature?.type !== 'sketch') throw new ToolError(`the sketch "${id}" is not in the document`);
  return feature;
}

// ---------------------------------------------------------------- description of the model

// A short text for a face name; a face of a copy made by a pattern has `@<pattern>:<number>` appended.
const faceLabel = (name: FaceName): string => [name.feature, name.role, ...faceParts(name)].join('/') + (name.copy ?? []).map((tag) => `@${tag.pattern}:${tag.index}`).join('');

// Volume and bounding box of a body, as the engine computed them.
const solidInfo = (body: BodyResult): { volume: number; min: number[]; max: number[] } => ({ volume: round(body.volume), min: body.bounds.min.map(round), max: body.bounds.max.map(round) });

// A list of body IDs in an argument; undefined = the argument is not given.
function bodyList(engine: Engine, args: Record<string, unknown>, at?: string): string[] | undefined {
  const given = args.bodies;
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given) || given.some((id) => typeof id !== 'string')) throw new ToolError('argument "bodies": a list of body IDs is expected');
  const known = stateAt(engine, at).evaluation.bodies;
  for (const id of given as string[]) if (!Object.prototype.hasOwnProperty.call(known, id)) throw new ToolError(`the body "${id}" does not exist${at === undefined ? '' : ` after the feature "${at}"`} (get_model lists the bodies)`);
  return given as string[];
}

const issueInfo = (issue: Issue): Record<string, unknown> => ({ code: issue.code, message: issue.message, ...(issue.refs?.length ? { refs: issue.refs } : {}) });

function featureStatus(result: FeatureResult | undefined): Record<string, unknown> {
  if (!result) return { status: 'notEvaluated' };
  return {
    status: result.status,
    // `refs` says what the issue is about: the missing reference, the target bodies a cut did not
    // change (noEffect) or would remove (emptyResult), the fields with a bad expression.
    ...(result.error ? { error: issueInfo(result.error) } : {}),
    ...(result.warnings.length > 0 ? { warnings: result.warnings.map(issueInfo) } : {}),
    // expression errors by field: field address → reason
    ...(result.fieldErrors ? { fieldErrors: Object.fromEntries(Object.entries(result.fieldErrors).map(([path, error]) => [path, error.message])) } : {}),
  };
}

// What a profile generator published about the profile, rounded like every other number.
function factsInfo(result: FeatureResult | undefined): { facts?: Record<string, unknown> } {
  if (!result?.facts) return {};
  return { facts: Object.fromEntries(Object.entries(result.facts).map(([name, value]) => [name, typeof value === 'number' ? round(value) : Array.isArray(value) ? value.map(round) : value])) };
}

function constraintExpressions(feature: SketchFeature, id: Id, c: Constraint): { expressions?: Record<string, string> } {
  const entries = Object.keys(CONSTRAINTS[c.type].values ?? {})
    .map((name): [string, string | undefined] => [name, feature.expressions && Object.prototype.hasOwnProperty.call(feature.expressions, constraintPath(id, name)) ? feature.expressions[constraintPath(id, name)] : undefined])
    .filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length ? { expressions: Object.fromEntries(entries) } : {};
}

// Parameters with values and errors, checks with their result.
function parametersInfo(state: EngineState): { parameters: Record<string, unknown>[]; checks: Record<string, unknown>[] } {
  const { document, evaluation } = state;
  return {
    parameters: document.parameters.map(({ name, expr }) => {
      const result = Object.prototype.hasOwnProperty.call(evaluation.parameters, name) ? evaluation.parameters[name] : undefined;
      return { name, expr, ...(result?.ok ? { value: round(result.value) } : result ? { error: result.error.message } : {}) };
    }),
    checks: document.checks.map(({ name, expr }) => {
      const result = Object.prototype.hasOwnProperty.call(evaluation.checks, name) ? evaluation.checks[name] : undefined;
      return { name, expr, status: result?.status ?? 'error', ...(result?.error ? { error: result.error.message } : {}) };
    }),
  };
}

// What is not a feature state but the caller should know: checks that fail, parameters in error,
// body properties whose density or mass cannot be evaluated (own or inherited by a copy), and, for
// the state at the end of the timeline (`whole`), entries of body properties whose body is gone and
// the problems of the mechanism (D49): joints in error, links with bodies the model does not have,
// bodies in no link. At a point of the construction (`at`) these would name every joint whose
// sketch comes later and every body not made yet; the query `mechanism` answers there.
function documentProblems(state: EngineState, whole = true): Record<string, unknown> {
  const { parameters, checks } = parametersInfo(state);
  const failedChecks = checks.filter((check) => check.status !== 'ok');
  const parameterErrors = parameters.filter((parameter) => parameter.error !== undefined);
  const bodyPropertyErrors = Object.entries(state.evaluation.bodyProperties).flatMap(([body, result]) => Object.entries(result.fieldErrors ?? {}).map(([field, error]) => ({ body, field, message: error.message })));
  const withoutBody = whole ? bodyPropertiesWithoutBody(state.document.bodyProperties, state.evaluation.bodyProperties) : [];
  const { mechanism } = state.evaluation;
  const jointErrors = whole ? Object.entries(mechanism.joints).flatMap(([joint, result]) => (result.error ? [{ joint, code: result.error.code, message: result.error.message }] : [])) : [];
  // a field of the drive of a joint (5b) that does not evaluate: no fault of the joint, but the export of a robot refuses it
  const jointDriveErrors = whole ? Object.entries(mechanism.joints).flatMap(([joint, result]) => Object.entries(result.driveErrors ?? {}).map(([field, error]) => ({ joint, field, message: error?.message }))) : [];
  const linksMissingBodies = whole ? Object.entries(mechanism.links).flatMap(([link, result]) => (result.missing.length ? [{ link, missing: result.missing }] : [])) : [];
  const bodiesInNoLink = whole ? mechanism.unassigned : [];
  return {
    ...(failedChecks.length ? { failedChecks } : {}),
    ...(parameterErrors.length ? { parameterErrors } : {}),
    ...(bodyPropertyErrors.length ? { bodyPropertyErrors } : {}),
    ...(withoutBody.length ? { bodyPropertiesWithoutBody: withoutBody } : {}),
    ...(jointErrors.length ? { jointErrors } : {}),
    ...(jointDriveErrors.length ? { jointDriveErrors } : {}),
    ...(linksMissingBodies.length ? { linksMissingBodies } : {}),
    ...(bodiesInNoLink.length ? { bodiesInNoLink } : {}),
  };
}

// The mechanism as get_model prints it (D49), when there is a link: the links with their bodies, the
// joints with their numbers (rounded so that a limit read here is accepted as a value: the
// tolerance of the limits is wider than the rounding) and expressions, the roots when there are
// several. The bodies of get_model stay as modelled. `status: 'error'` of a joint goes with
// `jointErrors`: for the state at the end of the timeline only (`whole`); at a point of the
// construction a joint whose axis comes later would be in error, and the query `mechanism` says so.
function mechanismInfo(state: EngineState, whole: boolean): { mechanism?: Record<string, unknown> } {
  const { links, joints } = state.document.mechanism;
  if (Object.keys(links).length === 0) return {};
  const { roots } = state.evaluation.mechanism;
  return {
    mechanism: {
      links: Object.entries(links).map(([id, link]) => ({ id, ...(link.name !== undefined ? { name: link.name } : {}), bodies: link.bodies })),
      joints: Object.entries(joints).map(([id, joint]) => {
        const numbers = joint as unknown as Record<string, unknown>;
        return {
          id,
          ...(joint.name !== undefined ? { name: joint.name } : {}),
          type: joint.type,
          parent: joint.parent,
          child: joint.child,
          ...('axis' in joint ? { axis: joint.axis as unknown as Json } : {}),
          ...Object.fromEntries(['lower', 'upper', 'value'].flatMap((field) => (typeof numbers[field] === 'number' ? [[field, round(numbers[field] as number)]] : []))),
          // the drive (5b) as stored: read by the export of a robot only
          ...Object.fromEntries(['effort', 'velocity', 'rotorInertia', 'gearRatio'].flatMap((field) => (typeof numbers[field] === 'number' ? [[field, numbers[field] as number]] : []))),
          ...(joint.expressions ? { expressions: joint.expressions } : {}),
          ...(whole && state.evaluation.mechanism.joints[id]?.status === 'error' ? { status: 'error' } : {}),
        };
      }),
      ...(roots.length > 1 ? { roots } : {}),
    },
  };
}

// What the properties of a body state beyond the defaults (D48): the name when it has one of its
// own, the colour, the material, the use when it is not `part`, the density, the mass in grams and
// the body it was copied from.
function propertiesInfo(state: EngineState, id: string): Record<string, unknown> {
  const all = state.evaluation.bodyProperties;
  const result: BodyPropertiesResult | undefined = Object.prototype.hasOwnProperty.call(all, id) ? all[id] : undefined;
  if (!result) return {};
  const own = Object.prototype.hasOwnProperty.call(state.document.bodyProperties, id) ? state.document.bodyProperties[id] : undefined;
  return {
    ...(own?.name !== undefined ? { name: result.name } : {}),
    ...(result.color !== undefined ? { color: result.color } : {}),
    ...(result.material !== undefined ? { material: result.material } : {}),
    ...(result.use !== 'part' ? { use: result.use } : {}),
    ...(result.density !== undefined ? { density: round(result.density) } : {}),
    ...(result.mass !== undefined ? { mass: Number(result.mass.toPrecision(6)), massFrom: result.massFrom } : {}),
    ...(result.from !== undefined ? { from: result.from } : {}),
  };
}

// The state of a sketch in overviews. For an unsolved sketch (a conflict, a failure of the solver) the
// degrees of freedom say nothing, so they are not given.
function sketchBrief(result: FeatureResult | undefined): Record<string, unknown> {
  const sketch = result?.sketch;
  if (!sketch) return {};
  const solved = !result.warnings.some((warning) => warning.code === 'sketchConflict');
  return { solved, ...(solved ? { degreesOfFreedom: sketch.degreesOfFreedom } : { conflicting: sketch.conflicting }), profileValid: sketch.valid, regions: sketch.regions.length };
}

function featureSummary(feature: Feature, result: FeatureResult | undefined): unknown {
  // `bodies`: the bodies the feature created, so that derived IDs (`<pattern>/<number>`) need not be composed
  const base = {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    ...(featureStatus(result) as object),
    ...(feature.expressions ? { expressions: feature.expressions } : {}),
    ...(result?.bodies?.length ? { bodies: result.bodies } : {}),
  };
  // A sketch has commands of its own and no updatable fields: its summary counts its content. Any
  // other type is summarised by its updatable fields and its facts, so a new type needs no branch here.
  if (feature.type !== 'sketch') return { ...base, ...updatableFields(feature), ...factsInfo(result) };
  const sketch = result?.sketch;
  return {
    ...base,
    plane: feature.plane as unknown as Json,
    points: Object.keys(feature.points).length,
    curves: Object.keys(feature.curves).length,
    constraints: Object.keys(feature.constraints).length,
    ...(sketch ? sketchBrief(result) : {}),
  };
}

// The fields of a feature that `updateFeature` may change, as the registry of feature types lists
// them: the summary of every type that has no summary of its own.
function updatableFields(feature: Feature): Record<string, Json> {
  const fields = feature as unknown as Record<string, Json | undefined>;
  return Object.fromEntries(FEATURE_TYPE_INFO[feature.type].updatable.flatMap((field): [string, Json][] => (fields[field] === undefined ? [] : [[field, fields[field] as Json]])));
}

// The stored meshes as get_model lists them (D55), when there are any: the ID, the name, the
// triangles, the size of the bounds and the features that place each.
function meshesInfo(state: EngineState): { meshes?: Json[] } {
  const entries = Object.entries(state.evaluation.meshes);
  if (entries.length === 0) return {};
  return {
    meshes: entries.map(([id, mesh]) => ({ id, ...(mesh.name !== undefined ? { name: mesh.name } : {}), triangles: mesh.triangles, size: mesh.bounds.max.map((high, axis) => round(high - mesh.bounds.min[axis])), usedBy: mesh.usedBy })),
  };
}

// The stored documents as get_model lists them (D62), when there are any: the ID, the name, the
// values of its own parameters, the number of its features and the features that insert it.
function documentsInfo(state: EngineState): { documents?: Json[] } {
  const entries = Object.entries(state.evaluation.documents);
  if (entries.length === 0) return {};
  return {
    documents: entries.map(([id, stored]) => ({
      id,
      ...(stored.name !== undefined ? { name: stored.name } : {}),
      parameters: Object.fromEntries(stored.parameters.map((p) => [p.name, p.value === undefined ? null : round(p.value)])),
      features: stored.features,
      usedBy: stored.usedBy,
    })),
  };
}

// The document as get_document prints it: every stored mesh without its two texts of base64 (D55),
// which would fill the context of a caller, and every stored document shortened (D62): its name,
// its parameters, the numbers of its features and stored documents, the size of the rest.
// save_document writes them; get_document with `stored` prints one stored document.
function documentShown(document: Document): unknown {
  const meshes = Object.entries(document.meshes);
  const documents = Object.entries(document.documents ?? {});
  const features = document.features.map(featureShown);
  const shortened = features.some((feature, i) => feature !== document.features[i]);
  if (meshes.length === 0 && documents.length === 0 && !shortened) return document;
  return {
    ...document,
    ...(shortened ? { features } : {}),
    ...(meshes.length
      ? { meshes: Object.fromEntries(meshes.map(([id, mesh]) => [id, { ...(mesh.name !== undefined ? { name: mesh.name } : {}), omitted: `positions and triangles: ${mesh.positions.length + mesh.triangles.length} characters of base64; save_document writes them` }])) }
      : {}),
    ...(documents.length
      ? {
          documents: Object.fromEntries(
            documents.map(([id, stored]) => [
              id,
              {
                ...(stored.name !== undefined ? { name: stored.name } : {}),
                parameters: stored.document.parameters,
                features: stored.document.features.length,
                documents: Object.keys(stored.document.documents ?? {}).length,
                omitted: `the timeline and the sections: ${JSON.stringify(stored.document).length} characters; get_document with \`stored: "${id}"\` prints them`,
              },
            ]),
          ),
        }
      : {}),
  };
}

// A stored document by its path (D62): its ID, or the IDs of the stored documents on the way to it
// joined by slashes (`kit/bearing`, the stored document `bearing` of the stored document `kit`).
export function storedDocument(document: Document, path: string): Document {
  let current = document;
  for (const id of path.split('/')) {
    const documents = current.documents ?? {};
    if (!Object.prototype.hasOwnProperty.call(documents, id)) {
      const known = Object.keys(documents);
      throw new ToolError(`the document has no stored document "${path}"${known.length ? ` (its stored documents: ${known.join(', ')})` : ''}`);
    }
    current = documents[id].document;
  }
  return current;
}

// What a command that inserts a stored document would bring (D62), by a preview of it: the
// parameters of the stored document, the bodies with the use, the material and the mass they
// inherit, and the warning of the insertion. For the answer of the tool insert_document.
function insertionPreview(engine: Engine, args: Record<string, unknown>): unknown {
  const id = text(args, 'document');
  const result = engine.preview(command(args));
  if (!result.ok) throw new ToolError(commandProblem(result));
  const { evaluation, document } = result.state;
  const feature = document.features.find((f) => f.type === 'insert' && f.document === id && !engine.getState().document.features.some((old) => old.id === f.id));
  const own = feature ? evaluation.features[feature.id] : undefined;
  const warning = own?.error ?? own?.warnings[0];
  return {
    parameters: evaluation.documents[id]?.parameters ?? [],
    bodies: (own?.bodies ?? []).map((body) => {
      const p = evaluation.bodyProperties[body];
      return { id: body, use: p.use, ...(p.material !== undefined ? { material: p.material } : {}), ...(p.mass !== undefined ? { mass: round(p.mass) } : {}) };
    }),
    ...(warning ? { warning: `${warning.code}: ${warning.message}${warning.refs?.length ? ` ${JSON.stringify(warning.refs)}` : ''}` } : {}),
  };
}

// `whole`: the state is that at the end of the timeline (no `at`).
function modelSummary(state: EngineState, whole = true): unknown {
  const { document, evaluation } = state;
  return {
    features: document.features.map((feature) => featureSummary(feature, evaluation.features[feature.id])),
    bodies: Object.entries(evaluation.bodies).map(([id, body]) => ({ id, ...solidInfo(body), faces: body.faces.length, edges: body.edges.length, ...propertiesInfo(state, id) })),
    problems: document.features.filter((feature) => ['error', 'warning'].includes(evaluation.features[feature.id]?.status ?? '')).map((feature) => feature.id),
    ...(document.parameters.length ? { parameters: Object.fromEntries(parametersInfo(state).parameters.map((p) => [p.name, p.value ?? { error: p.error }])) } : {}),
    ...mechanismInfo(state, whole),
    ...meshesInfo(state),
    ...documentsInfo(state),
    ...documentProblems(state, whole),
    canUndo: state.canUndo,
    canRedo: state.canRedo,
  };
}

// The rows of some features of get_model (D73), and the bodies they create, as the whole model
// lists them; an ID that is not a feature of the state is an error that names the features there are.
const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
function featuresSummary(state: EngineState, ids: unknown): unknown {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) throw new ToolError('argument "features": a list of feature IDs that is not empty is expected');
  const { document, evaluation } = state;
  const known = document.features.filter((feature) => has(evaluation.features, feature.id));
  const missing = [...new Set(ids)].filter((id) => !known.some((feature) => feature.id === id));
  if (missing.length) throw new ToolError(`argument "features": the state has no feature ${missing.map((id) => `"${id}"`).join(', ')}; it has ${known.map((feature) => feature.id).join(', ') || 'none'}`);
  const listed = known.filter((feature) => ids.includes(feature.id));
  const bodies = listed.flatMap((feature) => evaluation.features[feature.id]?.bodies ?? []).filter((id) => has(evaluation.bodies, id));
  return {
    features: listed.map((feature) => featureSummary(feature, evaluation.features[feature.id])),
    bodies: bodies.map((id) => ({ id, ...solidInfo(evaluation.bodies[id]), faces: evaluation.bodies[id].faces.length, edges: evaluation.bodies[id].edges.length, ...propertiesInfo(state, id) })),
  };
}

// A body as `get_body` prints it. The tool keeps its own check that the body exists and its own
// text; the volume, the bounds, the faces and the edges come from the query `body` of the engine,
// which computes them in the pose of the document (D49), so one answer is not half posed.
function bodyDetail(engine: Engine, at: string | undefined, id: string): unknown {
  const state = stateAt(engine, at);
  const body = Object.prototype.hasOwnProperty.call(state.evaluation.bodies, id) ? state.evaluation.bodies[id] : undefined;
  if (!body) throw new ToolError(`the body "${id}" does not exist at this point of the timeline (a body ID is the ID of an extrusion with the operation new or of a split, or "<pattern>/<number>" for a copy made by a pattern; get_model lists the bodies)`);
  const answer = engine.query('body', { body: id }, at === undefined ? {} : { at });
  if (!answer.ok) throw new ToolError(`${answer.error.code}: ${answer.error.message}`);
  const edgeShape = (edge: BodyEdge): Record<string, unknown> => ({
    segments: edge.segments,
    length: round(edge.length),
    ...(edge.kind === 'line' ? { from: edge.from.map(round), to: edge.to.map(round), ...(edge.gaps ? { gaps: true } : {}) } : {}),
    ...(edge.kind === 'circle' ? { center: edge.circle.center.map(round), radius: round(edge.circle.radius), axis: edge.circle.axis.map(round) } : {}),
  });
  return posed({
    id,
    volume: round(answer.result.volume),
    min: answer.result.bounds.min.map(round),
    max: answer.result.bounds.max.map(round),
    faces: answer.result.faces.map((face) => ({ name: face.name as unknown as Json, label: faceLabel(face.name), planar: face.surface.kind === 'plane', area: round(face.area), ...(face.meshNormal ? { normal: face.meshNormal.map(round) } : {}) })),
    edges: answer.result.edges.map((edge) => ({ name: edge.name as unknown as Json, label: `${faceLabel(edge.name.a)} | ${faceLabel(edge.name.b)}`, kind: edge.kind, ...edgeShape(edge) })),
  }, state);
}

const plural = (count: number): string => `${count} ${count === 1 ? 'degree' : 'degrees'} of freedom`;

const constraintLabel = (c: Constraint): string => `${CONSTRAINTS[c.type].title} (${constraintOperands(c).join(', ')})`;

function loopArea(loop: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0, n = loop.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return sum / 2;
}

// What get_sketch lists of an entry of `external` beyond its fields: its entities by the registry
// of the engine (the entry itself and its derived points, on which constraints may be put), the
// positions of its point entities, and the radius when the entry itself is a circle.
function entryDetail(feature: SketchFeature, entry: Id, position: (point: Id) => Json, radii: Record<Id, number> | undefined): Record<string, Json> {
  const entities = referenceEntities(feature, entry);
  return {
    entities: Object.keys(entities),
    at: Object.entries(entities)
      .filter(([, kind]) => kind === 'point')
      .map(([point]) => position(point)),
    ...(entities[entry] === 'circle' && radii?.[entry] !== undefined ? { radius: round(radii[entry]) } : {}),
  };
}

// A derived entry (a mirror or pattern, D68) is listed short (design.md of 6c, "MCP"): its input
// form (what updateExternal takes back), `source`, the copy numbers the last recompute made as
// ranges, `step` (where copy k stands) and `first`, the entities of the first copy made with the
// kind of a curve or the position of a point. Its every ID and position would be thousands.
const rangesOf = (numbers: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (const n of [...new Set(numbers)].sort((p, q) => p - q)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
};
// the copy number of `<entry>/<n>/<source>`, or undefined
const copyNumber = (entry: Id, id: Id): number | undefined => {
  if (!id.startsWith(`${entry}/`)) return undefined;
  const rest = id.slice(entry.length + 1);
  const slash = rest.indexOf('/');
  const n = slash > 0 ? Number(rest.slice(0, slash)) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
function derivedDetail(feature: SketchFeature, entry: Id, solved: SketchResult | undefined, position: (point: Id) => Json): Record<string, Json> {
  const input = entryInput(feature, entry) as unknown as { [key: string]: Json };
  const made = new Set<number>();
  for (const id of [...Object.keys(solved?.curves ?? {}), ...Object.keys(solved?.points ?? {})]) {
    const n = copyNumber(entry, id);
    if (n !== undefined) made.add(n);
  }
  const numbers = [...made].sort((p, q) => p - q);
  const ref = feature.external[entry] as SketchPattern;
  const world = solvedCurves(feature, solved);
  const ends = (line: Id): [Json, Json] | null => {
    const curve = world.curves.get(line);
    if (curve?.shape.type !== 'line') return null;
    const [a, b] = [world.geometry.points[curve.shape.a], world.geometry.points[curve.shape.b]];
    return a && b ? [[round(a.x), round(a.y)], [round(b.x), round(b.y)]] : null;
  };
  // the shift of copy `n` from its source, read from the first copied point that has a position
  const shift = (n: number): Json => {
    for (const id of Object.keys(solved?.points ?? {})) {
      if (copyNumber(entry, id) !== n) continue;
      const source = id.slice(`${entry}/${n}/`.length);
      const [p, q] = [world.geometry.points[source], solved?.points[id]];
      if (p && q) return [round(q.x - p.x), round(q.y - p.y)];
    }
    return null;
  };
  // the shift of one step along a direction line, from the transform (a direction of one place
  // makes no copy to read it from): from `a` to `b` of the line, the spacing or length / (count − 1)
  const stepAlong = (line: Id, count: number, span: { type: 'spacing'; spacing: number } | { type: 'length'; length: number }): Json => {
    const curve = world.curves.get(line);
    if (curve?.shape.type !== 'line') return null;
    const [a, b] = [world.geometry.points[curve.shape.a], world.geometry.points[curve.shape.b]];
    const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    if (!a || !b || !(length > 0)) return null;
    const along = span.type === 'spacing' ? span.spacing : count > 1 ? span.length / (count - 1) : 0;
    return [round(((b.x - a.x) / length) * along), round(((b.y - a.y) / length) * along)];
  };
  const t = ref.transform;
  let step: Json;
  switch (t.type) {
    case 'mirror':
      step = { axis: ends(t.axis) };
      break;
    case 'linear':
      step = { shift: shift(1) ?? stepAlong(t.direction, t.count, t.span), ...(t.second ? { second: shift(1000) ?? stepAlong(t.second.direction, t.second.count, t.second.span) } : {}) };
      break;
    case 'circular': {
      const c = world.geometry.points[t.center];
      step = { center: c ? [round(c.x), round(c.y)] : null, angle: round(t.span.type === 'full' ? (2 * Math.PI) / t.count : t.count > 1 ? t.span.angle / (t.count - 1) : 0) };
      break;
    }
    default:
      step = null;
  }
  const first: { [key: string]: Json } = {};
  if (numbers.length > 0) {
    const prefix = `${entry}/${numbers[0]}/`;
    for (const [id, kind] of Object.entries(referenceEntities(feature, entry))) {
      if (!id.startsWith(prefix)) continue;
      if (kind === 'point') {
        if (solved?.points[id]) first[id] = position(id);
      } else if (solved?.curves[id]) first[id] = kind;
    }
  }
  return { ...input, source: 'derived', copies: rangesOf(numbers), step, first };
}

// The regions of a sketch for get_sketch: regions whose outer loop is the copies with one number of
// one entry and that are equal (the outer loop up to the copy number, the area as written, the
// number of holes) are one row with the reference of the first and `copies: { entry, numbers }`;
// every other region is a row of its own.
// The rows are capped (D72): at most `SKETCH_SHOWN.regions` and the count of the rest
// (`regionsNotListed`); an outer loop of more than `SKETCH_SHOWN.loop` IDs is printed short with the
// call of the query sketchRegions that gives it whole.
function regionRows(feature: SketchFeature, solved: SketchResult | undefined): { regions: Json[]; regionsNotListed?: Json } {
  const rows: { [key: string]: Json }[] = [];
  const groups = new Map<string, { row: { [key: string]: Json }; numbers: number[] }>();
  for (const [index, region] of (solved?.regions ?? []).entries()) {
    const area = round(region.loops.reduce((sum, loop) => sum + loopArea(loop), 0));
    const row: { [key: string]: Json } = { ref: shownRef(feature.id, region.ref, index), area, holes: region.loops.length - 1 };
    const loop = region.ref.outerLoop;
    const entry = loop[0]?.split('/')[0];
    const n = entry !== undefined && Object.prototype.hasOwnProperty.call(feature.external, entry) && kindOf(feature.external[entry]).source === 'derived' ? copyNumber(entry, loop[0]) : undefined;
    if (entry === undefined || n === undefined || !loop.every((id) => copyNumber(entry, id) === n)) {
      rows.push(row);
      continue;
    }
    const key = JSON.stringify([entry, loop.map((id) => id.slice(`${entry}/${n}/`.length)), area, row.holes]);
    const group = groups.get(key);
    if (group) group.numbers.push(n);
    else {
      const made = { row, numbers: [n] };
      groups.set(key, made);
      rows.push(row);
    }
  }
  for (const [key, group] of groups) {
    if (group.numbers.length < 2) continue;
    group.row.copies = { entry: JSON.parse(key)[0] as string, numbers: rangesOf(group.numbers) };
  }
  if (rows.length <= SKETCH_SHOWN.regions) return { regions: rows };
  return { regions: rows.slice(0, SKETCH_SHOWN.regions), regionsNotListed: { count: rows.length - SKETCH_SHOWN.regions, more: `the query sketchRegions with { sketch: "${feature.id}" } lists every region with its whole reference, a page at a time` } };
}
// What get_document prints of an outline of more than `OUTLINE_LIMITS.listed` curves, in the place of
// its curves, on each of its paths (the whole document, one feature, a feature of a stored document).
export const OUTLINE_OMITTED = (count: number): string => `${count} curves; get_sketch lists the first ${OUTLINE_LIMITS.listed}, the query entryCurves the rest, and save_document writes them`;
// A feature as get_document prints it: a sketch with its large outlines shortened.
function featureShown(feature: Feature): Feature {
  if (feature.type !== 'sketch') return feature;
  const large = Object.entries(feature.external).filter(([, ref]) => ref.type === 'outline' && Object.keys(ref.curves).length > OUTLINE_LIMITS.listed);
  if (large.length === 0) return feature;
  const external = { ...feature.external } as Record<Id, unknown>;
  for (const [id, ref] of large) external[id] = { ...ref, curves: OUTLINE_OMITTED(Object.keys((ref as SketchOutline).curves).length) };
  return { ...feature, external } as unknown as Feature;
}

// The row of an outline in get_sketch, in the place of the generic row of an entry: the fields with
// their expressions, what it was read with, the counts, the box as placed, and the first curves at
// their places, bounded by curves and by positions (a spline without `through`, which the query
// entryCurves gives); the rest is that query.
function outlineDetail(engine: Engine, feature: SketchFeature, entry: Id): Record<string, Json> {
  const ref = feature.external[entry] as SketchOutline;
  const input = entryInput(feature, entry) as unknown as Record<string, Json>;
  const counts: Record<ImportedCurve['type'], number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  for (const curve of Object.values(ref.curves)) counts[curve.type]++;
  const total = Object.keys(ref.curves).length;
  const page = engine.query('entryCurves', { sketch: feature.id, entry, max: OUTLINE_LIMITS.listed });
  const listed: Json[] = [];
  let positions = 0;
  // where the next page starts: the query's `next` when this row lists its whole page; cut short by
  // the positions, the count listed (the page starts at 0, and a curve of an outline always has its
  // place, so the query passed none over before it)
  let next = 0;
  if (page.ok && page.result.status === 'ok') {
    for (const curve of page.result.curves) {
      const held = curve.type === 'spline' ? curve.control.length : curve.type === 'arc' ? 3 : curve.type === 'line' ? 2 : 1;
      if (listed.length > 0 && positions + held > OUTLINE_LIMITS.listedPoints) break;
      positions += held;
      const { through: _, ...shown } = curve as ListedCurve & { through?: unknown };
      listed.push(roundedResult(shown) as Json);
    }
    next = listed.length === page.result.curves.length ? page.result.next : listed.length;
  }
  // the box as placed: the curves at their places (an arc by its extremes within its sweep, a spline
  // by its curve), not the points of the entry alone
  const placed = placedOutlineBox(entry, ref);
  const box = placed ? [placed.min[0], placed.min[1], placed.max[0], placed.max[1]] : undefined;
  const { curves: _, ...fields } = input;
  return {
    ...fields,
    source: 'reference',
    counts,
    ...(box ? { box: box.map(round) } : {}),
    curves: listed,
    listed: listed.length,
    total,
    ...(next < total ? { more: `the query entryCurves with { sketch: "${feature.id}", entry: "${entry}", from: ${next} } lists the rest` } : {}),
  };
}

// The rows of get_sketch's regions, capped: at most SKETCH_SHOWN.regions rows and the count of the
// rest; an outer loop of more than SKETCH_SHOWN.loop IDs printed as its count, its first IDs, the
// entries they are under, its index among the regions, and the call of sketchRegions that gives it.
export const SKETCH_SHOWN = { regions: 50, loop: 20 } as const;

// the reference of a region as get_sketch prints it: whole up to SKETCH_SHOWN.loop IDs
function shownRef(sketch: Id, ref: RegionRef, index: number): Json {
  const loop = ref.outerLoop;
  if (loop.length <= SKETCH_SHOWN.loop) return ref as unknown as Json;
  const entries = [...new Set(loop.filter((id) => id.includes('/')).map((id) => id.split('/')[0]))];
  return { count: loop.length, first: loop.slice(0, SKETCH_SHOWN.loop), entries, index, whole: `query sketchRegions with { sketch: "${sketch}", index: ${index} }` };
}


// The advice of the open ends of copies (D68): the entries the listed ends belong to, and the cure
// by the transform of the entry of the first (a row of marks is open on purpose).
// The cure of an open end of an imported outline (D72).
export const OUTLINE_OPEN_END = 'Curves of an imported outline close where their ends are within 1e-6 mm: import the file again with a larger `weld` (the report of the import lists the gaps), or end an own curve at the open end';
export function openEndAdvice(feature: SketchFeature, solved: SketchResult | undefined): string | undefined {
  const open = solved?.openEnds;
  if (!open || open.count === 0 || open.ends.length === 0) return undefined;
  const entries = [...new Set(open.ends.map((end) => end.end.split('/')[0]))];
  const first = open.ends[0];
  const refOf = (entry: Id) => (Object.prototype.hasOwnProperty.call(feature.external, entry) ? feature.external[entry] : undefined);
  // the ends of a mirror or pattern are ends of copies; those of a projection flagged to form
  // regions are its own
  const derived = (entry: Id): boolean => {
    const ref = refOf(entry);
    return ref !== undefined && kindOf(ref).source === 'derived';
  };
  const ref = refOf(entries[0]);
  const transform = ref?.type === 'pattern' ? ref.transform.type : undefined;
  const cure =
    transform === 'mirror'
      ? "hold the source's end on the axis by a constraint (`pointOnCurve` with the axis)"
      : transform === 'circular'
        ? 'choose a count or an angle that brings the copies together, or leave the ring open if that is meant'
        : transform === 'linear'
          ? 'choose a spacing, a length or a count that brings the copies together, or leave them open if that is meant (a row of marks or of open shapes is open on purpose)'
          : 'end an own curve at it, or project the edge that continues it';
  const outline = ref?.type === 'outline';
  const where =
    first.reason === 'twoVertices'
      ? `\`${first.end}\` lands where ${first.near.map((id) => `\`${id}\``).join(' and ')} lie without being joined: join them by \`coincident\`.`
      : outline
        ? `\`${first.end}\` is ${round(first.distance)} mm from ${first.near.length ? `\`${first.near[0]}\`` : 'every other end'}. ${OUTLINE_OPEN_END}.`
        : `\`${first.end}\` is ${round(first.distance)} mm from ${first.near.length ? `\`${first.near[0]}\`` : 'every other end'}. ${derived(entries[0]) ? 'Copies close' : 'Projected curves close'} with what lies at their ends within 1e-6 mm: ${cure}.`;
  const named = (list: Id[]): string => list.map((entry) => `\`${entry}\``).join(', ');
  const [copies, projected] = [entries.filter(derived), entries.filter((entry) => !derived(entry))];
  const whose = [...(copies.length > 0 ? [`copies of ${named(copies)}`] : []), ...(projected.length > 0 ? [named(projected)] : [])].join(' and of ');
  const listed = open.ends.length < open.count ? ` (the first ${open.ends.length} are listed)` : '';
  return `${open.count} ${open.count === 1 ? 'end' : 'ends'} of ${whose} ${open.count === 1 ? 'is' : 'are'} open (\`openEnds\` of the result${listed}): ${where}`;
}

// Where a spline runs (D70, the owner's answers 26 and 34): `through`, points the curve passes from
// its start to its end (the joints of its Bezier pieces and the middle of each), and `box`, the box
// of the curve, at the positions `at` of the control points shows (the solved ones, else the
// document's, so also in an unsolved sketch), rounded as positions are; left out while a control
// point has no position.
function splineDetail(points: readonly Id[], at: (point: Id) => Point2 | undefined): { through?: Json; box?: Json } {
  const control = points.map((point) => (point === 'origin' ? { x: 0, y: 0 } : at(point)));
  if (control.some((p) => p === undefined)) return {};
  const xy = (control as Point2[]).map((p): [number, number] => [p.x, p.y]);
  return { through: splineThrough(xy).map((p) => [round(p[0]), round(p[1])]), box: splineBox(xy).map(round) };
}

function sketchDetail(engine: Engine, id: string): unknown {
  const feature = sketchOf(engine, id);
  const result = engine.getState(id).evaluation.features[id];
  const diagnosis = engine.diagnoseSketch(id);
  const solved = result?.sketch;
  const position = (point: Id): Json => {
    const p = solved?.points[point] ?? (Object.prototype.hasOwnProperty.call(feature.points, point) ? feature.points[point] : undefined);
    return p ? [round(p.x), round(p.y)] : null;
  };
  const twins = new Set(diagnosis.duplicates.flatMap((group) => group.slice(1)));
  const freedom = new Map(diagnosis.free.map((entity) => [`${entity.kind}:${entity.id}`, entity.freedom]));

  const advice: string[] = [];
  if (diagnosis.status === 'conflict') advice.push('The constraints are in conflict; remove or change one of the constraints in `conflicting`.');
  if (diagnosis.status === 'failed') advice.push('The sketch could not be solved; the positions of the points are far from a solution or the constraints cannot be satisfied.');
  if (diagnosis.status === 'unavailable') advice.push('The sketch was not evaluated (it is suppressed or its plane does not exist); no diagnosis is available.');
  if (diagnosis.status === 'solved') {
    if (diagnosis.degreesOfFreedom === 0) advice.push('The sketch is fully constrained.');
    else {
      const anchors = diagnosis.free.filter((entity) => entity.kind === 'point' && entity.freedom === diagnosis.degreesOfFreedom).map((entity) => entity.id);
      advice.push(`The sketch has ${plural(diagnosis.degreesOfFreedom)}; the free entities are in \`diagnosis.free\`.`);
      // A point whose freedom equals the freedom of the sketch: fixing it fixes the whole sketch. With
      // freedom 2 by two dimensions, with freedom 1 by one dimension or a constraint in the direction it
      // can move in. Coincidence with a fixed point is not advised: it pulls the geometry that starts at
      // that point into a point, and with freedom 1 it would be in conflict.
      if (anchors.length > 0) {
        const how = diagnosis.degreesOfFreedom === 2 ? 'for example by a horizontal and a vertical dimension from the origin' : 'by one dimension or constraint that sets its position in the direction it can move in; coincidence with a fixed point would be in conflict here';
        advice.push(`The sketch becomes fully constrained when the position of one of the points ${anchors.join(', ')} is set (${how}).`);
      }
    }
    if (diagnosis.removable.length > 0) advice.push(`Surplus constraints: ${diagnosis.removable.join(', ')}. They can be removed at once without a change of the geometry; what each follows from, explain_constraint says.`);
  }
  if (solved && !solved.valid) advice.push('The profile is invalid: curves cross or touch away from joined points. Such a sketch cannot be extruded.');
  const open = openEndAdvice(feature, solved);
  if (open) advice.push(open);

  return {
    id,
    name: feature.name,
    ...(featureStatus(result) as object),
    plane: feature.plane as unknown as Json,
    ...(result?.plane ? { frame: { origin: result.plane.origin.map(round), x: result.plane.x.map(round), y: result.plane.y.map(round), normal: result.plane.normal.map(round) } } : {}),
    points: Object.keys(feature.points).map((point) => ({ id: point, at: position(point), ...(freedom.has(`point:${point}`) ? { freedom: freedom.get(`point:${point}`) as number } : {}) })),
    curves: Object.entries(feature.curves).map(([curve, shape]) => ({
      id: curve,
      ...(shape as unknown as { [key: string]: Json }),
      ...(shape.type === 'circle' ? { radius: round(solved?.radii[curve] ?? feature.radii[curve]), ...(freedom.has(`radius:${curve}`) ? { radiusFree: true } : {}) } : {}),
      ...(shape.type === 'spline' ? splineDetail(shape.points, (point) => solved?.points[point] ?? (Object.prototype.hasOwnProperty.call(feature.points, point) ? feature.points[point] : undefined)) : {}),
    })),
    constraints: Object.entries(feature.constraints).map(([constraint, c]) => ({
      id: constraint,
      label: constraintLabel(c),
      ...(c as unknown as { [key: string]: Json }),
      // The document keeps expressions in the feature's map, not on the constraint. Here they are
      // listed by value name (`value` of a dimension), so a constraint with more values stays unambiguous.
      ...constraintExpressions(feature, constraint, c),
      ...(isDimension(c) && !c.driving && solved?.measurements[constraint] !== undefined ? { measured: round(solved.measurements[constraint]) } : {}),
      ...(diagnosis.conflicting.includes(constraint) ? { conflicting: true } : {}),
      ...(twins.has(constraint) ? { duplicate: true } : {}),
      ...(diagnosis.removable.includes(constraint) ? { surplus: true } : {}),
    })),
    external: Object.entries(feature.external).map(([external, ref]) =>
      ref.type === 'outline'
        ? { id: external, ...outlineDetail(engine, feature, external) }
        : kindOf(ref).source === 'derived'
        ? { id: external, ...derivedDetail(feature, external, solved, position) }
        : {
            id: external,
            ...(ref as unknown as { [key: string]: Json }),
            ...entryDetail(feature, external, position, solved?.radii),
          },
    ),
    ...regionRows(feature, solved),
    profileValid: solved?.valid ?? false,
    diagnosis: diagnosis as unknown as Json,
    advice,
  };
}

// ---------------------------------------------------------------- commands

// What changed after a command enough for the caller to know: feature states that are not ok,
// checks that fail and parameters in error.
// The state a tool asks a query or an export about, from its arguments `at` and `after`. `after` is
// a command: it is previewed where the engine is and the state after it is asked, so nothing is
// written; with both, the document after the command is evaluated up to `at`.
function askedState(engine: Engine, args: Record<string, unknown>): QueryOptions {
  const at = optionalText(args, 'at');
  if (args.after === undefined || args.after === null) return at === undefined ? {} : { at };
  const previewed = engine.preview(args.after as Command, at);
  if (!previewed.ok) throw new ToolError(`after: ${commandProblem(previewed)}`);
  return { state: previewed.state };
}

// The named arguments of a query or the options of a format, as a tool passes them on: `null`
// counts as not given, as for the arguments of every tool. Only at the top level; inside a value
// a `null` is a value the engine judges.
function named(value: unknown): unknown {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The text of an invalid command.
function commandProblem(result: Extract<CommandResult, { ok: false }>): string {
  const { code, message, commandIndex, expression } = result.error;
  const where = expression?.error.position === undefined ? '' : ` (character ${expression.error.position + 1} of the expression)`;
  return `${code}: ${message}${where}${commandIndex === undefined ? '' : ` (the command of the batch with the index ${commandIndex})`}`;
}

// The facts of the features a command changed (D73): a feature of the state after it whose
// result has facts that differ from those of the state before it, or whose status differs (a new
// feature too). The recompute decides, not the command: a parameter that changes a sketch changes
// the facts of the revolve that turns it, and a rename changes none. A result that is the object
// it was before (the recompute memoises by identity) is the same without a comparison. So the
// answer of a command that builds a gear says its module and diameters, and a batch that touches
// many features says no more than FACTS_LISTED of them.
export const FACTS_LISTED = 20;
function touchedFacts(before: EngineState, state: EngineState): { facts?: Json; factsNotListed?: number } {
  const facts = (result: FeatureResult | undefined): string | undefined => (result?.facts ? JSON.stringify(factsInfo(result).facts) : undefined);
  const touched = state.document.features.filter((feature) => {
    const [now, then] = [state.evaluation.features[feature.id], has(before.evaluation.features, feature.id) ? before.evaluation.features[feature.id] : undefined];
    if (!now?.facts || now === then) return false;
    return then === undefined || then.status !== now.status || facts(then) !== facts(now);
  });
  if (touched.length === 0) return {};
  const listed = touched.slice(0, FACTS_LISTED);
  return { facts: Object.fromEntries(listed.map((feature) => [feature.id, factsInfo(state.evaluation.features[feature.id]).facts as Json])), ...(touched.length > listed.length ? { factsNotListed: touched.length - listed.length } : {}) };
}

// `before`: the state the command was applied to, for the facts of what it changed.
function outcome(result: CommandResult, before?: EngineState): unknown {
  // An invalid command did not change the document: it is an error of the call, not a result.
  if (!result.ok) throw new ToolError(commandProblem(result));
  const { document, evaluation } = result.state;
  const problems = document.features
    .map((feature) => ({ id: feature.id, name: feature.name, ...(featureStatus(evaluation.features[feature.id]) as { status: string }) }))
    .filter((feature) => feature.status !== 'ok' && feature.status !== 'suppressed');
  return {
    ok: true,
    features: document.features.length,
    bodies: Object.keys(evaluation.bodies),
    problems: problems as unknown as Json,
    ...documentProblems(result.state),
    sketches: document.features
      .filter((feature) => feature.type === 'sketch' && evaluation.features[feature.id]?.sketch)
      .map((feature) => ({ id: feature.id, ...sketchBrief(evaluation.features[feature.id]) })),
    ...(before ? touchedFacts(before, result.state) : {}),
  };
}

const command = (args: Record<string, unknown>): Command => {
  const value = args.command;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ToolError('argument "command": a command object is expected, see describe_api');
  return value as Command;
};

// The batch of a sketch tool with the IDs of what it makes. The IDs are generated here, so that
// none of them is in the document: `<prefix><kind><number>` with the kinds `p` (point), `c`
// (curve) and `k` (constraint).
function sketchToolBatch(engine: Engine, args: Record<string, unknown>): { command: Command; ids: Record<string, Id[]> } {
  for (const name of ['sketch', 'tool']) if (typeof args[name] !== 'string' || args[name] === '') throw new ToolError(`argument "${name}": a text that is not empty is expected`);
  const tool = args.tool as string;
  const found = engine.getState().document.features.find((feature) => feature.id === args.sketch);
  if (found?.type !== 'sketch') throw new ToolError(`the document has no sketch "${String(args.sketch)}"`);
  const sketch = found;
  // an empty prefix is the default, said aloud
  const prefix = typeof args.prefix === 'string' ? args.prefix : '';
  if (prefix.includes('/')) throw new ToolError('argument "prefix": an ID must not contain "/"');
  const input = args.input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ToolError('argument "input": an object with the inputs of the tool is expected, see describe_api');
  const state = engine.getState();
  const context = { sketch, result: state.evaluation.features[sketch.id]?.sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features };
  const made = sketchTool(tool as SketchToolName, context, input as never, freshIds(state.document, prefix));
  if (!made.ok) throw new ToolError(`${tool}: ${made.message}`);
  return { command: { type: 'batch', commands: made.commands }, ids: made.ids };
}

// The one command that empties a document (D73, the tool new_document), and what it holds by
// kind, the kinds it holds none of left out. The joints go before their links, the features from
// the last before the stored meshes and documents they place, so every command of the batch is
// valid; the settings stay (no command changes them). One command, so one undo step brings the
// document back.
export function emptying(document: Document): { command: Command; holds: Record<string, number> } {
  const { mechanism, bodyProperties, meshes, documents, features, parameters, checks } = document;
  const commands: Command[] = [
    ...Object.keys(mechanism.joints).map((id): Command => ({ type: 'removeJoint', id })),
    ...Object.keys(mechanism.links).map((id): Command => ({ type: 'removeLink', id })),
    ...Object.keys(bodyProperties).map((body): Command => ({ type: 'removeBodyProperties', body })),
    ...[...features].reverse().map((feature): Command => ({ type: 'removeFeature', id: feature.id })),
    ...Object.keys(meshes).map((id): Command => ({ type: 'removeMesh', id })),
    ...Object.keys(documents ?? {}).map((id): Command => ({ type: 'removeDocument', id })),
    ...parameters.map((parameter): Command => ({ type: 'removeParameter', name: parameter.name })),
    ...checks.map((check): Command => ({ type: 'removeCheck', name: check.name })),
  ];
  const counts: [string, number][] = [
    ['features', features.length],
    ['parameters', parameters.length],
    ['checks', checks.length],
    ['bodyProperties', Object.keys(bodyProperties).length],
    ['links', Object.keys(mechanism.links).length],
    ['joints', Object.keys(mechanism.joints).length],
    ['meshes', Object.keys(meshes).length],
    ['documents', Object.keys(documents ?? {}).length],
  ];
  return { command: { type: 'batch', commands }, holds: Object.fromEntries(counts.filter(([, count]) => count > 0)) };
}
const HELD: Record<string, [string, string]> = {
  features: ['feature', 'features'],
  parameters: ['parameter', 'parameters'],
  checks: ['check', 'checks'],
  bodyProperties: ['entry of body properties', 'entries of body properties'],
  links: ['link', 'links'],
  joints: ['joint', 'joints'],
  meshes: ['mesh', 'meshes'],
  documents: ['document', 'documents'],
};
const holdsText = (holds: Record<string, number>): string =>
  Object.entries(holds)
    .map(([kind, count]) => `${count} ${HELD[kind][count === 1 ? 0 : 1]}`)
    .join(', ');

// Whether the call of a tool from MUTATING would change the document now. The app asks before the
// call, to cancel an operation in progress only when the document really changes.
export function changesDocument(engine: Engine, name: string, args: Record<string, unknown>): boolean {
  if (!MUTATING.includes(name) || callProblem(name, args) !== undefined) return false;
  const state = engine.getState();
  // - A command that is accepted and leaves the content of the document as it is changes nothing:
  //   an empty batch, a rename to the same name, a point added and removed in one batch. The
  //   engine makes no undo step for it either.
  // - A preview does not write back what the solver finds, so `solved` of a sketch, which every
  //   edit of the sketch resets, is left out of the comparison.
  // - A drag changes the document only through the solver, so an accepted drag counts as
  //   a change (also the rare one that moves nothing, as the drag of a point that is fixed).
  const content = (feature: Feature): string => JSON.stringify(feature.type === 'sketch' ? { ...feature, solved: undefined } : feature);
  const changes = (command: Command): boolean => {
    // a stored mesh is decided without a preview, which would check megabytes once more before the
    // command does: added under a free ID, removed when the section has it and nothing places it
    // (a command the engine then refuses is counted as a change)
    const { meshes, features } = state.document;
    if (command.type === 'addMesh') return typeof command.id === 'string' && !Object.prototype.hasOwnProperty.call(meshes, command.id);
    if (command.type === 'removeMesh') return typeof command.id === 'string' && Object.prototype.hasOwnProperty.call(meshes, command.id) && !features.some((f) => f.type === 'mesh' && f.mesh === command.id);
    const result = engine.preview(command);
    if (!result.ok) return false;
    const [next, now] = [result.state.document, state.document];
    if (command.type === 'dragPoint') return true;
    if (next === now) return false;
    // everything but the features, a part that is the same object (a section, the stored meshes of
    // megabytes) without writing it out
    const parts = new Set([...Object.keys(next), ...Object.keys(now)].filter((key) => key !== 'features'));
    const part = (document: Document, key: string): unknown => (document as unknown as Record<string, unknown>)[key];
    return (
      [...parts].some((key) => part(next, key) !== part(now, key) && JSON.stringify(part(next, key)) !== JSON.stringify(part(now, key))) ||
      next.features.length !== now.features.length ||
      next.features.some((feature, i) => feature !== now.features[i] && content(feature) !== content(now.features[i]))
    );
  };
  if (name === 'undo') return state.canUndo;
  if (name === 'new_document') return args.discard === true && Object.keys(emptying(state.document).holds).length > 0;
  if (name === 'redo') return state.canRedo;
  if (name === 'execute') return typeof args.command === 'object' && args.command !== null && changes(args.command as Command);
  if (name === OUTLINE_BRIDGE_TOOL) {
    // a look at a file changes nothing; a placement or a replacement is previewed as prepared
    if (args.sketch === undefined || args.sketch === null) return false;
    try {
      const { file, rest } = outlineCall(args);
      const prepared = prepareOutline(engine, file, rest);
      return prepared.command !== undefined && changes(prepared.command);
    } catch (error) {
      if (error instanceof ToolError) return false;
      throw error;
    }
  }
  if (name === 'sketch_tool') {
    if (args.preview === true) return false;
    try {
      return changes(sketchToolBatch(engine, args).command);
    } catch (error) {
      if (error instanceof ToolError) return false;
      throw error;
    }
  }
  return true;
}

// ---------------------------------------------------------------- the import of an outline (D72)

// The tool `import_outline` of the server reads the file and hands its bytes, with the arguments, to
// `outlineInto`, which runs where the engine is: on the server's own engine, or in the app over the
// bridge as the internal tool `_outline` (as `_load` carries a document). So a replacement reads
// the stored options from the document it changes, and both routes give one answer.
// - `prepareOutline` changes nothing: it resolves the format and the options, reads the file and
//   makes the command. It throws `ToolError` for what is refused before any command.
// - `outlineInto` is `prepareOutline`, then `execute` of that command when a sketch was named. A
//   command the engine refuses comes back inside an answer (`refused`), since it carries the report.
export const OUTLINE_BRIDGE_TOOL = '_outline';
export interface OutlineArgs {
  format?: string;
  options?: Record<string, unknown>;
  sketch?: Id;
  id?: Id;
  replace?: boolean;
  remove?: Id[];
  name?: string;
  x?: number | string;
  y?: number | string;
  turn?: number | string;
  anchor?: 'origin' | 'center';
  regions?: boolean;
}
// - `hold`: of a replacement, the constraints of the sketch that name an entity the new curves take
//   away or change in kind (the engine's `updateHolds`), with the entity each names; the update is
//   refused unless they are in `remove`.
export interface PreparedOutline {
  report: OutlineReport;
  id?: Id;
  command?: Command;
  revision?: OutlineRevision;
  hold?: { constraint: Id; entities: Id[] }[];
  next: string[];
}
export interface ImportOutlineAnswer {
  file: string;
  report: OutlineReport;
  entry?: { sketch: Id; id: Id };
  revision?: OutlineRevision;
  hold?: { constraint: Id; entities: Id[] }[];
  refused?: string;
  sketch?: unknown;
  problems?: unknown;
  next: string;
}

// The bytes of a file from their base64 (the arguments of a bridged call are JSON, and bytes do not
// survive it). A text longer than the base64 of the largest file is refused before it is decoded.
export function outlineBytes(text: unknown): Uint8Array {
  if (typeof text !== 'string') throw new ToolError('argument "file.base64": a text is expected');
  if (text.length > 4 * Math.ceil(OUTLINE_LIMITS.bytes / 3)) throw new ToolError(`tooLarge: the file is longer than ${OUTLINE_LIMITS.bytes} bytes`);
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new ToolError('argument "file.base64": not base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const OUTLINE_FIELDS_GIVEN = ['x', 'y', 'turn', 'anchor', 'regions', 'name'] as const;

export function prepareOutline(engine: Engine, file: { name: string; bytes: Uint8Array }, args: OutlineArgs): PreparedOutline {
  const document = engine.getState().document;
  const next: string[] = [];
  if (args.sketch === undefined && (args.replace || args.remove)) throw new ToolError('`replace` and `remove` need `sketch`');
  if (args.remove !== undefined && !args.replace) throw new ToolError('`remove` goes with `replace`: it removes constraints that hold entities a revised file takes away');
  if (args.replace && args.id === undefined) throw new ToolError('`replace` needs `id`, the entry to replace');
  const sketch = args.sketch === undefined ? undefined : sketchOf(engine, args.sketch);
  const stored = sketch && args.replace ? (Object.prototype.hasOwnProperty.call(sketch.external, args.id as string) ? sketch.external[args.id as string] : undefined) : undefined;
  if (sketch && args.replace && stored?.type !== 'outline') throw new ToolError(`the sketch "${sketch.id}" has no outline "${args.id}" to replace${stored ? ` (it is ${stored.type})` : ''}`);
  const storedWith = stored?.type === 'outline' ? stored.readWith : undefined;
  // the format: given, else what the extension names, else the entry's
  const format = (args.format ?? outlineFormatOf(file.name) ?? storedWith?.format) as OutlineFormat | undefined;
  if (format === undefined) throw new ToolError(`the format of "${file.name}" cannot be told from its extension; give \`format\` (${Object.keys(OUTLINE_FORMATS).join(', ')})`);
  if (!Object.prototype.hasOwnProperty.call(OUTLINE_FORMATS, format)) throw new ToolError(`argument "format": there is no outline format "${format}"; the formats are ${Object.keys(OUTLINE_FORMATS).join(', ')}`);
  // the options: given, whole; left out, those the entry stores when the format is its own
  let options = args.options;
  if (options === undefined && storedWith) {
    if (storedWith.format === format) {
      const { format: _, ...rest } = storedWith;
      options = rest;
      next.push(`The file was read with the options the entry stores (${JSON.stringify(rest)}); give \`options\` to read it otherwise (\`{}\` reads every layer with the defaults).`);
    } else next.push(`The entry was read from ${storedWith.format}, this file is ${format}: its stored options were not used.`);
  }
  if (stored && !storedWith) next.push('The entry does not store the options of its first import; the file was read with those given or the defaults.');
  const read = importOutline(format, file.bytes, options as never);
  if (!read.ok) throw new ToolError(`${read.error.code}: ${read.error.message}`);
  if (!sketch) return { report: read.report, next };
  const given: Record<string, unknown> = {};
  for (const field of OUTLINE_FIELDS_GIVEN) if (args[field] !== undefined) given[field] = args[field];
  if (stored) {
    const before = (stored as SketchOutline).curves;
    const revision = outlineRevision(before, read.curves);
    const holds = updateHolds(sketch, args.id as Id, stored, { ...(stored as SketchOutline), curves: read.curves });
    const entities = new Map<Id, Id[]>();
    for (const { entity, constraints } of [...holds.gone, ...holds.changed]) for (const constraint of constraints) entities.set(constraint, [...(entities.get(constraint) ?? []), entity]);
    const hold = holds.constraints.map((constraint) => ({ constraint, entities: entities.get(constraint) ?? [] }));
    const update: Command = { type: 'updateExternal', sketch: sketch.id, id: args.id as Id, ref: { type: 'outline', curves: read.curves, readWith: read.report.readWith, ...given } } as Command;
    const remove = (args.remove ?? []).map((constraint): Command => ({ type: 'removeConstraint', sketch: sketch.id, id: constraint }) as Command);
    return { report: read.report, id: args.id, revision, ...(hold.length ? { hold } : {}), command: remove.length ? ({ type: 'batch', commands: [...remove, update] } as Command) : update, next };
  }
  const id = args.id ?? outlineEntryId(document, sketch, file.name);
  const name = given.name ?? fileStemOf(file.name).trim().slice(0, OUTLINE_LIMITS.text);
  const command = { type: 'addExternal', sketch: sketch.id, id, ref: { type: 'outline', curves: read.curves, readWith: read.report.readWith, ...given, ...(name ? { name } : {}) } } as Command;
  return { report: read.report, id, command, next };
}

export function outlineInto(engine: Engine, file: { name: string; bytes: Uint8Array }, args: OutlineArgs): ImportOutlineAnswer {
  const prepared = prepareOutline(engine, file, args);
  const report = roundedResult(prepared.report) as OutlineReport;
  if (!prepared.command || args.sketch === undefined || prepared.id === undefined) {
    return { file: file.name, report, next: [...prepared.next, 'Nothing was placed. Name a `sketch` to place the outline in it (and `x`, `y`, `turn`, `anchor`), or give `options` (the layers, the unit, the weld) to read the file otherwise.'].join(' ') };
  }
  const result = engine.execute(prepared.command);
  const held = prepared.hold?.filter(({ constraint }) => !(args.remove ?? []).includes(constraint)) ?? [];
  if (!result.ok)
    return {
      file: file.name,
      report,
      ...(prepared.revision ? { revision: prepared.revision } : {}),
      ...(prepared.hold ? { hold: prepared.hold } : {}),
      refused: commandProblem(result),
      // the advice of a revision only for a replacement, and only when constraints hold what goes
      next: [...prepared.next, 'Nothing was changed.', ...(args.replace && held.length ? [`A revision that takes away an entity a constraint holds, or changes its kind, is refused: repeat the call with \`remove: ${JSON.stringify([...(args.remove ?? []), ...held.map(({ constraint }) => constraint)])}\` (\`hold\` lists what each names).`] : [])].join(' '),
    };
  const answer = outcome(result) as { problems: Json; sketches: { id: Id }[] };
  const brief = answer.sketches.find((sketch) => sketch.id === args.sketch);
  const solved = result.state.evaluation.features[args.sketch]?.sketch;
  return {
    file: file.name,
    report,
    entry: { sketch: args.sketch, id: prepared.id },
    ...(prepared.revision ? { revision: prepared.revision } : {}),
    sketch: { ...(brief ?? {}), ...(solved?.openEnds ? { openEnds: solved.openEnds.count } : {}) } as Json,
    problems: answer.problems,
    next: [
      ...prepared.next,
      outlinePlacedNext(prepared.id, result.state.document, args.sketch),
    ].join(' '),
  };
}

// The advice after a placement, by the curves the entry holds: the first of them, and the points of
// the kinds it has (an outline of circles only has no `l1`).
function outlinePlacedNext(id: Id, document: Document, sketch: Id): string {
  const feature = document.features.find((f) => f.id === sketch) as SketchFeature | undefined;
  const ref = feature?.external[id] as SketchOutline | undefined;
  const curves = ref?.type === 'outline' ? Object.entries(ref.curves) : [];
  const first = curves[0]?.[0] ?? 'l1';
  const point: Record<ImportedCurve['type'], string> = { line: 'a', circle: 'center', arc: 'center', spline: '0' };
  // the first curve of each kind the file gave, as the example of its points
  const firstOfKind = new Map<ImportedCurve['type'], string>();
  for (const [local, curve] of curves) if (!firstOfKind.has(curve.type)) firstOfKind.set(curve.type, `\`${id}/${local}/${point[curve.type]}\``);
  const examples = [...firstOfKind.values()].join(', ');
  return `The curves are \`${id}/${first}\` … as \`report.ids\` counts them (their points ${examples} …); the query entryCurves lists them with their places. The query sketchRegions with \`curve: "${id}/${first}"\` gives the region a curve bounds, whole, to extrude. Constrain own geometry to the entities, or move the outline by \`updateExternal\` (\`x\`, \`y\`, \`turn\`, \`anchor\`).`;
}

// The arguments of the internal tool `_outline`: those of `import_outline` without `path`, and the
// file as `{ name, base64 }`.
function outlineCall(args: Record<string, unknown>): { file: { name: string; bytes: Uint8Array }; rest: OutlineArgs } {
  const { file, ...rest } = args as { file?: { name?: unknown; base64?: unknown } };
  if (typeof file !== 'object' || file === null || typeof file.name !== 'string') throw new ToolError('argument "file": `{ name, base64 }` is expected');
  return { file: { name: file.name, bytes: outlineBytes(file.base64) }, rest: Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null)) as OutlineArgs };
}

// What the app's status line says after a call of `_outline`, from its answer: nothing for a look
// (as for a query), the placement, or the refusal as an error.
export function outlineSaid(answer: unknown): { text: string; error: boolean } | undefined {
  const given = answer as Partial<ImportOutlineAnswer> | undefined;
  if (!given || typeof given !== 'object') return undefined;
  if (given.refused) return { text: `AI: the outline was not imported: ${given.refused}`, error: true };
  if (given.entry) return { text: `AI: imported the outline ${given.entry.id} into ${given.entry.sketch}`, error: false };
  return undefined;
}

const NONE: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const COMMAND: JsonSchema = {
  type: 'object',
  properties: { command: { type: 'object', description: 'A command of the engine, an object with the field `type`. describe_api { command: "<type>" } gives the shape of one command; the section types-commands has them all.', required: ['type'] } },
  required: ['command'],
  additionalProperties: false,
};

// Tools that change the document (including the internal loading).
// (`_export` and `query` preview a command of their caller; they write nothing.)
export const MUTATING: readonly string[] = ['execute', 'sketch_tool', 'undo', 'redo', 'new_document', '_load', '_outline'];

// The list of tools. It is built on every query, because the descriptions come from the engine's catalog.
export function tools(): Tool[] {
  const constraintTypes = Object.keys(CONSTRAINTS).join(', ');
  return [
    {
      name: 'describe_api',
      description:
        'What the engine can do, generated from its sources, so valid for this build. Without arguments it returns the index: the essential conventions and the list of sections with their size. Then ask for what you need: `section` (a key of the index, such as "conventions", "queries", "types-commands"), `command` (the shape of one command, such as "addFeature"), `type` (one declaration of the types, such as "ExtrudeFeature"), `query` (one query of the tool query) or `tool` (one sketch tool). Read the index and the section conventions before the first execute or preview.',
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'The key of a section, as the index lists it (its title works too).' },
          command: { type: 'string', description: 'The `type` of a command: its shape with its comment and the types it names.' },
          type: { type: 'string', description: 'The name of a type declared in the types of the engine.' },
          query: { type: 'string', description: 'The name of a query of the tool query.' },
          tool: { type: 'string', description: 'The name of a sketch tool of sketch_tool.' },
        },
        additionalProperties: false,
      },
      run: (_engine, args) => {
        const answer = apiLookup(args as Parameters<typeof apiLookup>[0]);
        if (!answer.ok) throw new ToolError(answer.error);
        return answer.text;
      },
    },
    {
      name: 'get_model',
      description:
        'Model overview: features on the timeline with their state, errors and field expressions, bodies with volume and size (as modelled, whatever the pose) and what their body properties state (name, colour, material, use, density, mass in g, the body a copy takes after), the mechanism when it has a link (links with their bodies, joints with type, parent, child, axis, numbers and expressions, the roots when there are several), the stored meshes when there are any (ID, name, triangles, size of the bounds, the features that place each in `usedBy`), parameter values, checks that fail, and what is in error (`bodyPropertyErrors`: a density or a mass that cannot be evaluated). ' +
        'Without `at` also `bodyPropertiesWithoutBody` (entries of body properties whose body is gone, which a body made again under that ID takes over), `jointErrors`, `jointDriveErrors` (a field of the drive of a joint whose expression fails: it blocks no pose, the export of a robot refuses it), `linksMissingBodies` and `bodiesInNoLink`. `at` = the state after the given feature. `features` (a list of feature IDs) answers with those features alone and the bodies they create, in the shape of the whole model.',
      inputSchema: {
        type: 'object',
        properties: {
          at: { type: 'string', description: 'feature ID; the model is evaluated only up to it' },
          features: { type: 'array', items: { type: 'string' }, description: 'Feature IDs: only these features, with the bodies they create, instead of the whole model' },
        },
        additionalProperties: false,
      },
      run: (engine, args) => {
        const at = optionalText(args, 'at');
        const state = stateAt(engine, at);
        if (args.features === undefined || args.features === null) return modelSummary(state, at === undefined);
        return featuresSummary(state, args.features);
      },
    },
    {
      name: 'get_document',
      description:
        'The document as it is saved (a log of operations). `feature` returns only one feature. A stored mesh (the section `meshes`) is shown without its data: its name and how long its two texts are; a stored document (the section `documents`) shortened: its name, its parameters, the numbers of its features and of its own stored documents. ' +
        '`stored` prints one stored document with its timeline (its own stored meshes and documents shortened the same way): its ID, or `kit/bearing` for the stored document `bearing` of the stored document `kit`; with `feature`, that feature of it. save_document writes the whole document.',
      inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'feature ID' }, stored: { type: 'string', description: 'the ID of a stored document (`kit/bearing` inside another one)' } }, additionalProperties: false },
      run: (engine, args) => {
        const stored = optionalText(args, 'stored');
        const document = stored === undefined ? engine.getState().document : storedDocument(engine.getState().document, stored);
        const id = optionalText(args, 'feature');
        if (id === undefined) return documentShown(document);
        const feature = document.features.find((f) => f.id === id);
        if (!feature) throw new ToolError(`the feature "${id}" is not in the document`);
        return featureShown(feature);
      },
    },
    {
      name: 'get_sketch',
      description:
        'A sketch in detail: points with positions, curves, constraints and dimensions, projected geometry, regions to extrude and a diagnosis (degrees of freedom, what is free, which constraints are redundant or in conflict). The field `advice` sums up what is the matter with the sketch. Questions such as "why does the sketch have two degrees of freedom" belong here.',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string', description: 'sketch ID' } }, required: ['sketch'], additionalProperties: false },
      run: (engine, args) => sketchDetail(engine, text(args, 'sketch')),
    },
    {
      name: 'get_parameters',
      description: 'Parameters of the document with their expressions, values and errors, and checks (expressions that are supposed to hold) with their result: ok, failed (does not hold), error (cannot be evaluated).',
      inputSchema: NONE,
      run: (engine) => parametersInfo(engine.getState()),
    },
    {
      name: 'explain_constraint',
      description: 'Says whether a constraint follows from the other constraints of the sketch, and returns the set of constraints it follows from (nothing can be removed from the set).',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string' }, constraint: { type: 'string', description: 'constraint ID' } }, required: ['sketch', 'constraint'], additionalProperties: false },
      run: (engine, args) => {
        const feature = sketchOf(engine, text(args, 'sketch'));
        const id = text(args, 'constraint');
        if (!Object.prototype.hasOwnProperty.call(feature.constraints, id)) throw new ToolError(`the constraint "${id}" is not in the sketch "${feature.id}"`);
        const explanation = engine.explainConstraint(feature.id, id);
        // Instead of the constraint itself, only those of the constraints it follows from that are wholly
        // redundant themselves can be removed. A constraint with two equations (midpoint of a line,
        // coincidence) may need only one of them for this one, and removing it would free the sketch.
        const redundant = new Set(explanation.impliedBy.length > 0 ? engine.diagnoseSketch(feature.id).redundant : []);
        const others = explanation.impliedBy.filter((other) => redundant.has(other));
        return {
          constraint: { id, label: constraintLabel(feature.constraints[id]) },
          redundant: explanation.redundant,
          impliedBy: explanation.impliedBy.map((other) => ({ id: other, label: constraintLabel(feature.constraints[other]), removableInstead: redundant.has(other) })),
          note: !explanation.redundant
            ? 'The constraint does not follow from the others (or it is a reference dimension, or the sketch is not solved).'
            : explanation.impliedBy.length === 0
              ? 'The constraint follows from the definition of the curve itself.'
              : others.length === explanation.impliedBy.length
                ? 'The constraint itself or any of the constraints in impliedBy can be removed; the geometry does not change.'
                : others.length === 0
                  ? 'Only the constraint itself can be removed; the geometry does not change. The constraints in impliedBy cannot be removed: they determine more than this constraint and the sketch would come loose.'
                  : `The constraint itself can be removed, or ${others.join(', ')} in its place (removableInstead); the geometry does not change. The other constraints in impliedBy cannot be removed: the sketch would come loose.`,
        };
      },
    },
    {
      name: 'get_body',
      description: 'A body in detail: faces (name, planarity, area, normal) and edges (name, kind, ends). The names of faces and edges are used in references: the plane of a sketch on a face, the projection of an edge. A large body (hundreds of edges) does not fit one answer: ask the tool query for the query body with `feature` (the faces of one feature and its copies, and their edges) or `only` (faces or edges).',
      inputSchema: { type: 'object', properties: { body: { type: 'string', description: 'Body ID: the ID of an extrusion with the operation new or of a split, or `<pattern>/<number>` for a copy made by a pattern (get_model lists them)' }, at: { type: 'string', description: 'feature ID; the state after it' } }, required: ['body'], additionalProperties: false },
      run: (engine, args) => bodyDetail(engine, optionalText(args, 'at'), text(args, 'body')),
    },
    {
      name: 'check_interference',
      description:
        'Which bodies collide. `pairs` are the collisions: pairs of bodies that share a volume above the threshold, with the volume in mm³ and `depth` in mm, how deep one body reaches into the other. `fits` are pairs with round faces in which neither body reaches deeper into the other than the chord tolerance of the document (`tolerance` in the answer; the precision of the coordinates is added to it): round faces are polygons, so a pin in a hole of the same diameter overlaps the wall by slivers wherever the two polygons are turned differently; such a pair is not a collision of the design, and the model cannot tell it from a real overlap of round faces that shallow (two round faces that bulge towards each other may overlap by about twice the tolerance before they collide). Where a planar face of one body reaches into a planar face of the other, away from the slivers of a round face, the pair is a collision however shallow. Bodies that only touch (flush faces) and overlaps thinner than about two millionths of the largest coordinate of the pair are not reported at all. `pairs` and `fits` rest only on an intersection the kernel verified. When the kernel refuses to verify the intersection of a pair, the intersection as it computed it is measured by the same rule; it may only clear the pair: `cleared` (only when it has an entry) lists such pairs with `kind` (`nothing` or `fit`), `volume` and `depth`: clear, by a mesh nobody verified. `failed` lists pairs that are neither colliding nor clear: the kernel refused them and what it computed measures as a collision or could not be measured; the message gives the reason and, when measured, the volume and depth as computed, not verified. Use it after building or changing parts that must not overlap (gears in mesh, a pin in its bore). `at` and `after` as for the tool query: `after` previews a command (a pose, a parameter) and checks the bodies after it, writing nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          bodies: { type: 'array', items: { type: 'string' }, description: 'Body IDs; only pairs among them are checked. All bodies by default.' },
          threshold: { type: 'number', description: `Volume in mm³ above which a pair is reported; ${INTERFERENCE_THRESHOLD} by default. Zero reports numeric noise as well.` },
          at: { type: 'string', description: 'Feature ID; the state after it' },
          after: { type: 'object', description: 'A command (as for execute) to preview first; the bodies after it are checked and the document does not change (as for the tool query).' },
        },
        additionalProperties: false,
      },
      run: (engine, args) => {
        const at = optionalText(args, 'at');
        // `after` as the tool query takes it (D73): the query interference in the previewed state,
        // which checks the bodies there (a body only the command makes can be named)
        const previewed = args.after === undefined || args.after === null ? undefined : askedState(engine, args).state;
        const bodies = previewed ? (args.bodies ?? undefined) as string[] | undefined : bodyList(engine, args, at);
        const threshold = args.threshold ?? undefined;
        if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) throw new ToolError('argument "threshold": a volume in mm³, zero or more, is expected');
        // one body has nothing to collide with: an empty answer would read as "no collisions"
        if (bodies !== undefined && new Set(bodies).size < 2) throw new ToolError('argument "bodies": at least two different bodies are needed to check pairs; leave the list out to check all bodies');
        let report: ReturnType<Engine['interference']>;
        try {
          if (previewed) {
            const asked = engine.query('interference', { ...(bodies ? { bodies } : {}), ...(threshold === undefined ? {} : { threshold }) } as never, { state: previewed });
            if (!asked.ok) throw new ToolError(`${asked.error.code}: ${asked.error.message}`);
            report = asked.result as ReturnType<Engine['interference']>;
          } else report = engine.interference({ ...(bodies ? { bodies } : {}), ...(threshold === undefined ? {} : { threshold }), ...(at === undefined ? {} : { at }) });
        } catch (error) {
          // a body beyond a joint that has no motion: its pose is not known (D49)
          if (error instanceof QueryFailure) throw new ToolError(`${error.code}: ${error.message}`);
          throw error;
        }
        // significant digits, not decimal places: a volume above a small threshold must not round to zero
        const rounded = <T extends Pick<Interference, 'volume' | 'depth'>>(pair: T): T => ({ ...pair, volume: Number(pair.volume.toPrecision(6)), depth: Number(pair.depth.toPrecision(4)) });
        const state = previewed ?? stateAt(engine, at);
        const answer = { ...report, pairs: report.pairs.map(rounded), fits: report.fits.map(rounded), ...(report.cleared ? { cleared: report.cleared.map(rounded) } : {}), tolerance: state.document.settings.chordTolerance, ...(report.checked === 0 ? { note: 'The model has fewer than two bodies: nothing was checked.' } : {}) };
        return posed(answer, state);
      },
    },
    {
      name: 'query',
      description:
        `Asks a query of the engine's catalog about the model: ${Object.keys(QUERIES).join(', ')}. The arguments of each query and what it returns are in describe_api, section queries, or describe_api { query: "<name>" } for one. ` +
        'Without `at` and `after` the answer is for the current model. `at` asks about the state after that feature. `after` is a command: the answer is for the model the document would have after it, and nothing is written, ' +
        'so a parameter can be stepped and each step asked about (a pose: `after: { type: "setPose", values: { ... } }`). With both, the document after the command is evaluated up to `at`. Numbers in the answer are rounded to six decimal places. ' +
        'The answer is for the pose of the mechanism (also with `at`); when a link is moved, `pose` beside the answer names the joints that are not at zero. `geometry: "modelled"` asks about the model as modelled instead.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', enum: Object.keys(QUERIES), description: 'The name of the query.' },
          args: { type: 'object', description: 'The arguments of the query, by name; see describe_api.' },
          at: { type: 'string', description: 'Feature ID; the state after it' },
          after: { type: 'object', description: 'A command (as for execute) to preview first; the query is asked about the result and the document does not change.' },
          geometry: { type: 'string', enum: ['modelled'], description: 'modelled: the answer is for the bodies as modelled, whatever pose the mechanism holds.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      run: (engine, args) => {
        const name = text(args, 'query');
        const geometry = optionalText(args, 'geometry');
        if (geometry !== undefined && geometry !== 'modelled') throw new ToolError('argument "geometry": "modelled" or nothing is expected');
        // the preview and the query run together where the engine is; nothing is written
        const options = askedState(engine, args);
        const answer = engine.query(name as QueryName, named(args.args) as never, { ...options, ...(geometry ? { geometry } : {}) });
        if (!answer.ok) throw new ToolError(`${answer.error.code}: ${answer.error.message}`);
        const spec = (QUERIES as Record<string, AnyQuery>)[name];
        const result = roundedResult(answer.result, spec.significant);
        // the note only for an answer computed from the bodies in the pose: not as modelled, not for
        // a query that reads no geometry of bodies (`geometry: 'none'`: a catalog, a sketch, the
        // mechanism itself)
        if (geometry === 'modelled' || spec.geometry !== undefined) return result;
        return posed(result, options.state ?? engine.getState(options.at));
      },
    },
    {
      name: 'execute',
      description: `Carries out a command of the engine and writes it to the document (one undo step). Several commands at once can be composed by the command batch. An invalid command does not change the document and returns the reason. The answer sums up what is not in order, says for every sketch whether it is solved, and gives in \`facts\` the facts of the features the command added or changed (the module and diameters of a gear; at most ${FACTS_LISTED}, the rest counted in \`factsNotListed\`). Constraint types: ${constraintTypes}. The shape of a command: describe_api { command: "<type>" }.`,
      inputSchema: COMMAND,
      // `takenOver`: the IDs of features and sketch entities the command added while a section of
      // the document (body properties) still named them; a body made under such an ID takes the
      // properties, an entity of a sketch only shares the ID
      run: (engine, args) => {
        const before = engine.getState();
        const given = command(args);
        const answer = outcome(engine.execute(given), before) as Record<string, unknown>;
        const taken = takenOver(before.document, given);
        return taken.length ? { ...answer, takenOver: taken } : answer;
      },
    },
    {
      name: 'preview',
      description: 'Computes the result of a command but does not write it to the document. Useful for trying out a change.',
      inputSchema: COMMAND,
      run: (engine, args) => outcome(engine.preview(command(args)), engine.getState()),
    },
    {
      name: 'sketch_tool',
      description: `Draws a whole shape into a sketch with its constraints from a few inputs, or cuts the curves of a sketch (trim, extend, split), and returns the IDs of what it made or changed (\`ids\`). The tools are ${Object.keys(SKETCH_TOOLS).join(', ')}; their inputs and the IDs they return are in describe_api, sections sketch-tools and sketch-cuts, or describe_api { tool: "<name>" } for one. The shape is written as one command, so one undo takes it back; with \`preview: true\` it is only computed, as the tool preview does for a command. The IDs are generated so that the document does not have them: \`<prefix><kind><number>\` with the kinds p (point), c (curve) and k (constraint).`,
      inputSchema: {
        type: 'object',
        properties: {
          sketch: { type: 'string', description: 'ID of the sketch to draw into.' },
          tool: { type: 'string', enum: Object.keys(SKETCH_TOOLS), description: 'The tool.' },
          input: { type: 'object', description: 'The inputs of the tool, see describe_api. Example of a hexagon 5.5 across flats: { "center": { "at": [0, 0], "snap": { "kind": "point", "id": "origin" } }, "vertex": { "at": [3.2, 0] }, "sides": 6, "sizeKind": "acrossFlats", "size": 5.5 }.' },
          prefix: { type: 'string', description: 'A prefix of the generated IDs, for example "nut_". Without it the IDs are p1, c1, k1 and so on.' },
          preview: { type: 'boolean', description: 'true: compute the result without writing it to the document' },
        },
        required: ['sketch', 'tool', 'input'],
        additionalProperties: false,
      },
      run: (engine, args) => {
        const { command, ids } = sketchToolBatch(engine, args);
        const before = engine.getState();
        return { ids, ...(outcome(args.preview === true ? engine.preview(command) : engine.execute(command), before) as object) };
      },
    },
    {
      name: 'new_document',
      description:
        'Replaces the document with an empty one (D73): one command, so one undo step brings the old document back. A document that holds anything (a feature, a parameter, a check, body properties, a link or a joint, a stored mesh or document) is replaced only with `discard: true`; without it the call is refused and says what the document holds (save it first with save_document if it is worth keeping). The answer says what was discarded. The settings (the chord tolerance) stay. Works on the document the tools work on (see session_status), and the file of that document is forgotten, so save_document then needs a path; on the server\'s own engine an undo that brings the document back brings its file back, in the app it does not.',
      inputSchema: { type: 'object', properties: { discard: { type: 'boolean', description: 'true: discard what the document holds' } }, additionalProperties: false },
      run: (engine, args) => {
        const { command, holds } = emptying(engine.getState().document);
        if (Object.keys(holds).length === 0) return { ok: true, discarded: {}, note: 'The document is empty already; nothing changed.' };
        if (args.discard !== true) throw new ToolError(`the document is not empty, it holds ${holdsText(holds)}; new_document with \`discard: true\` replaces it with an empty one (one undo step brings it back), or save it first with save_document`);
        return { ...(outcome(engine.execute(command)) as Record<string, unknown>), discarded: holds, note: `Discarded ${holdsText(holds)}; undo brings ${Object.values(holds).reduce((sum, count) => sum + count, 0) === 1 ? 'it' : 'them'} back.` };
      },
    },
    {
      name: 'undo',
      description: 'Undoes the last written command.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canUndo) throw new ToolError('there is nothing to undo');
        engine.undo();
        return modelSummary(engine.getState());
      },
    },
    {
      name: 'redo',
      description: 'Carries out an undone command again.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canRedo) throw new ToolError('there is nothing to redo');
        engine.redo();
        return modelSummary(engine.getState());
      },
    },
    // Internal tools: the server reads and writes the files, the engine may run in the app.
    { name: '_save', description: '', inputSchema: NONE, hidden: true, run: (engine) => engine.save() },
    // what an insertion would bring (D62), for the answer of insert_document
    { name: '_insertion', description: '', inputSchema: NONE, hidden: true, run: (engine, args) => insertionPreview(engine, args) },
    // A query without effect: the answer brings the server the sequence number of the document in the app too.
    { name: '_ping', description: '', inputSchema: NONE, hidden: true, run: () => null },
    // the import of an outline where the engine is (D72): the file as base64, see outlineInto
    { name: OUTLINE_BRIDGE_TOOL, description: '', inputSchema: NONE, hidden: true, run: (engine, args) => {
        const { file, rest } = outlineCall(args);
        return outlineInto(engine, file, rest);
      } },
    {
      name: '_load',
      description: '',
      inputSchema: NONE,
      hidden: true,
      run: (engine, args) => {
        const result = engine.load(text(args, 'json'));
        if (!result.ok) throw new ToolError(result.error.message);
        return modelSummary(result.state);
      },
    },
    {
      name: '_export_stl',
      description: '',
      inputSchema: NONE,
      hidden: true,
      // One file with the chosen bodies (the printed ones by default: use `part`, D48), or with
      // `perBody` one file per body named by `bodyFileName`. The server writes the files; the
      // engine may run in the app.
      run: (engine, args) => {
        const { bodies: all, bodyProperties } = engine.getState().evaluation;
        const chosen = bodyList(engine, args) ?? printedBodies(bodyProperties);
        if (chosen.length === 0 && (args.bodies === undefined || args.bodies === null)) {
          throw new ToolError(Object.keys(all).length ? 'the model has no printed body (every body is a reference or auxiliary body); list the bodies in `bodies` to export them anyway' : 'the model has no body to export');
        }
        if (chosen.length === 0) throw new ToolError('argument "bodies": the list is empty; leave it out to export the printed bodies');
        if (args.perBody !== undefined && typeof args.perBody !== 'boolean') throw new ToolError('argument "perBody": true or false is expected');
        const file = (bodies: string[]) => ({ bodies, triangles: bodies.reduce((sum, id) => sum + all[id].solid.triangles.length / 3, 0), base64: base64(engine.exportMesh('stl', bodies)) });
        const unique = [...new Set(chosen)];
        return { files: args.perBody === true ? unique.map((id) => ({ name: bodyFileName(id), ...file([id]) })) : [file(unique)] };
      },
    },
    {
      name: '_export',
      description: '',
      inputSchema: NONE,
      hidden: true,
      // The files of an export in a format of the engine's catalog, as a `ToolAnswer`. The server
      // writes them; the engine may run in the app. An export that holds nothing worth writing (no
      // body) is refused with the reason the format gives.
      run: (engine, args): ToolAnswer => {
        const format = text(args, 'format');
        const answer = engine.export(format as ExportFormat, named(args.options) as never, askedState(engine, args));
        if (!answer.ok) throw new ToolError(`${answer.error.code}: ${answer.error.message}`);
        if (answer.result.empty !== undefined) throw new ToolError(answer.result.empty);
        return { kind: 'files', layout: answer.result.layout, files: answer.result.files.map((file) => ({ path: file.path, mediaType: file.mediaType, base64: base64(file.bytes), ...(file.about ? { about: file.about } : {}) })) };
      },
    },
  ];
}

// The arguments of a call against the published schema of the tool: an argument the tool does
// not have (a misspelt `perbody`, `body` for `bodies`) and a value of another type (`"true"` for
// a flag) are refused; silently ignoring them would run the tool with defaults the caller did not
// ask for. `null` counts as not given. Returns the problem as text.
export function argumentProblem(schema: JsonSchema, args: Record<string, unknown>): string | undefined {
  const properties = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  const known = Object.keys(properties);
  for (const [name, value] of Object.entries(args)) {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) return `unknown argument "${name}"; the tool takes ${known.length ? known.join(', ') : 'no arguments'}`;
    if (value === undefined || value === null) continue;
    const type = properties[name].type;
    const fits =
      type === 'boolean' ? typeof value === 'boolean' : type === 'string' ? typeof value === 'string' : type === 'number' ? typeof value === 'number' : type === 'array' ? Array.isArray(value) : type === 'object' ? typeof value === 'object' && !Array.isArray(value) : true;
    if (!fits) return `argument "${name}": ${type === 'boolean' ? 'true or false' : type === 'array' ? 'a list' : `${type === 'object' ? 'an' : 'a'} ${type}`} is expected`;
  }
  return undefined;
}

// Why a call is refused before the tool runs: an unknown tool, or arguments its schema does not
// have. The bridge asks first, so that a call refused here does not touch the app at all.
export function callProblem(name: string, args: Record<string, unknown> = {}): string | undefined {
  const tool = tools().find((candidate) => candidate.name === name);
  if (!tool) return `unknown tool "${name}"`;
  // internal tools are called by the server with its own arguments, not by a client
  return tool.hidden ? undefined : argumentProblem(tool.inputSchema, args);
}

// Calls a tool. Errors of a call come back as text, other exceptions are a bug of the program and propagate.
export function callTool(engine: Engine, name: string, args: Record<string, unknown> = {}): ToolOutcome {
  const problem = callProblem(name, args);
  if (problem) return { ok: false, error: problem };
  const tool = tools().find((candidate) => candidate.name === name) as Tool;
  try {
    // through JSON: typed arrays (Float64Array) are not carried, and the result must pass the bridge unchanged
    const value = tool.run(engine, args);
    const json = (item: unknown): Json => JSON.parse(JSON.stringify(item ?? null)) as Json;
    // a note beside the result (the pose it was answered for) travels apart from it
    return value instanceof Noted ? { ok: true, result: json(value.result), about: json(value.about) } : { ok: true, result: json(value) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}
