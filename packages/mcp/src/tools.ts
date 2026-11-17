// Nástroje pro AI nad enginem. Čisté funkce bez závislosti na Node i na prohlížeči: stejný kód
// obsluhuje engine uvnitř MCP serveru i engine běžící aplikace (přes most).
//
// Nástrojů je málo a jsou obecné. Co engine umí (příkazy, vazby, tvary dokumentu), se do popisu
// dostává ze zdrojů enginu: z katalogu vazeb a z typů. Nová vazba nebo příkaz v enginu se tak
// v nástrojích objeví bez zásahu sem.
import {
  type BodyEdge,
  type BodyResult,
  CONSTRAINTS,
  type Command,
  type CommandResult,
  type Constraint,
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
  poseNote,
  printedBodies,
  sketchTool,
  takenOver,
} from '@trymesh/engine';
import { apiText } from './api';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonSchema = { [key: string]: unknown };

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  hidden?: boolean; // vnitřní nástroj mostu a serveru, v seznamu pro AI není
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

// Chyba volání: špatný argument, neznámá skica. Vrací se volajícímu jako text.
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
  if (typeof value !== 'string' || value === '') throw new ToolError(`argument "${name}": čeká se neprázdný řetězec`);
  return value;
};
const optionalText = (args: Record<string, unknown>, name: string): string | undefined => (args[name] === undefined || args[name] === null ? undefined : text(args, name));

function stateAt(engine: Engine, at: string | undefined): EngineState {
  if (at !== undefined && !engine.getState().document.features.some((feature) => feature.id === at)) throw new ToolError(`feature "${at}" v dokumentu není`);
  return engine.getState(at);
}
function sketchOf(engine: Engine, id: string): SketchFeature {
  const feature = engine.getState().document.features.find((f) => f.id === id);
  if (feature?.type !== 'sketch') throw new ToolError(`skica "${id}" v dokumentu není`);
  return feature;
}

// ---------------------------------------------------------------- popis modelu

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
  const linksMissingBodies = whole ? Object.entries(mechanism.links).flatMap(([link, result]) => (result.missing.length ? [{ link, missing: result.missing }] : [])) : [];
  const bodiesInNoLink = whole ? mechanism.unassigned : [];
  return {
    ...(failedChecks.length ? { failedChecks } : {}),
    ...(parameterErrors.length ? { parameterErrors } : {}),
    ...(bodyPropertyErrors.length ? { bodyPropertyErrors } : {}),
    ...(withoutBody.length ? { bodyPropertiesWithoutBody: withoutBody } : {}),
    ...(jointErrors.length ? { jointErrors } : {}),
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

// Stav skici v přehledech. U nevyřešené skici (konflikt, neúspěch solveru) stupně volnosti nic
// neříkají, proto se neuvádějí.
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

// `whole`: the state is that at the end of the timeline (no `at`).
function modelSummary(state: EngineState, whole = true): unknown {
  const { document, evaluation } = state;
  return {
    features: document.features.map((feature) => featureSummary(feature, evaluation.features[feature.id])),
    bodies: Object.entries(evaluation.bodies).map(([id, body]) => ({ id, ...solidInfo(body), faces: body.faces.length, edges: body.edges.length, ...propertiesInfo(state, id) })),
    problems: document.features.filter((feature) => ['error', 'warning'].includes(evaluation.features[feature.id]?.status ?? '')).map((feature) => feature.id),
    ...(document.parameters.length ? { parameters: Object.fromEntries(parametersInfo(state).parameters.map((p) => [p.name, p.value ?? { error: p.error }])) } : {}),
    ...mechanismInfo(state, whole),
    ...documentProblems(state, whole),
    canUndo: state.canUndo,
    canRedo: state.canRedo,
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

const plural = (count: number): string => `${count} ${count === 1 ? 'stupeň' : count >= 2 && count <= 4 ? 'stupně' : 'stupňů'} volnosti`;

const constraintLabel = (c: Constraint): string => `${CONSTRAINTS[c.type].title} (${constraintOperands(c).join(', ')})`;

function loopArea(loop: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0, n = loop.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return sum / 2;
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
  if (diagnosis.status === 'conflict') advice.push('Vazby jsou v konfliktu; odeberte nebo upravte některou z vazeb v `conflicting`.');
  if (diagnosis.status === 'failed') advice.push('Skicu se nepodařilo vyřešit; poloha bodů je daleko od řešení nebo vazby nejdou splnit.');
  if (diagnosis.status === 'unavailable') advice.push('Skica se nevyhodnotila (je potlačená nebo její rovina neexistuje); diagnostika není k dispozici.');
  if (diagnosis.status === 'solved') {
    if (diagnosis.degreesOfFreedom === 0) advice.push('Skica je plně určená.');
    else {
      const anchors = diagnosis.free.filter((entity) => entity.kind === 'point' && entity.freedom === diagnosis.degreesOfFreedom).map((entity) => entity.id);
      advice.push(`Skica má ${plural(diagnosis.degreesOfFreedom)}; volné entity jsou v \`diagnosis.free\`.`);
      // Bod, jehož volnost se rovná volnosti skici: jeho určením je určená celá skica. Při volnosti
      // 2 dvěma kótami, při volnosti 1 jednou kótou nebo vazbou ve směru, kterým se může hýbat.
      // Totožnost s pevným bodem se neradí: geometrii, která z toho bodu vychází, stáhne do bodu,
      // a při volnosti 1 by byla v konfliktu.
      if (anchors.length > 0) {
        const how = diagnosis.degreesOfFreedom === 2 ? 'například vodorovnou a svislou kótou od počátku' : 'jednou kótou nebo vazbou, která určí jeho polohu ve směru, kterým se může hýbat; totožnost s pevným bodem by tu byla v konfliktu';
        advice.push(`Skicu dourčí určení polohy jednoho z bodů ${anchors.join(', ')} (${how}).`);
      }
    }
    if (diagnosis.removable.length > 0) advice.push(`Vazby navíc: ${diagnosis.removable.join(', ')}. Jdou odebrat naráz beze změny geometrie; z čeho která plyne, řekne explain_constraint.`);
  }
  if (solved && !solved.valid) advice.push('Profil je neplatný: křivky se kříží nebo dotýkají mimo spojené body. Vysunout takovou skicu nejde.');

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
    external: Object.entries(feature.external).map(([external, ref]) => ({
      id: external,
      ...(ref as unknown as { [key: string]: Json }),
      // odvozené entity, na které jde vázat
      entities: ref.kind === 'line' ? [external, `${external}/a`, `${external}/b`] : [external, `${external}/center`],
      at: (ref.kind === 'line' ? [position(`${external}/a`), position(`${external}/b`)] : [position(`${external}/center`)]) as Json,
      ...(ref.kind === 'circle' && solved?.radii[external] !== undefined ? { radius: round(solved.radii[external]) } : {}),
    })),
    regions: (solved?.regions ?? []).map((region) => ({ ref: region.ref as unknown as Json, area: round(region.loops.reduce((sum, loop) => sum + loopArea(loop), 0)), holes: region.loops.length - 1 })),
    profileValid: solved?.valid ?? false,
    diagnosis: diagnosis as unknown as Json,
    advice,
  };
}

// ---------------------------------------------------------------- příkazy

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
  return `${code}: ${message}${where}${commandIndex === undefined ? '' : ` (příkaz dávky s indexem ${commandIndex})`}`;
}

function outcome(result: CommandResult): unknown {
  // Neplatný příkaz dokument nezměnil: je to chyba volání, ne výsledek.
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
  };
}

const command = (args: Record<string, unknown>): Command => {
  const value = args.command;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ToolError('argument "command": čeká se objekt příkazu, viz describe_api');
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
  const context = { sketch, result: state.evaluation.features[sketch.id]?.sketch, parameters: state.evaluation.parameters, document: state.document };
  const made = sketchTool(tool as SketchToolName, context, input as never, freshIds(state.document, prefix));
  if (!made.ok) throw new ToolError(`${tool}: ${made.message}`);
  return { command: { type: 'batch', commands: made.commands }, ids: made.ids };
}

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
    const result = engine.preview(command);
    if (!result.ok) return false;
    const [next, now] = [result.state.document, state.document];
    if (command.type === 'dragPoint') return true;
    if (next === now) return false;
    return (
      JSON.stringify({ ...next, features: undefined }) !== JSON.stringify({ ...now, features: undefined }) ||
      next.features.length !== now.features.length ||
      next.features.some((feature, i) => feature !== now.features[i] && content(feature) !== content(now.features[i]))
    );
  };
  if (name === 'undo') return state.canUndo;
  if (name === 'redo') return state.canRedo;
  if (name === 'execute') return typeof args.command === 'object' && args.command !== null && changes(args.command as Command);
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

const NONE: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const COMMAND: JsonSchema = {
  type: 'object',
  properties: { command: { type: 'object', description: 'Příkaz enginu, objekt s polem `type`. Tvary všech příkazů vrací describe_api.', required: ['type'] } },
  required: ['command'],
  additionalProperties: false,
};

// Nástroje, které mění dokument (včetně vnitřního načtení).
// (`_export` and `query` preview a command of their caller; they write nothing.)
export const MUTATING: readonly string[] = ['execute', 'sketch_tool', 'undo', 'redo', '_load'];

// Seznam nástrojů. Sestavuje se při každém dotazu, protože popisy vycházejí z katalogu enginu.
export function tools(): Tool[] {
  const constraintTypes = Object.keys(CONSTRAINTS).join(', ');
  return [
    {
      name: 'describe_api',
      description:
        'Popis toho, co engine umí: konvence, tvary dokumentu a příkazů (typy v TypeScriptu) a katalog vazeb s operandy. Zavolej před prvním execute nebo preview; popis se generuje ze zdrojů enginu, takže platí pro tuto verzi.',
      inputSchema: NONE,
      run: () => apiText(),
    },
    {
      name: 'get_model',
      description:
        'Model overview: features on the timeline with their state, errors and field expressions, bodies with volume and size (as modelled, whatever the pose) and what their body properties state (name, colour, material, use, density, mass in g, the body a copy takes after), the mechanism when it has a link (links with their bodies, joints with type, parent, child, axis, numbers and expressions, the roots when there are several), parameter values, checks that fail, and what is in error (`bodyPropertyErrors`: a density or a mass that cannot be evaluated). ' +
        'Without `at` also `bodyPropertiesWithoutBody` (entries of body properties whose body is gone, which a body made again under that ID takes over), `jointErrors`, `linksMissingBodies` and `bodiesInNoLink`. `at` = the state after the given feature.',
      inputSchema: { type: 'object', properties: { at: { type: 'string', description: 'ID feature; model se vyhodnotí jen po ni' } }, additionalProperties: false },
      run: (engine, args) => {
        const at = optionalText(args, 'at');
        return modelSummary(stateAt(engine, at), at === undefined);
      },
    },
    {
      name: 'get_document',
      description: 'Dokument tak, jak se ukládá (log operací). `feature` vrátí jen jednu feature.',
      inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'ID feature' } }, additionalProperties: false },
      run: (engine, args) => {
        const { document } = engine.getState();
        const id = optionalText(args, 'feature');
        if (id === undefined) return document;
        const feature = document.features.find((f) => f.id === id);
        if (!feature) throw new ToolError(`feature "${id}" v dokumentu není`);
        return feature;
      },
    },
    {
      name: 'get_sketch',
      description:
        'Skica podrobně: body s polohami, křivky, vazby a kóty, promítnutá geometrie, oblasti k vysunutí a diagnostika (stupně volnosti, co je volné, které vazby jsou navíc nebo v konfliktu). Pole `advice` shrnuje, co se skicou je. Sem patří otázky typu „proč má skica dva stupně volnosti".',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string', description: 'ID skici' } }, required: ['sketch'], additionalProperties: false },
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
      description: 'Řekne, jestli vazba plyne z ostatních vazeb skici, a vrátí sadu vazeb, ze kterých plyne (nejde z ní nic ubrat).',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string' }, constraint: { type: 'string', description: 'ID vazby' } }, required: ['sketch', 'constraint'], additionalProperties: false },
      run: (engine, args) => {
        const feature = sketchOf(engine, text(args, 'sketch'));
        const id = text(args, 'constraint');
        if (!Object.prototype.hasOwnProperty.call(feature.constraints, id)) throw new ToolError(`vazba "${id}" ve skice "${feature.id}" není`);
        const explanation = engine.explainConstraint(feature.id, id);
        // Místo vazby samé jde odebrat jen ta z vazeb, ze kterých plyne, která je sama celá navíc.
        // Vazba se dvěma rovnicemi (střed úsečky, totožnost) může téhle stačit jen jednou z nich
        // a po jejím odebrání by se skica uvolnila.
        const redundant = new Set(explanation.impliedBy.length > 0 ? engine.diagnoseSketch(feature.id).redundant : []);
        const others = explanation.impliedBy.filter((other) => redundant.has(other));
        return {
          constraint: { id, label: constraintLabel(feature.constraints[id]) },
          redundant: explanation.redundant,
          impliedBy: explanation.impliedBy.map((other) => ({ id: other, label: constraintLabel(feature.constraints[other]), removableInstead: redundant.has(other) })),
          note: !explanation.redundant
            ? 'Vazba z ostatních neplyne (nebo je to referenční kóta, případně skica není vyřešená).'
            : explanation.impliedBy.length === 0
              ? 'Vazba plyne už z definice křivky.'
              : others.length === explanation.impliedBy.length
                ? 'Odebrat jde vazba sama nebo kterákoli z vazeb v impliedBy; geometrie se nezmění.'
                : others.length === 0
                  ? 'Odebrat jde jen vazba sama; geometrie se nezmění. Vazby v impliedBy odebrat nejde: určují víc než tuhle vazbu a skica by se uvolnila.'
                  : `Odebrat jde vazba sama, nebo místo ní ${others.join(', ')} (removableInstead); geometrie se nezmění. Ostatní vazby v impliedBy odebrat nejde: skica by se uvolnila.`,
        };
      },
    },
    {
      name: 'get_body',
      description: 'Těleso podrobně: stěny (jméno, rovinnost, plocha, normála) a hrany (jméno, druh, konce). Jména stěn a hran se používají v odkazech: rovina skici na stěně, promítnutí hrany.',
      inputSchema: { type: 'object', properties: { body: { type: 'string', description: 'Body ID: the ID of an extrusion with the operation new or of a split, or `<pattern>/<number>` for a copy made by a pattern (get_model lists them)' }, at: { type: 'string', description: 'ID feature; stav po ní' } }, required: ['body'], additionalProperties: false },
      run: (engine, args) => bodyDetail(engine, optionalText(args, 'at'), text(args, 'body')),
    },
    {
      name: 'check_interference',
      description:
        'Which bodies collide. `pairs` are the collisions: pairs of bodies that share a volume above the threshold, with the volume in mm³ and `depth` in mm, how deep one body reaches into the other. `fits` are pairs with round faces in which neither body reaches deeper into the other than the chord tolerance of the document (`tolerance` in the answer; the precision of the coordinates is added to it): round faces are polygons, so a pin in a hole of the same diameter overlaps the wall by slivers wherever the two polygons are turned differently; such a pair is not a collision of the design, and the model cannot tell it from a real overlap of round faces that shallow (two round faces that bulge towards each other may overlap by about twice the tolerance before they collide). Where a planar face of one body reaches into a planar face of the other, away from the slivers of a round face, the pair is a collision however shallow. Bodies that only touch (flush faces) and overlaps thinner than about two millionths of the largest coordinate of the pair are not reported at all. `pairs` and `fits` rest only on an intersection the kernel verified. When the kernel refuses to verify the intersection of a pair, the intersection as it computed it is measured by the same rule; it may only clear the pair: `cleared` (only when it has an entry) lists such pairs with `kind` (`nothing` or `fit`), `volume` and `depth`: clear, by a mesh nobody verified. `failed` lists pairs that are neither colliding nor clear: the kernel refused them and what it computed measures as a collision or could not be measured; the message gives the reason and, when measured, the volume and depth as computed, not verified. Use it after building or changing parts that must not overlap (gears in mesh, a pin in its bore).',
      inputSchema: {
        type: 'object',
        properties: {
          bodies: { type: 'array', items: { type: 'string' }, description: 'Body IDs; only pairs among them are checked. All bodies by default.' },
          threshold: { type: 'number', description: `Volume in mm³ above which a pair is reported; ${INTERFERENCE_THRESHOLD} by default. Zero reports numeric noise as well.` },
          at: { type: 'string', description: 'Feature ID; the state after it' },
        },
        additionalProperties: false,
      },
      run: (engine, args) => {
        const at = optionalText(args, 'at');
        const bodies = bodyList(engine, args, at);
        const threshold = args.threshold ?? undefined;
        if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) throw new ToolError('argument "threshold": a volume in mm³, zero or more, is expected');
        // one body has nothing to collide with: an empty answer would read as "no collisions"
        if (bodies !== undefined && new Set(bodies).size < 2) throw new ToolError('argument "bodies": at least two different bodies are needed to check pairs; leave the list out to check all bodies');
        let report: ReturnType<Engine['interference']>;
        try {
          report = engine.interference({ ...(bodies ? { bodies } : {}), ...(threshold === undefined ? {} : { threshold }), ...(at === undefined ? {} : { at }) });
        } catch (error) {
          // a body beyond a joint that has no motion: its pose is not known (D49)
          if (error instanceof QueryFailure) throw new ToolError(`${error.code}: ${error.message}`);
          throw error;
        }
        // significant digits, not decimal places: a volume above a small threshold must not round to zero
        const rounded = <T extends Pick<Interference, 'volume' | 'depth'>>(pair: T): T => ({ ...pair, volume: Number(pair.volume.toPrecision(6)), depth: Number(pair.depth.toPrecision(4)) });
        const answer = { ...report, pairs: report.pairs.map(rounded), fits: report.fits.map(rounded), ...(report.cleared ? { cleared: report.cleared.map(rounded) } : {}), tolerance: engine.getState().document.settings.chordTolerance, ...(report.checked === 0 ? { note: 'The model has fewer than two bodies: nothing was checked.' } : {}) };
        return posed(answer, stateAt(engine, at));
      },
    },
    {
      name: 'query',
      description:
        `Asks a query of the engine's catalog about the model: ${Object.keys(QUERIES).join(', ')}. The arguments of each query and what it returns are in describe_api, section Queries. ` +
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
      description: `Provede příkaz enginu a zapíše ho do dokumentu (jeden krok undo). Víc příkazů naráz jde složit příkazem batch. Neplatný příkaz dokument nezmění a vrátí důvod. Typy vazeb: ${constraintTypes}. Přesné tvary příkazů vrací describe_api.`,
      inputSchema: COMMAND,
      // `takenOver`: the IDs of features and sketch entities the command added while a section of
      // the document (body properties) still named them; a body made under such an ID takes the
      // properties, an entity of a sketch only shares the ID
      run: (engine, args) => {
        const before = engine.getState().document;
        const given = command(args);
        const answer = outcome(engine.execute(given)) as Record<string, unknown>;
        const taken = takenOver(before, given);
        return taken.length ? { ...answer, takenOver: taken } : answer;
      },
    },
    {
      name: 'preview',
      description: 'Spočítá výsledek příkazu, ale do dokumentu ho nezapíše. Hodí se na vyzkoušení změny.',
      inputSchema: COMMAND,
      run: (engine, args) => outcome(engine.preview(command(args))),
    },
    {
      name: 'sketch_tool',
      description: `Draws a whole shape into a sketch with its constraints from a few inputs and returns the IDs of what it made (\`ids\`). The tools are ${Object.keys(SKETCH_TOOLS).join(', ')}; their inputs and the IDs they return are in describe_api, section Sketch tools. The shape is written as one command, so one undo takes it back; with \`preview: true\` it is only computed, as the tool preview does for a command. The IDs are generated so that the document does not have them: \`<prefix><kind><number>\` with the kinds p (point), c (curve) and k (constraint).`,
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
        return { ids, ...(outcome(args.preview === true ? engine.preview(command) : engine.execute(command)) as object) };
      },
    },
    {
      name: 'undo',
      description: 'Vrátí poslední zapsaný příkaz.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canUndo) throw new ToolError('není co vracet');
        engine.undo();
        return modelSummary(engine.getState());
      },
    },
    {
      name: 'redo',
      description: 'Znovu provede vrácený příkaz.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canRedo) throw new ToolError('není co opakovat');
        engine.redo();
        return modelSummary(engine.getState());
      },
    },
    // Vnitřní nástroje: soubory čte a zapisuje server, engine může běžet v aplikaci.
    { name: '_save', description: '', inputSchema: NONE, hidden: true, run: (engine) => engine.save() },
    // Dotaz bez účinku: s odpovědí přijde serveru i pořadové číslo dokumentu v aplikaci.
    { name: '_ping', description: '', inputSchema: NONE, hidden: true, run: () => null },
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
  if (!tool) return `neznámý nástroj "${name}"`;
  // internal tools are called by the server with its own arguments, not by a client
  return tool.hidden ? undefined : argumentProblem(tool.inputSchema, args);
}

// Zavolá nástroj. Chyby volání se vracejí jako text, ostatní výjimky jsou chyba programu a propadnou.
export function callTool(engine: Engine, name: string, args: Record<string, unknown> = {}): ToolOutcome {
  const problem = callProblem(name, args);
  if (problem) return { ok: false, error: problem };
  const tool = tools().find((candidate) => candidate.name === name) as Tool;
  try {
    // přes JSON: typovaná pole (Float64Array) se nepřenášejí a výsledek musí projít mostem beze změny
    const value = tool.run(engine, args);
    const json = (item: unknown): Json => JSON.parse(JSON.stringify(item ?? null)) as Json;
    // a note beside the result (the pose it was answered for) travels apart from it
    return value instanceof Noted ? { ok: true, result: json(value.result), about: json(value.about) } : { ok: true, result: json(value) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}
